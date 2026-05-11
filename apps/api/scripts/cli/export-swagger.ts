import 'reflect-metadata';

/**
 * 📦 Swagger Docs Export CLI
 * ============================================================
 * Generates a standalone OpenAPI specification and Swagger UI
 * HTML page from the NestJS backend.
 *
 * Usage:
 *   yarn workspace @lucky/api export:swagger          # Filtered (public only)
 *   yarn workspace @lucky/api export:swagger:full     # Full (including admin)
 *
 * Options (for custom usage):
 *   --full        Export ALL endpoints (skip admin filtering)
 *   --output      Specify output directory (default: dist/public/)
 *
 * Examples:
 *   tsx scripts/cli/export-swagger.ts --full --output ../../swagger-docs/
 *
 * Output:
 *   <output-dir>/
 *     swagger-spec.json   — OpenAPI 3.0 spec (JSON)
 *     swagger-spec.yaml   — OpenAPI 3.0 spec (YAML, if yaml dep available)
 *     index.html          — Standalone Swagger UI (read-only)
 *
 * Security:
 *   - Default mode: All "admin *" tagged routes are EXCLUDED
 *   - --full mode:  All endpoints included (for Upwork showcase)
 *   - Swagger UI is read-only (tryItOutEnabled=false)
 *   - No live server required — purely static files
 * ============================================================
 */

import { Test, TestingModule } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../../src/app.module';
import { GoogleProvider } from '../../src/client/auth/providers/google.provider';
import { FirebaseProvider } from '../../src/client/auth/providers/firebase.provider';
import { loadEnvForHost } from '../utils/load-env-for-host';
import * as fs from 'fs';
import * as path from 'path';

// ── CLI argument parsing ─────────────────────────────────────────────

interface CliArgs {
  full: boolean;
  output: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const outputIdx = args.indexOf('--output');
  const output =
    outputIdx !== -1 && outputIdx + 1 < args.length
      ? args[outputIdx + 1]
      : null;
  return { full, output };
}

// ── Filter helpers ────────────────────────────────────────────────

const ADMIN_TAG_PREFIX = 'admin ';
const EXCLUDED_PATH_PREFIXES = [
  '/api/v1/admin',
  '/api/v1/chat',
  '/api/v1/contacts',
  '/api/v1/media',
  '/api/v1/upload',
  '/api/blog/',
];

function isAdminOperation(operation: Record<string, any> | undefined): boolean {
  if (!operation || !operation.tags) return false;
  return operation.tags.some((tag: string) =>
    tag.toLowerCase().startsWith(ADMIN_TAG_PREFIX),
  );
}

function isExcludedPath(pathName: string): boolean {
  return EXCLUDED_PATH_PREFIXES.some((prefix) => pathName.startsWith(prefix));
}

function filterOpenApiDoc(doc: Record<string, any>): Record<string, any> {
  const filteredPaths: Record<string, any> = {};
  const usedTags = new Set<string>();

  for (const [pathName, pathItem] of Object.entries(doc.paths || {})) {
    if (isExcludedPath(pathName)) continue;

    const methods = [
      'get',
      'post',
      'put',
      'patch',
      'delete',
      'options',
      'head',
    ];
    const filteredPathItem: Record<string, any> = {};

    let hasAnyMethod = false;
    for (const method of methods) {
      const operation = (pathItem as Record<string, any>)[method];
      if (!operation) continue;
      if (isAdminOperation(operation)) continue;
      filteredPathItem[method] = operation;

      if (operation.tags) {
        for (const tag of operation.tags) {
          usedTags.add(tag);
        }
      }
      hasAnyMethod = true;
    }

    if (hasAnyMethod) {
      filteredPaths[pathName] = filteredPathItem;
    }
  }

  const filteredTags = (doc.tags || []).filter((tag: any) => {
    const tagName = typeof tag === 'string' ? tag : tag.name;
    return usedTags.has(tagName);
  });

  return { ...doc, paths: filteredPaths, tags: filteredTags };
}

// ── Swagger UI HTML generation ──────────────────────────────────────

function generateSwaggerUiHtml(specUrl: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "${specUrl}",
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis],
      layout: "BaseLayout",
      deepLinking: true,
      showExtensions: true,
      showCommonExtensions: true,
      tryItOutEnabled: false,
      supportedSubmitMethods: [],
    });
  </script>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const cliArgs = parseArgs();

  console.log('\n📦  JoyMini API — Swagger 文档导出工具');
  console.log('============================================\n');

  // 1. Load environment variables (like other CLI scripts)
  loadEnvForHost();
  console.log('  ℹ️  已加载环境变量\n');

  // 2. Create a ConfigService that reads from process.env (already loaded above).
  //    This is the ROOT FIX: many providers (GoogleProvider, KycProviderService,
  //    PaymentService, etc.) need ConfigService in their constructors, but
  //    ConfigModule.forRoot() doesn't propagate globally correctly when
  //    bootstrapping from a CLI script. By providing ConfigService directly,
  //    we bypass this DI issue for ALL providers at once.
  const configService = new ConfigService();

  console.log('  → 初始化 NestJS 测试模块...');

  // 3. Build NestJS testing module.
  //    We use Test.createTestingModule (from @nestjs/testing) so we can
  //    .overrideProvider() — necessary to inject our pre-created ConfigService.
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(ConfigService)
    .useValue(configService)
    // These providers initialize Firebase Admin SDK in their constructors.
    // We don't need them for Swagger doc generation, so we override with mocks.
    .overrideProvider(GoogleProvider)
    .useValue({} as any)
    .overrideProvider(FirebaseProvider)
    .useValue({} as any)
    .compile();

  // 4. Create NestJS application from the compiled module
  const app = moduleRef.createNestApplication();

  try {
    // 4. Build Swagger configuration
    const isFullExport = cliArgs.full;
    const desc = isFullExport
      ? 'REST API for web/mobile (Full endpoints including admin)'
      : 'REST API for web/mobile (Public endpoints only)';

    const swaggerCfg = new DocumentBuilder()
      .setTitle('JoyMini API — NestJS Backend Platform')
      .setDescription(desc)
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    // 5. Generate the full OpenAPI document
    console.log('  → 生成 OpenAPI 规范文档...');
    const fullDoc = SwaggerModule.createDocument(app, swaggerCfg);

    if (!fullDoc) {
      throw new Error('SwaggerModule.createDocument() returned null/undefined');
    }

    // 6. Apply filtering (unless --full mode)
    const pathCount = Object.keys(fullDoc.paths || {}).length;

    let finalDoc: Record<string, any>;
    if (isFullExport) {
      console.log('  → 模式: 完整导出（不过滤）');
      finalDoc = fullDoc as unknown as Record<string, any>;
    } else {
      console.log('  → 过滤管理后台和内部接口...');
      finalDoc = filterOpenApiDoc(fullDoc as unknown as Record<string, any>);
    }

    const filteredPathCount = Object.keys(finalDoc.paths || {}).length;
    const removedCount = pathCount - filteredPathCount;
    console.log(`     ✓ 全量路径: ${pathCount}`);
    console.log(`     ✓ 保留路径: ${filteredPathCount}`);
    if (!isFullExport) {
      console.log(`     ✓ 已过滤:   ${removedCount} (admin 后台 & 内部接口)`);
    }
    console.log('');

    // 7. Determine output directory
    const defaultDir = path.resolve(process.cwd(), 'dist/public');
    const outputDir = cliArgs.output
      ? path.resolve(process.cwd(), cliArgs.output)
      : defaultDir;
    fs.mkdirSync(outputDir, { recursive: true });

    // 8. Write swagger-spec.json
    const specPath = path.join(outputDir, 'swagger-spec.json');
    fs.writeFileSync(specPath, JSON.stringify(finalDoc, null, 2), 'utf8');
    console.log(`  ✓ 已写入: ${specPath}`);

    // 9. Write index.html (standalone Swagger UI)
    const htmlTitle = isFullExport
      ? 'JoyMini API — Full API Documentation'
      : 'JoyMini API — Public API Documentation';
    const htmlPath = path.join(outputDir, 'index.html');
    const html = generateSwaggerUiHtml('./swagger-spec.json', htmlTitle);
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log(`  ✓ 已写入: ${htmlPath}`);

    // 10. Also export YAML format for convenience
    try {
      const { stringify } = await import('yaml');
      const yamlPath = path.join(outputDir, 'swagger-spec.yaml');
      fs.writeFileSync(yamlPath, stringify(finalDoc), 'utf8');
      console.log(`  ✓ 已写入: ${yamlPath}`);
    } catch {
      console.log('  ℹ️  yaml 导出跳过（缺少 yaml 依赖）');
    }

    console.log('\n============================================');
    console.log('  🎉 导出完成！');
    console.log('  输出目录: ' + outputDir);
    console.log('  文件列表:');
    console.log('    - swagger-spec.json  (OpenAPI 3.0 JSON)');
    console.log('    - swagger-spec.yaml  (OpenAPI 3.0 YAML)');
    console.log('    - index.html         (可独立打开的 Swagger UI)');
    console.log('============================================\n');
  } finally {
    await app.close();
  }
}

main().catch((err: Error) => {
  console.error('\n❌ 导出失败:', err.message);
  console.error(err);
  process.exit(1);
});
