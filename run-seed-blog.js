#!/usr/bin/env node

const { execSync } = require("child_process");
const path = require("path");

console.log("🚀 运行 Blog 种子脚本...");

try {
  // 切换到 apps/api 目录
  const apiDir = path.join(__dirname, "apps/api");

  // 运行 seed-blog.ts 脚本
  execSync("npx tsx scripts/seed/seed-blog.ts", {
    cwd: apiDir,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: "--openssl-legacy-provider",
    },
  });

  console.log(" Blog 种子脚本运行成功！");
} catch (error) {
  console.error("❌ Blog 种子脚本运行失败:", error.message);
  process.exit(1);
}
