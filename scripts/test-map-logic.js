#!/usr/bin/env node

// 模拟 mapArticleToLocalized 方法的逻辑
function testMapArticleToLocalized() {
  // 模拟数据库中的文章数据
  const article = {
    id: "test-id",
    title: "中文标题",
    titleEn: null,
    titleLocalized: { en: "English Title" },
    excerpt: "中文摘要",
    excerptEn: null,
    excerptLocalized: { en: "English Excerpt" },
    content: "中文内容",
    contentEn: null,
    contentLocalized: { en: "English Content" },
  };

  const fields = ["title", "excerpt"];
  const allLocales = ["zh", "en", "ja", "ko", "fr", "de"];

  const result = { ...article };

  for (const field of fields) {
    console.log(`\n处理字段: ${field}`);
    const fieldValue = article[field];
    console.log(`原始字段值: ${fieldValue}`);

    let localizedObject = {};

    // 如果字段已经是对象格式（包含多语言），直接使用
    if (fieldValue && typeof fieldValue === "object" && fieldValue !== null) {
      localizedObject = { ...fieldValue };
    }

    // 优先从 Localized 字段取值（补充缺失的语言）
    if (result[`${field}Localized`]) {
      console.log(`从 ${field}Localized 合并:`, result[`${field}Localized`]);
      Object.assign(localizedObject, result[`${field}Localized`]);
    }

    // 合并所有独立字段，优先级更高（覆盖Localized字段）
    for (const loc of allLocales) {
      const suffix =
        loc === "zh" ? "" : loc.charAt(0).toUpperCase() + loc.slice(1);
      const dbValue = article[`${field}${suffix}`];

      console.log(`检查 ${field}${suffix}: ${dbValue}`);

      if (dbValue !== null && dbValue !== undefined) {
        localizedObject[loc] = dbValue;
        console.log(`  设置 localizedObject[${loc}] = ${dbValue}`);
      }
    }

    console.log(`最终 localizedObject:`, localizedObject);

    // 检查中文是否在 localizedObject 中
    if (localizedObject["zh"]) {
      console.log(` localizedObject 包含中文: ${localizedObject["zh"]}`);
    } else {
      console.log(`❌ localizedObject 缺少中文!`);
    }
  }
}

testMapArticleToLocalized();
