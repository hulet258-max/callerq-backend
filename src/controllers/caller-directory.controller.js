import { prisma } from '../database/prisma.js';
import { normalizeEthiopianPhone } from '../utils/phone.js';
import { ok } from '../utils/response.js';

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

export async function syncContacts(req, res) {
  const unique = new Map();
  for (const contact of req.body.contacts) {
    const displayName = cleanName(contact.displayName);
    if (displayName.length < 2 || /^\+?[\d\s()-]+$/.test(displayName)) continue;
    try {
      const normalizedPhone = normalizeEthiopianPhone(contact.phone);
      unique.set(normalizedPhone, { normalizedPhone, displayName });
    } catch {
      // Non-Ethiopian and malformed numbers are not added to this directory.
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.callerDirectoryContact.deleteMany({ where: { contributorId: req.user.id } });
    if (unique.size) {
      await tx.callerDirectoryContact.createMany({
        data: [...unique.values()].map((contact) => ({
          contributorId: req.user.id,
          ...contact,
        })),
      });
    }
  });
  return ok(res, { syncedCount: unique.size }, 'Caller ID contacts synced');
}

export async function lookup(req, res) {
  const normalizedPhone = normalizeEthiopianPhone(req.query.phone);
  const rows = await prisma.callerDirectoryContact.findMany({
    where: { normalizedPhone },
    select: { displayName: true, updatedAt: true },
  });
  const names = new Map();
  for (const row of rows) {
    const key = row.displayName.toLocaleLowerCase('en');
    const current = names.get(key) || { displayName: row.displayName, confirmations: 0, updatedAt: row.updatedAt };
    current.confirmations += 1;
    if (row.updatedAt > current.updatedAt) {
      current.displayName = row.displayName;
      current.updatedAt = row.updatedAt;
    }
    names.set(key, current);
  }
  const suggestion = [...names.values()].sort((a, b) =>
    b.confirmations - a.confirmations || b.updatedAt - a.updatedAt
  )[0];
  return ok(res, {
    suggestion: suggestion ? {
      displayName: suggestion.displayName,
      confirmations: suggestion.confirmations,
    } : null,
  });
}
