# M1 Architecture: LLM Integration + Prompt Engineering

## Goal

Add an "AI Generate Titles" feature: user pastes article content → AI returns 3 title suggestions.

## Data Flow

```
[Admin Blog Editor]
  ↓ POST /blog/ai/generate-titles  { content: "...", style: "seo" }
[BlogController.generateTitles()]
  ↓
[PromptTemplateService.buildTitlePrompt()]
  → systemPrompt: "You are an SEO title expert..."
  → userPrompt: "Generate 3 titles for: ${content}"
  ↓
[AiService.generateText(systemPrompt, userPrompt, { temperature: 0.7 })]
  ↓ (LLM returns raw string)
[TitleResponseDto] ← Zod parse & validate
  ↓
[Admin Blog Editor] ← shows 3 titles, user clicks to select
```

## Files to Create

### 1. `apps/api/src/blog/dto/generate-titles.dto.ts` — Request DTO

```typescript
import { IsString, IsOptional, IsIn } from 'class-validator';

export class GenerateTitlesDto {
  @IsString()
  content: string;

  @IsOptional()
  @IsIn(['seo', 'creative', 'simple'])
  style?: 'seo' | 'creative' | 'simple';
}
```

### 2. `apps/api/src/blog/dto/title-response.dto.ts` — Response DTO

```typescript
export class TitleSuggestionDto {
  title: string;
  reason: string;  // why this title works
}

export class GenerateTitlesResponseDto {
  titles: TitleSuggestionDto[];
  model: string;
  latencyMs: number;
}
```

### 3. `apps/api/src/blog/services/prompt-template.service.ts` — New service

Manages system/user prompt templates.

```typescript
@Injectable()
export class PromptTemplateService {
  private readonly templates = {
    'generate-titles': {
      system: (style: string) => `You are an expert blog title writer. Style: ${style}...`,
      user: (content: string) => `Generate 3 titles for:\n\n${content}\n\nReturn JSON: [{title, reason}]`,
    },
  };

  build(s TemplateType, params: Record<string, any>): { systemPrompt: string; userPrompt: string } {
    // ...
  }
}
```

### 4. Modify `apps/api/src/blog/blog.controller.ts` — Add endpoint

```
POST /blog/ai/generate-titles
  Auth: AdminJwtAuthGuard
  Body: GenerateTitlesDto
  Returns: GenerateTitlesResponseDto
```

### 5. Modify `apps/admin-blog/src/views/blog/BlogArticleModal.tsx` — Add button

- "AI 生成标题" button next to title input
- Loading state while generating
- Shows 3 title cards with reasons
- Click a card → fills title input

## Key Learning Points

| Concept | What you'll learn |
|---------|------------------|
| **System Prompt** | Instructions to the AI that define its role/behavior. Static per request. |
| **User Prompt** | The actual input/question. Dynamic per request. |
| **Temperature** | 0.0 = deterministic, 1.0 = creative. SEO titles → 0.3, creative → 0.8 |
| **MaxTokens** | Max output length. Titles only need 100 tokens. |
| **Non-determinism** | Same input → different output every time. That's why we retry on parse error. |

## Why This Architecture?

1. **Separate PromptTemplateService** → M2 will add more templates, keeps it clean
2. **DTO validation** → Follows existing NestJS patterns
3. **Via AiService** → Reuses existing circuit breaker, rate limit, key rotation
4. **Frontend minimal** → Just a button + API call, no new page needed

## Interview Questions This Module Answers

- "你怎么设计 prompt 的？system prompt 和 user prompt 有什么区别？"
- "temperature 怎么调？什么场景用高/低 temperature？"
- "LLM 返回格式你怎么保证？"
