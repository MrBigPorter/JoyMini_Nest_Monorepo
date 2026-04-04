import { loadEnvForHost } from '../utils/load-env-for-host';
import { runSeed } from './index';

// Must run before importing seed modules that instantiate PrismaClient.
loadEnvForHost();

runSeed()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌  Seed 失败:', e);
    process.exit(1);
  });
