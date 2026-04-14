#!/usr/bin/env node

// 模拟 getSourceContent 函数的逻辑
function getSourceContent(field, localizedField, article, sourceLang) {
  const articleAny = article;
  const localized = articleAny[localizedField];

  console.log(`\n获取 ${field} (${localizedField}), sourceLang: ${sourceLang}`);
  console.log(`localized 字段:`, localized);

  // 1. 尝试从Localized字段获取
  if (localized && localized[sourceLang]) {
    const value = localized[sourceLang];
    console.log(`从 localized[${sourceLang}] 获取值:`, value);
    // 如果是字符串，直接返回
    if (typeof value === 'string') return value;
    // 如果是对象，尝试提取字符串值
    if (typeof value === 'object' && value !== null) {
      // 处理嵌套错误格式：{ en: { zh: "..." } }
      const firstValue = Object.values(value)[0];
      if (typeof firstValue === 'string') return firstValue;
    }
  }

  // 2. 从原始字段获取
  const fieldValue = articleAny[field];
  console.log(`从原始字段 ${field} 获取值:`, fieldValue);
  if (!fieldValue) return '';

  // 3. 处理JSON对象字段
  if (typeof fieldValue === 'object' && fieldValue !== null) {
    // 从JSON对象中提取源语言值
    if (
      fieldValue[sourceLang] &&
      typeof fieldValue[sourceLang] === 'string'
    ) {
      return fieldValue[sourceLang];
    }
    // 如果没有源语言，尝试获取第一个字符串值
    const firstValue = Object.values(fieldValue)[0];
    if (typeof firstValue === 'string') return firstValue;
    // 如果第一个值也是对象，继续深入提取
    if (typeof firstValue === 'object' && firstValue !== null) {
      const deepFirstValue = Object.values(firstValue)[0];
      if (typeof deepFirstValue === 'string') return deepFirstValue;
    }
  }

  // 4. 直接返回字段值
  return fieldValue;
}

// 测试场景1：titleLocalized为空，title有中文值
console.log('=== 测试场景1: titleLocalized为空 ===');
const article1 = {
  title: '中文标题',
  titleLocalized: null,
};
const sourceTitle1 = getSourceContent('title', 'titleLocalized', article1, 'zh');
console.log(`结果: ${sourceTitle1}`);

// 测试场景2：titleLocalized有英文，title有中文值
console.log('\n=== 测试场景2: titleLocalized有英文 ===');
const article2 = {
  title: '中文标题',
  titleLocalized: { en: 'English Title' },
};
const sourceTitle2 = getSourceContent('title', 'titleLocalized', article2, 'zh');
console.log(`结果: ${sourceTitle2}`);

// 测试场景3：titleLocalized有中文和英文
console.log('\n=== 测试场景3: titleLocalized有中文和英文 ===');
const article3 = {
  title: '中文标题',
  titleLocalized: { zh: '中文标题', en: 'English Title' },
};
const sourceTitle3 = getSourceContent('title', 'titleLocalized', article3, 'zh');
console.log(`结果: ${sourceTitle3}`);