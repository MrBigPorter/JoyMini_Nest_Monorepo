import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting KYC ID Types seeding...');

  const idTypes = [
    // === 国际通用 ===
    {
      id: 1,
      code: 'PASSPORT',
      label: 'Passport',
      country: 'GLOBAL',
      sortOrder: 1,
      status: 1,
    },

    // === 菲律宾 (Philippines) ===
    {
      id: 10,
      code: 'PH_DRIVER_LICENSE',
      label: "Driver's License (LTO)",
      country: 'PH',
      sortOrder: 2, // 菲律宾最常用的放前面
      status: 1,
    },
    {
      id: 11,
      code: 'PH_UMID',
      label: 'Unified Multi-Purpose ID (UMID)',
      country: 'PH',
      sortOrder: 3,
      status: 1,
    },
    {
      id: 12,
      code: 'PH_NATIONAL_ID',
      label: 'PhilSys ID (National ID)',
      country: 'PH',
      sortOrder: 4, // 正在普及，放前排
      status: 1,
    },
    {
      id: 13,
      code: 'PH_PRC_ID',
      label: 'PRC ID (Professional License)',
      country: 'PH',
      sortOrder: 5,
      status: 1,
    },
    {
      id: 14,
      code: 'PH_POSTAL_ID',
      label: 'Postal ID (Digitized)',
      country: 'PH',
      sortOrder: 6,
      status: 1,
    },
    {
      id: 15,
      code: 'PH_SSS_ID',
      label: 'SSS ID',
      country: 'PH',
      sortOrder: 7,
      status: 1,
    },
    {
      id: 16,
      code: 'PH_VOTER_ID',
      label: "Voter's ID",
      country: 'PH',
      sortOrder: 8,
      status: 1,
    },
    {
      id: 17,
      code: 'PH_TIN_ID',
      label: 'TIN ID (Tax)',
      country: 'PH',
      sortOrder: 9,
      status: 1, // 只有纸质卡，OCR 难识别，如果不想要可以设为 0
    },
    {
      id: 18,
      code: 'PH_ACR',
      label: 'Alien Certificate of Registration (ACR I-Card)',
      country: 'PH',
      sortOrder: 10,
      status: 1, // 外国人在菲必备
    },

    // === 中国 (China) ===
    {
      id: 20,
      code: 'CN_ID',
      label: 'Chinese Resident ID (身份证)',
      country: 'CN',
      sortOrder: 20,
      status: 1,
    },

    // === 越南 (Vietnam) ===
    {
      id: 30,
      code: 'VN_ID',
      label: 'Vietnamese Citizen ID (CCCD)',
      country: 'VN',
      sortOrder: 30,
      status: 1,
    },
  ];

  for (const type of idTypes) {
    await prisma.kycIdType.upsert({
      where: { id: type.id },
      update: type, // 如果 ID 存在，更新文案和状态
      create: type, // 如果不存在，创建
    });
  }

  console.log(` Seeded ${idTypes.length} KYC ID Types.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
