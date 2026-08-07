import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { templateRows } from '../src/services/template.service.js';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('password123', 12);
  const user = await prisma.user.upsert({
    where: { phone: '0911000000' },
    update: { fullName: 'BK Owner', email: 'owner@bkbarber.et', passwordHash, role: 'BUSINESS_OWNER', isActive: true },
    create: { fullName: 'BK Owner', phone: '0911000000', email: 'owner@bkbarber.et', passwordHash, role: 'BUSINESS_OWNER' },
  });
  await prisma.business.deleteMany({ where: { ownerId: user.id } });
  const business = await prisma.business.create({ data: {
    ownerId: user.id, name: 'BK Barber', type: 'BARBER_SHOP', phone: '0911000000',
    city: 'Addis Ababa', address: 'Bole, Addis Ababa', description: 'Smart personal barber service',
    openingTime: '08:00', closingTime: '20:00',
  } });
  await prisma.messageTemplate.createMany({ data: templateRows(business.id) });
  const [haircut, hairBeard, makeup, nails] = await Promise.all([
    prisma.service.create({ data: { businessId: business.id, name: 'Haircut', category: 'HAIR', price: 300, durationMinutes: 30 } }),
    prisma.service.create({ data: { businessId: business.id, name: 'Hair and beard', category: 'BEARD', price: 500, durationMinutes: 45 } }),
    prisma.service.create({ data: { businessId: business.id, name: 'Makeup', category: 'MAKEUP', price: 1500, durationMinutes: 90 } }),
    prisma.service.create({ data: { businessId: business.id, name: 'Nails', category: 'NAILS', price: 800, durationMinutes: 60 } }),
  ]);
  const [nahom, abel, sara] = await Promise.all([
    prisma.customer.create({ data: { businessId: business.id, fullName: 'Nahom', phone: '+251911234567', normalizedPhone: '+251911234567', gender: 'MALE', favoriteServiceId: hairBeard.id, totalVisits: 4, totalSpending: 1900 } }),
    prisma.customer.create({ data: { businessId: business.id, fullName: 'Abel', phone: '+251922345678', normalizedPhone: '+251922345678', gender: 'MALE', favoriteServiceId: haircut.id, totalVisits: 2, totalSpending: 600 } }),
    prisma.customer.create({ data: { businessId: business.id, fullName: 'Sara', phone: '+251933456789', normalizedPhone: '+251933456789', gender: 'FEMALE', favoriteServiceId: makeup.id, vip: true, totalVisits: 3, totalSpending: 3800 } }),
  ]);
  const now = new Date();
  const queue = await Promise.all([
    prisma.queueEntry.create({ data: { businessId: business.id, customerId: nahom.id, serviceId: hairBeard.id, queueNumber: 1, status: 'IN_SERVICE', source: 'WALK_IN', actualStartTime: now } }),
    prisma.queueEntry.create({ data: { businessId: business.id, customerId: abel.id, serviceId: haircut.id, queueNumber: 2, status: 'WAITING', source: 'SIMULATED_CALL', estimatedWaitMinutes: 45 } }),
    prisma.queueEntry.create({ data: { businessId: business.id, customerId: sara.id, serviceId: makeup.id, queueNumber: 3, status: 'WAITING', source: 'MANUAL_ADD', estimatedWaitMinutes: 75 } }),
  ]);
  await prisma.queueStatusHistory.createMany({ data: queue.map((entry) => ({ businessId: business.id, queueEntryId: entry.id, toStatus: entry.status })) });
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  await prisma.appointment.create({ data: { businessId: business.id, customerId: sara.id, serviceId: nails.id, appointmentDate: tomorrow, startTime: '10:00', endTime: '11:00', status: 'CONFIRMED' } });
  console.log('Seed complete');
  console.log('Login: 0911000000 / password123');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(() => prisma.$disconnect());
