// prisma/seed-address.ts

import { PrismaClient } from '@prisma/client';
import { phAddressData } from './data/ph-address'; // 引入上面的数据

const prisma = new PrismaClient();

async function main() {
  console.log('🌏 Seeding Philippines Address Data...');

  // 遍历省份
  for (const provData of phAddressData) {
    console.log(`Processing Province: ${provData.province}`);

    // 1. 创建或查找省份 (Upsert)
    const province = await prisma.province.upsert({
      where: { provinceName: provData.province },
      update: {}, // 如果存在，什么都不做
      create: {
        provinceName: provData.province,
        provinceCode: provData.code,
        status: 1,
      },
    });

    // 遍历该省份下的城市
    for (const cityData of provData.cities) {
      // 2. 查找城市是否存在 (由于 Schema 中 cityName 不是 unique，只能用 findFirst)
      // 建议：在 schema 中给 City 加 @@unique([provinceId, cityName]) 唯一索引
      let city = await prisma.city.findFirst({
        where: {
          provinceId: province.provinceId,
          cityName: cityData.name,
        },
      });

      // 如果不存在，则创建
      if (!city) {
        city = await prisma.city.create({
          data: {
            provinceId: province.provinceId,
            cityName: cityData.name,
            cityCode: cityData.code,
            postalCode: cityData.postalCode,
            status: 1,
          },
        });
      }

      // 3. 批量处理 Barangay
      // 这里的逻辑是：如果 Barangay 不存在就创建
      // 为了性能，我们可以先查出该城市下所有的 Barangay
      const existingBarangays = await prisma.barangay.findMany({
        where: { cityId: city.cityId },
        select: { barangayName: true },
      });

      const existingNames = new Set(
        existingBarangays.map((b) => b.barangayName),
      );

      const newBarangays = cityData.barangays
        .filter((bName: string) => !existingNames.has(bName)) // 过滤掉已经存在的
        .map((bName: string) => ({
          cityId: city.cityId,
          barangayName: bName,
          status: 1,
        }));

      if (newBarangays.length > 0) {
        await prisma.barangay.createMany({
          data: newBarangays,
        });
        console.log(
          `   └─ Added ${newBarangays.length} barangays to ${cityData.name}`,
        );
      }
    }
  }

  console.log(' Philippines Address Seeding Completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
