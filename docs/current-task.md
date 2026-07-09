# Current Task — P1: 双引擎并行解析 + LLM Diff 审计

**目标**: PdfExtractor 改为并行执行两个引擎，DeepSeek 对比选优  
**参考文档**: `docs/AI-joymini/61-Enterprise-Parse-QA-Implementation-Plan.md` §3  
**Last Update**: 2026-07-09

---

## 📋 Propose

### 目标
当前 PdfExtractor 串行执行（Unstructured → fallback pdf-parse），只得到一个结果。改为并行执行，两个结果都保留，让 DeepSeek 对比选择最优。

### 受影响的文件

| # | 文件 | 改动 |
|---|------|------|
| 1 | `apps/api/src/admin/rag/rag-sync.service.ts` | PdfExtractor.extract() 改为 Promise.all 并行；注入 AiService |
| 2 | `apps/api/src/admin/rag/rag-quality.service.ts` | 新增 llmDiffAudit() 方法 + DiffAuditResult 接口 |
| 3 | `apps/admin-next/src/components/knowledge/QualityReviewPanel.tsx` | 显示 LLM 评分 + 两个引擎对比详情 |
| 4 | `apps/admin-next/src/components/knowledge/QualityReviewPanel.tsx` | PDF 预览由 iframe 改为 embed，去掉浏览器 PDF 侧栏 |

### 实现细节

**rag-sync.service.ts — PdfExtractor 改造**：
```typescript
class PdfExtractor implements TextExtractor {
  constructor(private readonly aiService: AiService) {}

  async extract(file: Express.Multer.File): Promise<ExtractedDoc> {
    const title = file.originalname.replace(/\.pdf$/i, '');

    // 并行执行两个引擎
    const [unstructuredResult, pdfParseResult] = await Promise.all([
      this.extractWithUnstructured(file).catch(() => null),
      this.extractWithPdfParse(file).catch(() => null),
    ]);

    // 都失败
    if (!unstructuredResult && !pdfParseResult) {
      throw new BadRequestException('...');
    }

    // 只有一个成功
    if (!unstructuredResult || !pdfParseResult) {
      return { title, content: unstructuredResult || pdfParseResult!, ... };
    }

    // 两个都成功 → LLM Diff 审计
    const diffResult = await this.llmDiffAudit(unstructuredResult, pdfParseResult);
    return {
      title,
      content: diffResult.selectedContent,
      metadata: {
        qualityScore: diffResult.score * 20,
        qualityFlags: diffResult.issues.join(','),
        engineAResult: unstructuredResult.slice(0, 500),  // 前端展示用
        engineBResult: pdfParseResult.slice(0, 500),
      },
    };
  }
}
```

**rag-sync.service.ts — 构造函数改动**：
```typescript
// PdfExtractor 不再是内部类，需要注入 AiService
// 方案：在 RagSyncService 中创建 PdfExtractor 时传入
this.extractors = [
  new MarkdownExtractor(),
  new PdfExtractor(aiService),  // 传入 AiService
];
```

**rag-quality.service.ts — 新增方法**：
```typescript
async llmDiffAudit(engineA: string, engineB: string): Promise<{
  selected: 'A' | 'B';
  selectedContent: string;
  score: number;
  reasoning: string;
  issues: string[];
  verdict: 'approved' | 'needs_review';
}> {
  const prompt = `...`;  // 见文档 60 的 prompt 模板
  const response = await this.aiService.generateText(prompt);
  return JSON.parse(response);
}
```

### 验收标准

- [ ] PDF 上传时两个引擎同时执行（耗时 ≈ max(A, B) 不是 A+B）
- [ ] 两个引擎都成功时调用 DeepSeek 做 Diff 审计
- [ ] LLM 选择最优结果作为 content 入库
- [ ] LLM 输出非 JSON 时降级使用 Unstructured 结果
- [ ] LLM 调用超时（15s）时降级使用 Unstructured 结果
- [ ] 只有一个引擎成功时直接使用，不调用 LLM
- [ ] 两个引擎都失败时报错
- [ ] TypeScript 编译无错误
- [ ] Docker 容器重启后功能正常

---

## Apply

确认后通过 `new_task` 启动 Code 模式子任务实施。
