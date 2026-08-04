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
  const business = await prisma.business.create({
    data: { ownerId: user.id, name: 'BK Barber', type: 'BARBER_SHOP', phone: '0911000000', city: 'Addis Ababa', address: 'Bole, Addis Ababa', description: 'Smart barber and beauty service', openingTime: '08:00', closingTime: '20:00' },
  });

  await prisma.messageTemplate.createMany({ data: templateRows(business.id) });

  const [dawit, hana] = await Promise.all([
    prisma.staff.create({ data: { businessId: business.id, fullName: 'Dawit', phone: '0911111111', role: 'Barber', status: 'BUSY', commissionType: 'PERCENTAGE', commissionValue: 30 } }),
    prisma.staff.create({ data: { businessId: business.id, fullName: 'Hana', phone: '0922222222', role: 'Stylist', status: 'AVAILABLE', commissionType: 'PERCENTAGE', commissionValue: 35 } }),
  ]);

  const [haircut, hairBeard, makeup, nails] = await Promise.all([
    prisma.service.create({ data: { businessId: business.id, name: 'ፀጉር መቁረጥ', category: 'HAIR', price: 300, durationMinutes: 30 } }),
    prisma.service.create({ data: { businessId: business.id, name: 'ፀጉር + ጢም', category: 'BEARD', price: 500, durationMinutes: 45 } }),
    prisma.service.create({ data: { businessId: business.id, name: 'ሜካፕ', category: 'MAKEUP', price: 1500, durationMinutes: 90 } }),
    prisma.service.create({ data: { businessId: business.id, name: 'ጥፍር', category: 'NAILS', price: 800, durationMinutes: 60 } }),
  ]);

  const [nahom, abel, sara] = await Promise.all([
    prisma.customer.create({ data: { businessId: business.id, fullName: 'ናሆም ክብሮም', phone: '0911234567', gender: 'MALE', favoriteServiceId: hairBeard.id, favoriteStaffId: dawit.id, totalVisits: 4, totalSpending: 1900 } }),
    prisma.customer.create({ data: { businessId: business.id, fullName: 'አቤል ተስፋዬ', phone: '0922345678', gender: 'MALE', favoriteServiceId: haircut.id, favoriteStaffId: dawit.id, totalVisits: 2, totalSpending: 600 } }),
    prisma.customer.create({ data: { businessId: business.id, fullName: 'ሳራ መኮንን', phone: '0933456789', gender: 'FEMALE', favoriteServiceId: makeup.id, favoriteStaffId: hana.id, vip: true, totalVisits: 3, totalSpending: 3800 } }),
  ]);

  const now = new Date();
  const queue = await Promise.all([
    prisma.queueEntry.create({ data: { businessId: business.id, customerId: nahom.id, serviceId: hairBeard.id, staffId: dawit.id, queueNumber: 1, status: 'IN_SERVICE', source: 'WALK_IN', estimatedWaitMinutes: 0, estimatedStartTime: now, actualStartTime: now } }),
    prisma.queueEntry.create({ data: { businessId: business.id, customerId: abel.id, serviceId: haircut.id, staffId: dawit.id, queueNumber: 2, status: 'WAITING', source: 'SIMULATED_CALL', estimatedWaitMinutes: 45, estimatedStartTime: new Date(now.getTime() + 45 * 60000) } }),
    prisma.queueEntry.create({ data: { businessId: business.id, customerId: sara.id, serviceId: makeup.id, staffId: hana.id, queueNumber: 3, status: 'WAITING', source: 'MANUAL_ADD', estimatedWaitMinutes: 75, estimatedStartTime: new Date(now.getTime() + 75 * 60000) } }),
  ]);
  await prisma.queueStatusHistory.createMany({ data: queue.map((entry) => ({ businessId: business.id, queueEntryId: entry.id, toStatus: entry.status })) });

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  await prisma.appointment.create({ data: { businessId: business.id, customerId: sara.id, serviceId: nails.id, staffId: hana.id, appointmentDate: tomorrow, startTime: '10:00', endTime: '11:00', status: 'CONFIRMED', notes: 'Demo appointment' } });

  console.log('Seed complete');
  console.log('Login: 0911000000 / password123');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(() => prisma.$disconnect());
