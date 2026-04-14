#!/usr/bin/env node

// 测试修复后的翻译逻辑
function testFixedTranslationLogic() {
  console.log('=== 测试修复后的翻译逻辑 ===\n');
  
  // 模拟文章数据
  const article = {
    id: 'test-id',
    title: '中文标题',
    titleEn: null,
    titleLocalized: null,
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
  
  const sourceLang = 'zh';
  const targetLang = 'en';
  
  // 模拟 getSourceContent 函数
  const getSourceContent = (field, localizedField) => {
    const localized = article[localizedField];
    
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
    const fieldValue = article[field];
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
  
  // 修复后的逻辑：获取原始语言内容，确保总是有值
  const sourceTitle = getSourceContent('title', 'titleLocalized') || article.title || '';
  const sourceContent = getSourceContent('contentMd', 'contentMdLocalized') ||
    getSourceContent('content', 'contentLocalized') || 
    article.content || '';
  const sourceExcerpt = getSourceContent('excerpt', 'excerptLocalized') || article.excerpt || '';
  
  console.log('获取的源语言内容:');
  console.log('sourceTitle:', sourceTitle);
  console.log('sourceContent:', sourceContent);
  console.log('sourceExcerpt:', sourceExcerpt);
  
  // 模拟翻译结果
  const titleTranslated = 'English Title';
  const contentTranslated = 'English Content';
  const excerptTranslated = 'English Excerpt';
  
  // 修复后的更新逻辑
  const updateData = {};
  
  // titleLocalized - 多重回退确保有值
  updateData.titleLocalized = {
    ...(article.titleLocalized || {}),
    [sourceLang]: sourceTitle || article.title || '',
    [targetLang]: titleTranslated,
  };
  
  // contentMdLocalized - 多重回退
  updateData.contentMdLocalized = {
    ...(article.contentMdLocalized || {}),
    [sourceLang]: sourceContent || article.contentMd || article.content || '',
    [targetLang]: contentTranslated,
  };
  
  // contentLocalized
  updateData.contentLocalized = {
    ...(article.contentLocalized || {}),
    [sourceLang]: sourceLang === 'zh' ? article.content : sourceContent,
    [targetLang]: contentTranslated,
  };
  
  // excerptLocalized - 确保有值
  updateData.excerptLocalized = {
    ...(article.excerptLocalized || {}),
    [sourceLang]: sourceExcerpt || article.excerpt || '',
    [targetLang]: excerptTranslated,
  };
  
  console.log('\n更新后的 Localized 字段:');
  console.log('titleLocalized:', JSON.stringify(updateData.titleLocalized));
  console.log('excerptLocalized:', JSON.stringify(updateData.excerptLocalized));
  console.log('contentLocalized:', JSON.stringify(updateData.contentLocalized));
  console.log('contentMdLocalized:', JSON.stringify(updateData.contentMdLocalized));
  
  // 验证是否包含中文
  console.log('\n验证结果:');
  console.log('titleLocalized 包含 zh?', 'zh' in updateData.titleLocalized);
  console.log('titleLocalized zh 值:', updateData.titleLocalized.zh);
  console.log('excerptLocalized 包含 zh?', 'zh' in updateData.excerptLocalized);
  console.log('excerptLocalized zh 值:', updateData.excerptLocalized.zh);
  console.log('contentLocalized 包含 zh?', 'zh' in updateData.contentLocalized);
  console.log('contentLocalized zh 值:', updateData.contentLocalized.zh ? '有值' : '空');
  
  // 测试边界情况：空标题
  console.log('\n=== 测试边界情况：空标题 ===');
  const articleEmptyTitle = {
    ...article,
    title: '',
    titleLocalized: { en: 'Existing English Title' }
  };
  
  const sourceTitle2 = getSourceContent('title', 'titleLocalized') || articleEmptyTitle.title || '';
  console.log('空标题情况:');
  console.log('article.title:', articleEmptyTitle.title);
  console.log('article.titleLocalized:', articleEmptyTitle.titleLocalized);
  console.log('sourceTitle2:', sourceTitle2);
  
  const updateData2 = {
    titleLocalized: {
      ...(articleEmptyTitle.titleLocalized || {}),
      [sourceLang]: sourceTitle2 || articleEmptyTitle.title || '',
      [targetLang]: titleTranslated,
    }
  };
  
  console.log('更新后的 titleLocalized:', JSON.stringify(updateData2.titleLocalized));
  console.log('包含 zh?', 'zh' in updateData2.titleLocalized);
  console.log('zh 值:', updateData2.titleLocalized.zh);
}

testFixedTranslationLogic();