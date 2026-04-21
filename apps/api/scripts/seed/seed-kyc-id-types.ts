// apps/api/scripts/seed/seed-kyc-id-types.ts
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const ID_TYPES = [
  {
    id: 1,
    code: 'PASSPORT',
    label: 'Passport',
    country: 'GLOBAL',
    sortOrder: 1,
    status: 1,
  },
  {
    id: 10,
    code: 'PH_DRIVER_LICENSE',
    label: "Driver's License (LTO)",
    country: 'PH',
    sortOrder: 2,
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
    sortOrder: 4,
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
    id: 18,
    code: 'PH_ACR',
    label: 'Alien Certificate of Registration (ACR I-Card)',
    country: 'PH',
    sortOrder: 9,
    status: 1,
  },
  {
    id: 20,
    code: 'CN_ID',
    label: 'Chinese Resident ID',
    country: 'CN',
    sortOrder: 20,
    status: 1,
  },
  {
    id: 30,
    code: 'VN_ID',
    label: 'Vietnamese Citizen ID',
    country: 'VN',
    sortOrder: 30,
    status: 1,
  },
];

export async function seedKycIdTypes() {
  let created = 0;
  let updated = 0;

  for (const row of ID_TYPES) {
    const exists = await db.kycIdType.findUnique({
      where: { id: row.id },
      select: { id: true },
    });

    if (exists) {
      await db.kycIdType.update({
        where: { id: row.id },
        data: row,
      });
      updated++;
      continue;
    }

    await db.kycIdType.create({ data: row });
    created++;
  }

  console.log(`   KycIdType        +${created} new, ~${updated} updated`);
}
