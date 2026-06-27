import {
  getFieldMetasByClassName,
  getFieldMetaKeysByClassName,
  getLocalizedValue,
  type Locale,
} from '@lucky/shared';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';

const logger = new Logger('ApplyFieldMeta');

/**
 * Phase 2: 将 @FieldMeta 元数据注入 Swagger Schema description
 *
 * 执行时机：SwaggerModule.createDocument() 之后、SwaggerModule.setup() 之前
 *
 * 效果：
 * - 有 @FieldMeta.label 的字段 → description 自动填充中文/多语言标签
 * - 有 @FieldMeta.enum 的字段 → description 追加枚举值说明（如 "1=待支付, 2=支付中..."）
 * - 没有 @FieldMeta 的字段 → 保持原有 @ApiProperty.description 不变
 *
 * 无需 DTO 注册表：通过 `classNameMetadata` 按类名字符串查找元数据。
 *
 * @param document - Swagger OpenAPIObject（由 createDocument 生成）
 * @param locale  - 输出语言，默认 'zh'
 *
 * @example
 * ```typescript
 * applyFieldMetaToSwagger(doc, 'zh');
 * ```
 */
export function applyFieldMetaToSwagger(
  document: OpenAPIObject,
  locale: Locale = 'zh',
): void {
  const schemas = (document as any).components?.schemas;
  if (!schemas) {
    logger.warn('No schemas found in Swagger document, skipping.');
    return;
  }

  for (const [schemaName, schema] of Object.entries(schemas) as [string, any][]) {
    // 跳过 $ref 类型的 schema（不包含 inline properties）
    if (schema.$ref || !schema.properties) continue;

    // ★ 通过 classNameMetadata 直接按类名查找，无需 DTO 注册表
    const fieldMetaMap = getFieldMetasByClassName(schemaName);
    if (!fieldMetaMap) continue;

    let patchedCount = 0;

    for (const [key, meta] of fieldMetaMap) {

      const prop = schema.properties[key];
      if (!prop || typeof prop !== 'object') continue;

      const label = getLocalizedValue(meta.label, locale) ?? key;

      // ★ 1. 构造 description：标签 + 枚举值说明
      if (meta.enum) {
        const enumDescriptions = Object.entries(meta.enum)
          .map(([val, labels]) => `${val}=${getLocalizedValue(labels as any, locale)}`)
          .join(', ');
        prop.description = `${label} (${enumDescriptions})`;
      } else {
        prop.description = label;
      }

      // ★ 2. 注入示例值（如果标记了且 schema 没有已有 example）
      if (meta.example !== undefined && prop.example === undefined) {
        prop.example = meta.example;
      }

      // ★ 3. 注入 x-field-meta OpenAPI Extension（保留结构化元数据）
      //    供 gen-types 脚本读取，Swagger UI 自动忽略 x- 前缀字段
      const xFieldMeta: Record<string, unknown> = {
        label: meta.label,
      };
      if (meta.type) xFieldMeta.type = meta.type;
      if (meta.enum) xFieldMeta.enum = meta.enum;
      if (meta.example !== undefined) xFieldMeta.example = meta.example;
      prop['x-field-meta'] = xFieldMeta;

      patchedCount++;
    }

    if (patchedCount > 0) {
      logger.log(
        `Schema "${schemaName}": patched ${patchedCount} field(s) from @FieldMeta`,
      );
    }
  }
}
