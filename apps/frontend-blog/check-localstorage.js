// 这个脚本在Node.js中模拟检查LocalStorage
const fs = require('fs');
const path = require('path');

// 尝试读取LocalStorage文件（如果存在）
const localStoragePath = path.join(
  process.cwd(),
  '..',
  '..',
  '..',
  '..',
  'Users',
  'porter',
  'Library',
  'Application Support',
  'Google',
  'Chrome',
  'Default',
  'Local Storage',
);
console.log('Checking LocalStorage path:', localStoragePath);

// 更简单的方法：直接检查浏览器控制台
console.log('\n=== 手动检查LocalStorage步骤 ===');
console.log('1. 打开浏览器开发者工具 (F12)');
console.log('2. 切换到 Application 标签页');
console.log('3. 在左侧选择 Local Storage > http://localhost:4002');
console.log('4. 查看 auth-storage 键的值');
console.log('\n或者运行以下命令查看LocalStorage内容：');
console.log('localStorage.getItem("auth-storage")');
