#!/usr/bin/env node

// 模拟整个翻译过程
function simulateTranslationProcess() {
  console.log('=== 模拟翻译过程 ===\n');
  
  // 模拟数据库中的文章（翻译前）
  const articleBefore = {
    id: 'test-id',
    title: '中文标题',
    titleEn: null,
    titleLocalized: null, // 初始为空
    excerpt: '中文摘要',
    excerptEn: null,
    excerptLocalized: null,
    content: '中文内容',
    contentEn: null,
    contentLocalized: null,
    contentMd: null,
    contentMdEn: null,
    contentMdLocalized: null,
  };
  
  console.log('翻译前的文章:');
  console.log('title:', articleBefore.title);
  console.log('titleLocalized:', articleBefore.titleLocalized);
  
  // 模拟 getSourceContent 函数
  const getSourceContent = (field, localizedField, sourceLang = 'zh') => {
    const localized = articleBefore[localizedField];
    
    // 1. 尝试从Localized字段获取
    if (localized && localized[sourceLang]) {
      const value = localized[sourceLang];
      if (typeof value === 'string') return value;
      if (typeof value === 'object' && value !== null) {
        const firstValue = Object.values(value)[0];
        if (typeof firstValue === 'string') return firstValue;
      }
    }
    
    // 2. 从原始字段获取
    const fieldValue = articleBefore[field];
    if (!fieldValue) return '';
    
    // 3. 处理JSON对象字段
    if (typeof fieldValue === 'object' && fieldValue !== null) {
      if (fieldValue[sourceLang] && typeof fieldValue[sourceLang] === 'string') {
        return fieldValue[sourceLang];
      }
      const firstValue = Object.values(fieldValue)[0];
      if (typeof firstValue === 'string') return firstValue;
      if (typeof firstValue === 'object' && firstValue !== null) {
        const deepFirstValue = Object.values(firstValue)[0];
        if (typeof deepFirstValue === 'string') return deepFirstValue;
      }
    }
    
    // 4. 直接返回字段值
    return fieldValue;
  };
  
  // 模拟翻译结果
  const titleTranslated = 'English Title';
  const excerptTranslated = 'English Excerpt';
  const contentTranslated = 'English Content';
  
  const sourceLang = 'zh';
  const targetLang = 'en';
  
  // 获取源语言内容
  const sourceTitle = getSourceContent('title', 'titleLocalized', sourceLang);
  const sourceExcerpt = getSourceContent('excerpt', 'excerptLocalized', sourceLang);
  const sourceContent = getSourceContent('content', 'contentLocalized', sourceLang);
  
  console.log('\n获取的源语言内容:');
  console.log('sourceTitle:', sourceTitle);
  console.log('sourceExcerpt:', sourceExcerpt);
  console.log('sourceContent:', sourceContent);
  
  // 模拟更新 titleLocalized 字段
  const updatedTitleLocalized = {
    ...(articleBefore.titleLocalized || {}),
    [sourceLang]: sourceTitle,
    [targetLang]: titleTranslated,
  };
  
  const updatedExcerptLocalized = {
    ...(articleBefore.excerptLocalized || {}),
    [sourceLang]: sourceExcerpt,
    [targetLang]: excerptTranslated,
  };
  
  const updatedContentLocalized = {
    ...(articleBefore.contentLocalized || {}),
    [sourceLang]: sourceLang === 'zh' ? articleBefore.content : sourceContent,
    [targetLang]: contentTranslated,
  };
  
  console.log('\n更新后的 Localized 字段:');
  console.log('titleLocalized:', JSON.stringify(updatedTitleLocalized));
  console.log('excerptLocalized:', JSON.stringify(updatedExcerptLocalized));
  console.log('contentLocalized:', JSON.stringify(updatedContentLocalized));
  
  // 检查是否包含中文
  console.log('\n检查是否包含中文:');
  console.log('titleLocalized 包含 zh?', 'zh' in updatedTitleLocalized);
  console.log('excerptLocalized 包含 zh?', 'zh' in updatedExcerptLocalized);
  console.log('contentLocalized 包含 zh?', 'zh' in updatedContentLocalized);
  
  if (!('zh' in updatedTitleLocalized)) {
    console.log('\n❌ 问题: titleLocalized 缺少中文!');
    console.log('可能的原因:');
    console.log('1. sourceTitle 为空:', !sourceTitle);
    console.log('2. sourceLang 不是 "zh":', sourceLang);
    console.log('3. articleBefore.titleLocalized 覆盖了中文值:', articleBefore.titleLocalized);
  }
}

simulateTranslationProcess();