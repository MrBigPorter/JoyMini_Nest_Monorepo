import { OpenAPIObject } from '@nestjs/swagger';

// 跟你拦截器里一样的 toSnake
function toSnake(str: string): string {
  return str
    .replace(/([A-Z]+)/g, '_$1')
    .replace(/^_/, '')
    .replace(/__/g, '_')
    .toLowerCase();
}

function processSchema(schema: any) {
  if (!schema || typeof schema !== 'object') return;

  // 处理当前 schema 的 properties
  if (
    Object.prototype.hasOwnProperty.call(schema, 'properties') &&
    schema.properties &&
    typeof schema.properties === 'object'
  ) {
    const newProps: Record<string, any> = {};
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const snakeKey = /[A-Z]/.test(key) ? toSnake(key) : key;
      newProps[snakeKey] = propSchema;
      processSchema(propSchema); // 递归子 schema
    }
    schema.properties = newProps;

    // required 字段名也要改
    if (Array.isArray(schema.required)) {
      schema.required = schema.required.map((k: any) =>
        typeof k === 'string' && /[A-Z]/.test(k) ? toSnake(k) : k,
      );
    }
  }

  // 处理数组 / 组合类型里的子 schema
  if (schema.items) processSchema(schema.items);
  if (Array.isArray(schema.allOf)) schema.allOf.forEach(processSchema);
  if (Array.isArray(schema.oneOf)) schema.oneOf.forEach(processSchema);
  if (Array.isArray(schema.anyOf)) schema.anyOf.forEach(processSchema);
}

export function camelSwaggerToSnake(doc: OpenAPIObject) {
  // 1) components.schemas 里的 DTO 属性名改成 snake_case
  if (doc.components?.schemas) {
    for (const schema of Object.values(doc.components.schemas)) {
      processSchema(schema);
    }
  }

  // 2) paths 里的 query/path 参数名也改成 snake_case
  if (doc.paths) {
    for (const pathItem of Object.values(doc.paths)) {
      for (const method of Object.values<any>(pathItem ?? {})) {
        const params: any[] = method.parameters;
        if (!Array.isArray(params)) continue;
        for (const p of params) {
          if (typeof p.name === 'string' && /[A-Z]/.test(p.name)) {
            p.name = toSnake(p.name);
          }
        }
      }
    }
  }
}
