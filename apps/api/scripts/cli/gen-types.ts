/**
 * Phase 3 Boost: gen-types — 从 Swagger JSON（x-field-meta）生成前端类型定义
 * =======================================================================
 *
 * 不再 import 任何 DTO 类。改为读取导出好的 swagger-spec.json，
 * 遍历所有 schema 的 x-field-meta OpenAPI Extension，自动生成类型文件。
 *
 * 用法:
 *   # 先导出含 x-field-meta 的 Swagger JSON
 *   yarn workspace @lucky/api export:swagger:full
 *
 *   # 再生成类型
 *   yarn workspace @lucky/api gen-types
 *
 * 效果:
 *   packages/shared/src/types/gen/
 *     order-item-dto.generated.ts   — OrderItemDto 字段元数据（自动发现）
 *
 * 优势:
 *   - 零 DTO import，新增 DTO 不需要修改此文件
 *   - 自动发现所有带 x-field-meta 的 schema
 *   - DTO 只需添加 @FieldMeta 装饰器，自动按类名注册
 * =======================================================================
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

// ========================================
//  配置
// ========================================

/** 默认 Swagger JSON 路径（export:swagger:full 的输出位置） */
const DEFAULT_SWAGGER_PATH = resolve(
  __dirname,
  '../../../../apps/swagger-docs/swagger-spec.json',
);

/** 输出目录（packages/shared/src/types/gen/） */
const OUTPUT_DIR = resolve(
  __dirname,
  '../../../../packages/shared/src/types/gen',
);

// ========================================
//  CLI 参数解析
// ========================================

function parseArgs(): { swaggerPath: string } {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--swagger-path');
  const swaggerPath =
    idx !== -1 && idx + 1 < args.length
      ? resolve(process.cwd(), args[idx + 1])
      : DEFAULT_SWAGGER_PATH;
  return { swaggerPath };
}

// ========================================
//  序列化辅助函数
// ========================================

/** 将 JS 值序列化为 TypeScript 字面量 */
function toTSLiteral(value: unknown, indent = 2): string {
  const pad = '  '.repeat(indent);

  if (value === null || value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => toTSLiteral(v, indent + 1));
    return `[\n${pad}  ${items.join(`,\n${pad}  `)},\n${pad}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const props = entries.map(([k, v]) => `${k}: ${toTSLiteral(v, indent + 1)}`);
    return `{\n${pad}  ${props.join(`,\n${pad}  `)},\n${pad}}`;
  }

  return String(value);
}

/** 将 x-field-meta 条目序列化为 TypeScript 对象字面量 Record<string, FieldMetaEntry> */
function serializeFields(
  props: Record<string, any>,
): string {
  const fields: string[] = [];

  for (const [key, prop] of Object.entries(props)) {
    const meta = prop['x-field-meta'];
    if (!meta) continue;

    const fieldObj: Record<string, unknown> = {
      label: meta.label,
    };

    if (meta.type) fieldObj.type = meta.type;
    if (meta.enum) fieldObj.enum = meta.enum;
    if (meta.example !== undefined) fieldObj.example = meta.example;

    fields.push(`  ${JSON.stringify(key)}: ${toTSLiteral(fieldObj, 2)}`);
  }

  return `{\n${fields.join(',\n')},\n}`;
}

// ========================================
//  文件生成
// ========================================

/** 将 schema 名称转为文件名（大驼峰 → 中划线） */
function schemaToFileName(schemaName: string): string {
  return schemaName
    .replace(/([A-Z])/g, '-$1')
    .replace(/^-/, '')
    .toLowerCase();
}

/** 将 schema 名称转为导出常量名（大驼峰 → 大写蛇形） */
function schemaToExportName(schemaName: string): string {
  return schemaName
    .replace(/([A-Z])/g, '_$1')
    .replace(/^_/, '')
    .toUpperCase()
    + '_FIELDS';
}

function generate() {
  const { swaggerPath } = parseArgs();

  // 1. 读取 Swagger JSON
  if (!existsSync(swaggerPath)) {
    console.error(`❌ 找不到 Swagger JSON: ${swaggerPath}`);
    console.error('   请先运行: yarn workspace @lucky/api export:swagger:full');
    process.exit(1);
  }

  const raw = readFileSync(swaggerPath, 'utf-8');
  let doc: Record<string, any>;
  try {
    doc = JSON.parse(raw);
  } catch {
    console.error('❌ Swagger JSON 解析失败，请检查文件格式');
    process.exit(1);
  }

  const schemas = doc.components?.schemas || {};
  const schemaEntries = Object.entries(schemas) as [string, any][];

  // 2. 确保输出目录存在
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let totalFiles = 0;
  let totalFields = 0;

  // 3. 遍历每个 schema，找有 x-field-meta 的属性
  for (const [schemaName, schema] of schemaEntries) {
    if (schema.$ref || !schema.properties) continue;

    const props = schema.properties as Record<string, any>;
    const fieldKeys = Object.keys(props).filter(
      (k) => props[k] && props[k]['x-field-meta'],
    );

    if (fieldKeys.length === 0) continue;

    // 生成文件名和导出常量名
    const fileName = schemaToFileName(schemaName);
    const exportName = schemaToExportName(schemaName);
    const description = `${schemaName} 字段元数据`;

    const timestamp = new Date().toISOString();
    const metaContent = serializeFields(props);

    const fileContent = `// Auto-generated by gen-types. Do not edit manually.
// Generated at: ${timestamp}

import type { LocalizedString } from '../localized-string';

// ========================================
//  TypeScript field metadata entry
// ========================================
export interface FieldMetaEntry {
  /** 多语言标签 */
  label: LocalizedString<string>;
  /** 语义类型 */
  type?: 'string' | 'number' | 'date' | 'amount';
  /** 枚举值映射 */
  enum?: Record<number, LocalizedString<string>>;
  /** 示例值 */
  example?: unknown;
}

// ========================================
//  ${description}
// ========================================
/** ${description} */
export const ${exportName}: Record<string, FieldMetaEntry> = ${metaContent};
`;

    const outputPath = resolve(OUTPUT_DIR, `${fileName}.generated.ts`);
    writeFileSync(outputPath, fileContent, 'utf-8');
    console.log(`✅  ${fileName}.generated.ts (${fieldKeys.length} fields)`);
    totalFiles++;
    totalFields += fieldKeys.length;
  }

  if (totalFiles === 0) {
    console.log('ℹ️  没有找到带 x-field-meta 的 schema，没有文件生成。');
  } else {
    console.log(`\n🎉 类型生成完成！${totalFiles} 个文件，${totalFields} 个字段`);
  }
}

generate();
