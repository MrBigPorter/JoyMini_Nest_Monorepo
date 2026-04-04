// Seed scripts may instantiate many Prisma clients across modules.
// Clamp pool settings for seed runs to avoid exhausting Postgres connections.
function applySeedDbConnectionGuards() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    return;
  }

  const connectionLimit = process.env.SEED_DB_CONNECTION_LIMIT ?? '1';
  const poolTimeout = process.env.SEED_DB_POOL_TIMEOUT ?? '60';

  try {
    const url = new URL(raw);

    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', connectionLimit);
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', poolTimeout);
    }

    process.env.DATABASE_URL = url.toString();
  } catch {
    // Fallback for unexpected URL formats.
    const joiner = raw.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${raw}${joiner}connection_limit=${connectionLimit}&pool_timeout=${poolTimeout}`;
  }
}

export async function runSeed() {
  applySeedDbConnectionGuards();

  console.log('\n🌱  JoyMinis Demo Seed ─────────────────────────');
  console.log(`    ${new Date().toISOString()}\n`);

  const resetTreasures = process.env.SEED_TREASURES_RESET !== '0';
  const cleanupBeforeSeed = process.env.SEED_CLEANUP_BEFORE_INSERT !== '0';

  if (cleanupBeforeSeed) {
    const { cleanupSeedData } = await import('./cleanup-seed-data');
    await cleanupSeedData();
    console.log('');
  }

  // [1] 基础配置
  const { seedSystemConfigExchangeRate } = await import('./system-config-exchange-rate');
  await seedSystemConfigExchangeRate();

  // [2] 产品分类（需在产品前执行，供 seedTreasures 内部查 id）
  const { seedProductCategories } = await import('./product-category-list');
  await seedProductCategories();

  // [3] 地址基础数据（省/市/Barangay 最小可用集）
  const { seedAddressLite } = await import('./seed-address-lite');
  await seedAddressLite();

  // [4] KYC 证件类型
  const { seedKycIdTypes } = await import('./seed-kyc-id-types');
  await seedKycIdTypes();

  // [5] 抽奖产品 + 产品-分类关联（依赖分类）
  const { seedTreasures } = await import('./seed-treasures');
  await seedTreasures({ resetBeforeSeed: resetTreasures });

  // [6] 活动专区 + 关联商品（依赖产品）
  const { seedActSections } = await import('./seed-sections');
  await seedActSections();

  // [7] 首页 / 活动页 Banner
  const { seedBanners } = await import('./seed-banners');
  await seedBanners();

  // [8] 广告位
  const { seedAdvertisements } = await import('./seed-ads');
  await seedAdvertisements();

  // [9] 支付渠道
  const { seedPaymentChannels } = await import('./seed-payment-channels');
  await seedPaymentChannels();

  // [10] 秒杀场次 + 秒杀商品（依赖产品）
  const { seedFlashSale } = await import('./seed-flash-sale');
  await seedFlashSale();

  // [11] 优惠券模板
  const { seedCoupons } = await import('./seed-coupons');
  await seedCoupons();

  // [12] 福利抽奖活动 + 奖品（依赖产品 + 优惠券）
  const { seedLuckyDraw } = await import('./seed-lucky-draw');
  await seedLuckyDraw();

  // [13] 测试用户 + 钱包（本地开发用）
  const { seedTestUserWallet } = await import('./seed-wallet');
  await seedTestUserWallet();

  // [14] 机器人用户（供拼团补位与登录日志演示）
  const { seedRobotsLite } = await import('./seed-robots-lite');
  await seedRobotsLite();

  // [14.5] 客服渠道 + 虚拟 bot 用户（依赖机器人用户基础设施）
  const { seedSupportChannels } = await import('./seed-support-channels');
  await seedSupportChannels();

  // [15] 拼团演示数据（依赖产品 + 测试用户）
  const { seedGroups } = await import('./seed-groups');
  await seedGroups();

  // [16] 登录日志演示数据（依赖测试用户 + 机器人）
  const { seedLoginLogs } = await import('./seed-login-logs');
  await seedLoginLogs();

  console.log('\n✨  Seed 完成！\n');
}

if (require.main === module) {
  runSeed()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('❌  Seed 失败:', e);
      process.exit(1);
    });
}
