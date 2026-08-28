import { prisma } from '../database/prisma.js';
import { pushCustomerServiceReminder } from './push.service.js';

export async function runCustomerReminderJobs(now = new Date()) {
  const dueCustomers = await prisma.customer.findMany({
    where: {
      serviceIntervalDays: { not: null },
      nextServiceReminderAt: { lte: now },
      lastServiceReminderSentAt: null,
    },
    include: {
      favoriteService: true,
      queueEntries: {
        where: { status: 'COMPLETED' },
        include: { service: true },
        orderBy: { completedAt: 'desc' },
        take: 1,
      },
    },
  });
  for (const customer of dueCustomers) {
    try {
      await pushCustomerServiceReminder(customer);
      await prisma.customer.update({
        where: { id: customer.id },
        data: { lastServiceReminderSentAt: now },
      });
    } catch (error) {
      console.error('Customer service reminder failed:', customer.id, error.message);
    }
  }
}
