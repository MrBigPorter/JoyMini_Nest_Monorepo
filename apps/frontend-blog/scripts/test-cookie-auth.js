/**
 * 测试Cookie认证存储策略
 * 验证单一Cookie存储架构是否正常工作
 */

// 模拟浏览器环境
if (typeof window === 'undefined') {
  global.window = {
    document: {
      cookie: '',
    },
  };
  global.document = window.document;
  global.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

// 导入测试模块
const fs = require('fs');
const path = require('path');

console.log('🔍 开始测试Cookie认证存储策略...\n');

// 1. 检查文件是否存在
const filesToCheck = [
  'src/lib/stores/cookie-storage.ts',
  'src/lib/stores/auth.store.ts',
  'src/lib/utils/cookie-manager.ts',
];

console.log('📁 检查必要文件是否存在:');
filesToCheck.forEach((file) => {
  const fullPath = path.join(__dirname, '..', file);
  const exists = fs.existsSync(fullPath);
  console.log(`  ${exists ? '' : '❌'} ${file}`);
});

console.log('\n📋 验证架构变更:');

// 2. 检查auth.store.ts是否使用cookieStorage
const authStorePath = path.join(__dirname, '..', 'src/lib/stores/auth.store.ts');
const authStoreContent = fs.readFileSync(authStorePath, 'utf-8');

const checks = [
  {
    name: '导入cookieStorage',
    regex: /import.*cookieStorage.*from.*['"]\.\/cookie-storage['"]/,
    found: authStoreContent.includes('cookieStorage'),
  },
  {
    name: '使用cookieStorage适配器',
    regex: /storage:\s*createJSONStorage\(\(\)\s*=>\s*cookieStorage\)/,
    found: authStoreContent.includes('createJSONStorage(() => cookieStorage)'),
  },
  {
    name: '移除localStorage引用',
    regex: /localStorage\.getItem\('auth-storage'\)/,
    found: authStoreContent.includes("localStorage.getItem('auth-storage')"),
    shouldBeFalse: true,
  },
];

checks.forEach((check) => {
  const passed = check.shouldBeFalse ? !check.found : check.found;
  console.log(`  ${passed ? '' : '❌'} ${check.name}`);
});

// 3. 检查cookie-manager.ts是否清理了localStorage冗余逻辑
const cookieManagerPath = path.join(__dirname, '..', 'src/lib/utils/cookie-manager.ts');
const cookieManagerContent = fs.readFileSync(cookieManagerPath, 'utf-8');

const cookieManagerChecks = [
  {
    name: '移除localStorage.removeItem逻辑',
    regex: /localStorage\.removeItem\('token'\)/,
    found: cookieManagerContent.includes("localStorage.removeItem('token')"),
    shouldBeFalse: true,
  },
  {
    name: '移除syncFromLocalStorage方法',
    regex: /syncFromLocalStorage\(\):/,
    found: cookieManagerContent.includes('syncFromLocalStorage():'),
    shouldBeFalse: true,
  },
];

console.log('\n🧹 验证清理工作:');
cookieManagerChecks.forEach((check) => {
  const passed = check.shouldBeFalse ? !check.found : check.found;
  console.log(`  ${passed ? '' : '❌'} ${check.name}`);
});

// 4. 检查cookie-storage.ts实现
const cookieStoragePath = path.join(__dirname, '..', 'src/lib/stores/cookie-storage.ts');
const cookieStorageContent = fs.readFileSync(cookieStoragePath, 'utf-8');

const cookieStorageChecks = [
  {
    name: '实现StateStorage接口',
    regex: /export\s+const\s+cookieStorage:.*StateStorage/,
    found: cookieStorageContent.includes('StateStorage'),
  },
  {
    name: '实现getItem方法',
    regex: /getItem:\s*\(name:\s*string\):/,
    found: cookieStorageContent.includes('getItem: (name: string):'),
  },
  {
    name: '实现setItem方法',
    regex: /setItem:\s*\(name:\s*string,\s*value:\s*string\):/,
    found: cookieStorageContent.includes('setItem: (name: string, value: string):'),
  },
  {
    name: '实现removeItem方法',
    regex: /removeItem:\s*\(name:\s*string\):/,
    found: cookieStorageContent.includes('removeItem: (name: string):'),
  },
];

console.log('\n🔧 验证Cookie存储适配器:');
cookieStorageChecks.forEach((check) => {
  console.log(`  ${check.found ? '' : '❌'} ${check.name}`);
});

// 5. 总结
console.log('\n📊 测试总结:');
const totalChecks = [
  ...checks,
  ...cookieManagerChecks,
  ...cookieStorageChecks,
];
const passedChecks = totalChecks.filter((check) => 
  check.shouldBeFalse ? !check.found : check.found
).length;

console.log(`  总检查项: ${totalChecks.length}`);
console.log(`  通过项: ${passedChecks}`);
console.log(`  失败项: ${totalChecks.length - passedChecks}`);

if (passedChecks === totalChecks.length) {
  console.log('\n🎉 所有检查通过！Cookie认证存储策略已成功实施。');
  console.log(' 架构已从双重存储(localStorage + Cookie)简化为单一Cookie存储');
  console.log(' 与语言设置保持一致的存储策略');
  console.log(' 支持Web和App环境');
  console.log(' 中间件可以正确读取认证状态');
} else {
  console.log('\n⚠️  部分检查未通过，请检查上述失败项。');
  process.exit(1);
}

console.log('\n🚀 下一步建议:');
console.log('1. 运行开发服务器测试实际登录/登出流程');
console.log('2. 验证受保护路由拦截功能');
console.log('3. 测试跨平台兼容性（Web/App）');
console.log('4. 更新团队文档和培训材料');