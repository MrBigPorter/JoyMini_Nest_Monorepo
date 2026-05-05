# 翻译质量检测和自动修复系统

## 概述

翻译质量检测系统可以自动检测文章翻译的完整性，发现并修复翻译不完整、翻译错误等问题。

## 功能特性

### 1. 多维度质量检测

系统从以下7个维度检测翻译质量：

- **长度检测**: 翻译后长度不应差距过大（根据语言特性设定合理范围）
- **章节结构检测**: Markdown 标题数量应该相近
- **代码块检测**: 代码块数量必须完全一致
- **表格检测**: 表格行数应该相同
- **列表项检测**: 列表项数量应该相近
- **未翻译检测**: 检查是否还有大量中文字符（非中文语言）
- **内容相似度检测**: 翻译结果不应与原文完全相同

### 2. 自动评分

每个检测问题扣15分，满分100分，低于85分认为翻译质量不合格。

### 3. 批量处理

支持一键检测所有文章，批量投递重新翻译任务。

## API 端点

### 检测不完整翻译

```bash
GET /v1/admin/blog/translation/detect-incomplete?lang=en
Authorization: Bearer YOUR_TOKEN
```

**响应示例**:

```json
{
  "total": 50,
  "incompleteCount": 5,
  "completionRate": "90.00",
  "incompleteArticles": [
    {
      "id": "article-id-1",
      "slug": "joymini-flutter-super-app",
      "title": "JoyMini Flutter App",
      "issues": [
        "[内容] 翻译内容过短: 1234 字符 vs 原文 8765 字符 (比率 0.14)",
        "[内容] 表格行数不匹配: 翻译后 5 行 vs 原文 25 行"
      ],
      "titleCompletion": 100,
      "contentCompletion": 55,
      "needsRetranslation": true
    }
  ]
}
```

### 批量重新翻译

```bash
POST /v1/admin/blog/translation/retranslate-incomplete
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "lang": "en"
}
```

**响应示例**:

```json
{
  "message": "已投递 5 篇文章到翻译队列",
  "queued": 5,
  "incompleteArticles": [...]
}
```

## 使用方式

### 方式1: 通过浏览器控制台（最快）

1. 登录到 Admin Blog 后台
2. 打开浏览器开发者工具（F12）
3. 在控制台中执行：

```javascript
// 检测不完整翻译（英文）
const result = await blogApi.translation.detectIncompleteTranslations('en');
console.log('检测结果:', result);

// 如果发现问题，批量修复
if (result.incompleteCount > 0) {
  const fix = await blogApi.translation.retranslateIncompleteArticles('en');
  console.log('修复结果:', fix);
}
```

### 方式2: 通过 curl 命令

```bash
# 1. 获取你的 access token（从浏览器登录后的 localStorage 中获取）
TOKEN="your_access_token_here"

# 2. 检测不完整翻译
curl -X GET "https://api.joyminis.com/v1/admin/blog/translation/detect-incomplete?lang=en" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.'

# 3. 批量修复
curl -X POST "https://api.joyminis.com/v1/admin/blog/translation/retranslate-incomplete" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"lang":"en"}' \
  | jq '.'
```

### 方式3: 集成到 Admin Blog UI（可选）

系统已经提供了前端 API，可以在现有的翻译管理页面中添加按钮：

```typescript
import { blogApi } from '@/api';

// 检测按钮点击事件
const handleDetect = async () => {
  const result = await blogApi.translation.detectIncompleteTranslations('en');
  console.log('检测结果:', result);
  // 显示结果到UI
};

// 修复按钮点击事件
const handleFix = async () => {
  const result = await blogApi.translation.retranslateIncompleteArticles('en');
  console.log('修复结果:', result);
  // 显示成功消息
};
```

## 检测标准

### 各语言长度比率范围

| 语言 | 最小比率 | 最大比率 | 说明 |
|------|---------|---------|------|
| en | 0.8 | 2.5 | 英文通常比中文长 |
| ja | 0.5 | 1.5 | 日文较紧凑 |
| ko | 0.6 | 1.8 | 韩文中等 |
| fr | 0.9 | 2.0 | 法文略长 |
| de | 0.8 | 2.2 | 德文略长 |
| 其他 | 0.3 | 3.0 | 默认范围 |

### 容忍度设置

- 标题数量：允许缺少20%
- 表格行数：允许误差2行
- 列表项：允许误差20%
- 中文字符：不超过30%

## 常见问题

### Q: 为什么我的文章被标记为不完整？

A: 检查返回的 `issues` 字段，可以看到具体的问题描述，例如内容过短、表格缺失等。

### Q: 重新翻译会覆盖现有翻译吗？

A: 是的，批量重新翻译会覆盖现有的英文翻译。建议先检查检测结果，确认是误判还是真的需要重新翻译。

### Q: 翻译任务什么时候完成？

A: 任务会投递到队列中，每篇文章间隔600ms处理。你可以通过翻译进度页面查看实时状态。

### Q: 如何只修复特定文章？

A: 可以使用现有的 `fixTranslationIssuesBatch` API，传入具体的 `articleIds`：

```javascript
await blogApi.translation.fixTranslationIssuesBatch({
  articleIds: ['article-id-1', 'article-id-2'],
  languageCode: 'en',
});
```

## 技术实现

### 后端方法

- `BlogService.detectTranslationQuality()`: 单篇文章质量检测
- `BlogService.detectIncompleteTranslations()`: 批量检测
- `BlogService.retranslateIncompleteArticles()`: 批量重新翻译

### 前端 API

- `blogApi.translation.detectIncompleteTranslations()`
- `blogApi.translation.retranslateIncompleteArticles()`

## 日志示例

检测完成后会在后端日志中看到：

```
[BlogService] 批量检测所有文章的翻译质量
[BlogService] 发现 5 篇文章需要重新翻译
[BlogService] 已投递 5 篇文章到翻译队列
```

## 监控和维护

建议定期（每周）运行一次检测：

```bash
# 添加到 cron 或定时任务
0 0 * * 0 curl -X GET "https://api.joyminis.com/v1/admin/blog/translation/detect-incomplete?lang=en" \
  -H "Authorization: Bearer $TOKEN" \
  > /var/log/translation-check.log
```

## 相关文档

- [翻译系统架构](./TRANSLATION_ARCHITECTURE.md)
- [AI 服务配置](./AI_SERVICE_CONFIG.md)
- [翻译监控指南](./TRANSLATION_MONITORING_IMPROVEMENT.md)

