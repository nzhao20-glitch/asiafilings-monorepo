import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123!', 10);
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@asiafilings.dev' },
    update: {},
    create: {
      email: 'admin@asiafilings.dev',
      passwordHash: adminPassword,
      fullName: 'Admin User',
      organization: 'Asia Filings',
      role: 'ADMIN'
    }
  });

  // Create test user
  const userPassword = await bcrypt.hash('user123!', 10);
  const testUser = await prisma.user.upsert({
    where: { email: 'test@institutional.com' },
    update: {},
    create: {
      email: 'test@institutional.com',
      passwordHash: userPassword,
      fullName: 'Test User',
      organization: 'Test Investment Corp',
      role: 'VIEWER'
    }
  });

  console.log('👥 Created users:', { adminUser: adminUser.email, testUser: testUser.email });
  console.log('✅ Database seed completed successfully!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
