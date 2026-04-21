#!/usr/bin/env node

/**
 * PWA图标生成脚本
 * 使用现有的logo.png生成所有PWA所需的图标尺寸
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// 图标尺寸配置
const ICON_SIZES = [
  // PWA标准尺寸
  { size: 192, name: 'icon-192x192.png', purpose: 'any maskable' },
  { size: 512, name: 'icon-512x512.png', purpose: 'any maskable' },

  // Apple设备尺寸
  { size: 180, name: 'apple-touch-icon.png', purpose: 'apple' },
  { size: 152, name: 'apple-touch-icon-152x152.png', purpose: 'apple' },
  { size: 167, name: 'apple-touch-icon-167x167.png', purpose: 'apple' },
  { size: 120, name: 'apple-touch-icon-120x120.png', purpose: 'apple' },

  // Favicon尺寸
  { size: 32, name: 'favicon-32x32.png', purpose: 'favicon' },
  { size: 16, name: 'favicon-16x16.png', purpose: 'favicon' },

  // 其他常用尺寸
  { size: 144, name: 'icon-144x144.png', purpose: 'any maskable' },
  { size: 96, name: 'icon-96x96.png', purpose: 'any maskable' },
  { size: 72, name: 'icon-72x72.png', purpose: 'any maskable' },
  { size: 48, name: 'icon-48x48.png', purpose: 'any maskable' },
];

// 源文件路径
const SOURCE_IMAGE = path.join(__dirname, '..', 'public', 'logo.png');
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'icons');

async function generateIcons() {
  try {
    // 检查源文件是否存在
    if (!fs.existsSync(SOURCE_IMAGE)) {
      console.error(`❌ 源文件不存在: ${SOURCE_IMAGE}`);
      console.log('请确保 public/logo.png 文件存在');
      process.exit(1);
    }

    // 创建输出目录
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      console.log(`📁 创建图标目录: ${OUTPUT_DIR}`);
    }

    // 读取源图像信息
    const sourceInfo = await sharp(SOURCE_IMAGE).metadata();
    console.log(
      `📷 源图像信息: ${sourceInfo.width}x${sourceInfo.height}, ${sourceInfo.format}`,
    );

    // 生成所有尺寸的图标
    console.log('🔄 开始生成PWA图标...');

    const results = [];
    for (const icon of ICON_SIZES) {
      const outputPath = path.join(OUTPUT_DIR, icon.name);

      try {
        await sharp(SOURCE_IMAGE)
          .resize(icon.size, icon.size, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 0 },
          })
          .png({ quality: 90, compressionLevel: 9 })
          .toFile(outputPath);

        results.push({
          name: icon.name,
          size: icon.size,
          path: outputPath,
          success: true,
        });

        console.log(`✅ 生成: ${icon.name} (${icon.size}x${icon.size})`);
      } catch (error) {
        console.error(`❌ 生成失败 ${icon.name}:`, error.message);
        results.push({
          name: icon.name,
          size: icon.size,
          path: outputPath,
          success: false,
          error: error.message,
        });
      }
    }

    // 生成结果报告
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log('\n📊 生成结果:');
    console.log(`✅ 成功: ${successful} 个图标`);
    console.log(`❌ 失败: ${failed} 个图标`);

    if (failed > 0) {
      console.log('\n失败的图标:');
      results
        .filter((r) => !r.success)
        .forEach((r) => {
          console.log(`  - ${r.name}: ${r.error}`);
        });
    }

    // 生成manifest图标配置
    generateManifestConfig(results.filter((r) => r.success));

    console.log('\n🎉 PWA图标生成完成！');
    console.log(`📁 图标保存在: ${OUTPUT_DIR}`);
    console.log('\n📋 下一步:');
    console.log('1. 图标已自动添加到manifest配置');
    console.log('2. 运行 yarn dev 测试PWA功能');
    console.log('3. 使用浏览器开发者工具检查PWA安装提示');
  } catch (error) {
    console.error('❌ 脚本执行失败:', error);
    process.exit(1);
  }
}

function generateManifestConfig(successfulIcons) {
  const manifestIcons = successfulIcons
    .filter(
      (icon) =>
        icon.name.startsWith('icon-') ||
        icon.name.startsWith('apple-touch-icon'),
    )
    .map((icon) => {
      const sizeMatch = icon.name.match(/(\d+)x(\d+)/);
      const sizes = sizeMatch
        ? `${sizeMatch[1]}x${sizeMatch[2]}`
        : `${icon.size}x${icon.size}`;

      return {
        src: `/icons/${icon.name}`,
        sizes,
        type: 'image/png',
        purpose: icon.name.includes('apple') ? 'apple' : 'any maskable',
      };
    });

  const configPath = path.join(
    __dirname,
    '..',
    'public',
    'pwa-icons-config.json',
  );
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        source: 'logo.png',
        icons: manifestIcons,
      },
      null,
      2,
    ),
  );

  console.log(`📝 生成manifest图标配置: ${configPath}`);

  // 输出建议的manifest配置片段
  console.log('\n📋 建议的manifest icons配置:');
  console.log(JSON.stringify(manifestIcons.slice(0, 2), null, 2)); // 只显示前2个主要图标
}

// 执行主函数
if (require.main === module) {
  generateIcons();
}

module.exports = { generateIcons, ICON_SIZES };
