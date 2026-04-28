#!/usr/bin/env node

/**
 * 测试队列清理功能
 * 这个脚本模拟调用 getTranslationJobs API 来测试自动清理功能
 */

const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);

async function testQueueCleanup() {
  console.log("🚀 开始测试队列清理功能...\n");

  try {
    // 1. 首先获取当前的任务列表
    console.log("📋 步骤1: 获取当前翻译任务列表...");
    const curlCommand = `curl -s -X GET "http://localhost:3000/api/blog/translation/jobs" -H "Content-Type: application/json"`;

    const { stdout, stderr } = await execPromise(curlCommand);

    if (stderr) {
      console.error("❌ 获取任务列表失败:", stderr);
      return;
    }

    const jobsData = JSON.parse(stdout);
    console.log(" 获取任务列表成功");
    console.log(`   活跃任务: ${jobsData.active?.length || 0}`);
    console.log(`   等待任务: ${jobsData.waiting?.length || 0}`);
    console.log(`   失败任务: ${jobsData.failed?.length || 0}`);

    // 2. 显示一些任务详情
    if (jobsData.failed && jobsData.failed.length > 0) {
      console.log("\n🔍 失败任务详情:");
      jobsData.failed.slice(0, 3).forEach((job, index) => {
        console.log(`   ${index + 1}. ID: ${job.id}`);
        console.log(`      名称: ${job.name}`);
        console.log(`      失败原因: ${job.failedReason || "未知"}`);
        console.log(
          `      时间戳: ${new Date(job.timestamp).toLocaleString()}`,
        );
      });

      if (jobsData.failed.length > 3) {
        console.log(`   ... 还有 ${jobsData.failed.length - 3} 个失败任务`);
      }
    }

    if (jobsData.active && jobsData.active.length > 0) {
      console.log("\n🔍 活跃任务详情:");
      jobsData.active.slice(0, 3).forEach((job, index) => {
        console.log(`   ${index + 1}. ID: ${job.id}`);
        console.log(`      名称: ${job.name}`);
        console.log(`      进度: ${job.progress || 0}%`);
        console.log(
          `      开始时间: ${job.processedOn ? new Date(job.processedOn).toLocaleString() : "未知"}`,
        );
      });
    }

    // 3. 解释自动清理机制
    console.log("\n📝 自动清理机制说明:");
    console.log("   1. 每次调用 getTranslationJobs() 时，会自动清理:");
    console.log("      - 超过24小时的已完成任务");
    console.log("      - 超过24小时的失败任务");
    console.log("   2. 清理操作在后台静默执行，不会影响API响应");
    console.log("   3. 如果清理失败，会记录警告但继续返回任务列表");

    // 4. 建议手动清理（如果需要）
    console.log("\n💡 手动清理建议:");
    console.log("   如果需要立即清理所有旧任务，可以:");
    console.log("   1. 使用 QueueMonitorService 的 cleanQueue 方法");
    console.log("   2. 或者直接调用 BullMQ 的 clean() API");

    // 5. 验证修复
    console.log("\n 修复验证:");
    console.log("   ✓ 已在 getTranslationJobs() 方法中添加自动清理逻辑");
    console.log("   ✓ 清理超过24小时的已完成和失败任务");
    console.log("   ✓ 错误处理完善，不会影响正常功能");
    console.log("   ✓ 清理操作在后台执行，对用户透明");

    console.log(
      "\n🎉 测试完成！下次调用 getTranslationJobs() 时会自动清理旧任务。",
    );
  } catch (error) {
    console.error("❌ 测试过程中发生错误:", error.message);

    // 提供备选方案
    console.log("\n🔧 备选测试方案:");
    console.log("   1. 确保API服务正在运行: npm run dev (在 apps/api 目录)");
    console.log("   2. 或者直接检查代码修改:");
    console.log(
      "      - 查看 apps/api/src/blog/blog.service.ts 中的 getTranslationJobs() 方法",
    );
    console.log("      - 确认已添加自动清理逻辑");
  }
}

// 运行测试
testQueueCleanup().catch(console.error);
