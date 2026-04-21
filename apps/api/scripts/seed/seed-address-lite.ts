// apps/api/scripts/seed/seed-address-lite.ts
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const ADDRESS_DATA = [
  {
    provinceName: 'Metro Manila',
    provinceCode: 'NCR',
    cities: [
      {
        cityName: 'Makati',
        cityCode: 'MKT',
        postalCode: '1200',
        barangays: ['Bel-Air', 'Poblacion', 'San Lorenzo', 'Guadalupe Nuevo'],
      },
      {
        cityName: 'Quezon City',
        cityCode: 'QC',
        postalCode: '1100',
        barangays: ['Bagumbayan', 'Batasan Hills', 'Commonwealth', 'Cubao'],
      },
      {
        cityName: 'Taguig',
        cityCode: 'TGU',
        postalCode: '1630',
        barangays: ['Fort Bonifacio', 'Pinagsama', 'Western Bicutan', 'Ususan'],
      },
    ],
  },
  {
    provinceName: 'Cebu',
    provinceCode: 'CEB',
    cities: [
      {
        cityName: 'Cebu City',
        cityCode: 'CEB_CITY',
        postalCode: '6000',
        barangays: ['Lahug', 'Mabolo', 'Talamban', 'Banilad'],
      },
      {
        cityName: 'Mandaue',
        cityCode: 'MDE',
        postalCode: '6014',
        barangays: ['Subangdaku', 'Bakilid', 'Casuntingan', 'Tipolo'],
      },
    ],
  },
];

export async function seedAddressLite() {
  let provinceCreated = 0;
  let cityCreated = 0;
  let barangayCreated = 0;

  for (const prov of ADDRESS_DATA) {
    const provinceExists = await db.province.findUnique({
      where: { provinceName: prov.provinceName },
      select: { provinceId: true },
    });

    const province = await db.province.upsert({
      where: { provinceName: prov.provinceName },
      update: {
        provinceCode: prov.provinceCode,
        status: 1,
      },
      create: {
        provinceName: prov.provinceName,
        provinceCode: prov.provinceCode,
        status: 1,
      },
    });

    if (!provinceExists) {
      provinceCreated++;
    }

    for (const citySeed of prov.cities) {
      let city = await db.city.findFirst({
        where: {
          provinceId: province.provinceId,
          cityName: citySeed.cityName,
        },
      });

      if (!city) {
        city = await db.city.create({
          data: {
            provinceId: province.provinceId,
            cityName: citySeed.cityName,
            cityCode: citySeed.cityCode,
            postalCode: citySeed.postalCode,
            status: 1,
          },
        });
        cityCreated++;
      } else {
        await db.city.update({
          where: { cityId: city.cityId },
          data: {
            cityCode: citySeed.cityCode,
            postalCode: citySeed.postalCode,
            status: 1,
          },
        });
      }

      for (const name of citySeed.barangays) {
        const exists = await db.barangay.findUnique({
          where: {
            cityId_barangayName: { cityId: city.cityId, barangayName: name },
          },
          select: { barangayId: true },
        });

        if (exists) continue;

        await db.barangay.create({
          data: {
            cityId: city.cityId,
            barangayName: name,
            status: 1,
          },
        });
        barangayCreated++;
      }
    }
  }

  console.log(`   Province         +${provinceCreated} new`);
  console.log(`   City             +${cityCreated} new`);
  console.log(`   Barangay         +${barangayCreated} new`);
}
