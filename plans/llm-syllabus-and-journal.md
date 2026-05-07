# 📚 LLM 应用实战 — 课表 & 学习记录

> 基于博客系统，从易到难构建真正的大模型应用。
> 每个模块 = 5分钟概念 + 直接写代码。

---

## 一、总课表

| # | 模块 | 做什么 | 新学概念 | 新学技术 | 求职价值 |
|---|------|--------|---------|---------|---------|
| **M1** | LLM集成+Prompt | AI生成SEO元数据 | Token, Prompt设计, 角色/温度参数 | 无（调AiService） | ⭐⭐⭐ |
| **M2** | 结构化输出 | AI建议标签/分类 | JSON Schema, Function Calling | Zod | ⭐⭐⭐⭐ |
| **M3** | 向量检索 | 语义搜索 | Embedding, 向量相似度 | **pgvector** | ⭐⭐⭐⭐⭐ |
| **M4** | RAG问答 | 文章底部"问AI" | RAG Pipeline, 分块策略, 混合检索 | - | ⭐⭐⭐⭐⭐ |
| **M5** | SSE流式 | AI打字机效果 | 流式输出, EventSource | SSE（已有模式） | ⭐⭐⭐⭐ |
| **M6** | 聊天助手 | 浮动AI对话 | 多轮对话, 会话管理, Redis | - | ⭐⭐⭐⭐⭐ |
| **M7** | Tool Use | AI能搜索/推荐 | Function Calling, 工具注册 | - | ⭐⭐⭐⭐⭐ |
| **M8** | Multi-Agent | AI内容工坊(自动写文章) | Agent编排, 任务分解, 通信协议 | BullMQ（已有） | ⭐⭐⭐⭐⭐⭐ |
| **M9** | 质量评估 | 自动审核AI生成内容 | LLM-as-a-Judge, 评估维度 | - | ⭐⭐⭐⭐ |
| **M10** | 生产部署 | 监控+成本+降级 | 成本控制, 缓存, 监控 | - | ⭐⭐⭐⭐ |

---

## 二、学习记录（每天更新）

### 使用方式

每次开始学习前，打开这个文件看：
1. 当前进度（上次做到哪了）
2. 今天要做的模块
3. 打开对应模块的"精华参考"

每次学习结束后，更新：
1. ✅ 完成了什么
2. 📝 学到了什么
3. ❓ 还有疑问的

---

### 进度追踪

```
开始日期: [TODO 填日期]

当前模块: M0 — 准备阶段
完成模块: 
  [ ] M1 — LLM集成+Prompt
  [ ] M2 — 结构化输出
  [ ] M3 — 向量检索
  [ ] M4 — RAG问答
  [ ] M5 — SSE流式
  [ ] M6 — 聊天助手
  [ ] M7 — Tool Use
  [ ] M8 — Multi-Agent
  [ ] M9 — 质量评估
  [ ] M10 — 生产部署
```

### 学习日志

#### 第 1 次 — [日期]

```
今日目标:
  [ ] 

完成情况:
  ✅ 

学到的东西:
  • 
  • 

疑问:
  ❓ 

下次开始:
  → 从 [xxx] 继续
```

---

## 三、各模块精华参考

> 每个模块我只列**最核心的3-5个概念**，看完就能写代码。
> 不需要去读LangChain文档/OpenAI文档/论文。

---

### M1: LLM 集成 + Prompt Engineering

**你需要知道的（5分钟）:**

```
LLM = 一个"超级文字接龙机器"
  你输入: "中国的首都是"
  它输出: "北京"  ← 因为它见过无数文本里"中国的首都是北京"

你通过 Prompt（提示词）来控制它接龙的方向:
  普通: "写一篇关于React的文章"
  → 可能写什么都有可能
  
  好Prompt: "你是一个技术博客作者。请写一篇面向初中级前端开发者的React入门文章，要求:
              1. 从为什么需要React开始
              2. 包含一个计数器组件示例
              3. 用中文，1000字以内"
  → 角色+受众+要求+格式，输出可控

三个核心参数:
  1. Temperature (0-2): 0=每次都一样(保守), 1=有创意(默认), 2=乱来
  2. Max Tokens: 限制AI最多输出多少个字
  3. System Prompt: 给AI设定角色和规则的"系统指令"
```

**你项目的 AiService 已经封装好了:**

```typescript
// 你不需要懂HTTP调用，直接用
const result = await this.aiService.generateText({
  system: "你是一个技术博客的SEO专家",  // 角色设定
  prompt: "为这篇文章生成SEO元数据...",  // 任务指令
  temperature: 0.3,                     // 低温度=稳定输出
  maxTokens: 500                        // 限制长度
});
```

**精华参考（就看这2个）:**

| 概念 | 一句话理解 | 怎么用 |
|------|-----------|-------|
| Token | AI的"字数统计单位" | 1个中文≈2 tokens, 1000 tokens≈500字 |
| Temperature | 控制AI的"创造性" | SEO用0.3(稳定), 写故事用0.8(有创意) |
| System Prompt | 给AI定"人设" | "你是一个技术博客作者，精通中文技术写作" |

**你的项目中已经有的参考代码:**

- `apps/api/src/common/ai/ai.service.ts:363` — `generateText()` 方法，直接调
- `apps/api/src/blog/processors/blog-ai.processor.ts:772` — 翻译prompt，参考其system/user/assistant结构

---

### M2: 结构化输出

**你需要知道的（5分钟）:**

```
问题: AI返回的是"自由文本"，你不能保证它返回JSON格式
      你说"给我JSON"，它可能返回:
      ```json
      { "tags": [...] }
      ```
      也可能返回: 好的，这是你要的JSON：{ tags: [...] }

解决方案: 用 Function Calling / Zod Schema 约束输出

原理: 
  你: "我需要的输出格式是: {tags: string[], confidence: number}"
  同时给AI一个Zod schema
  AI: "好的，我只按这个格式输出"
  → 100% 保证返回合法JSON
```

**精华参考:**

| 概念 | 一句话理解 | 怎么用 |
|------|-----------|-------|
| JSON Schema | 定义"AI必须按这个格式返回" | 用Zod定义，AI填充 |
| Function Calling | 告诉AI"这是一个函数，你填参数" | 本质和Schema一样 |
| Retry逻辑 | AI格式不对？让它重新生成 | 最多重试3次 |

---

### M3: 向量检索

**你需要知道的（5分钟）:**

```
把文字变成"地图坐标":
  "React"      → [0.023, -0.145, 0.567, ...]  ← 1536个数字
  "Next.js"    → [0.031, -0.138, 0.521, ...]  ← 离React很近
  "Chicken"    → [0.912, 0.345, -0.789, ...]  ← 离React很远

搜索:
  搜 "搭建博客" → [0.045, -0.121, 0.498, ...]  
  → 找最近的: "Next.js入门" (距离0.12), "React项目实战" (距离0.18)

pgvector: 在PostgreSQL里存这些坐标
  CREATE EXTENSION vector;
  ALTER TABLE blog_article ADD COLUMN embedding vector(1536);
  
  查询: 找最近的10篇文章
  SELECT id, title, 1 - (embedding <=> $1) AS similarity
  FROM blog_article
  ORDER BY embedding <=> $1
  LIMIT 10
```

**精华参考:**

| 概念 | 一句话理解 | 怎么用 |
|------|-----------|-------|
| Embedding | 把文字变成"语义坐标" | 调AI的embedding API |
| 向量距离 | 两个坐标的远近=语义相似度 | `<=>` 操作符算余弦距离 |
| 混合搜索 | 向量搜索+关键词搜索一起用 | 两个结果加权合并 |

---

### M4: RAG 问答系统

**你需要知道的（5分钟）:**

```
流程:
  用户提问 → 搜索相关文章 → 把文章内容+问题一起给AI → AI基于文章回答
  
  对比:
  不用RAG: "Next.js 15有什么新特性?" 
           → AI凭记忆回答，可能过时
  
  用RAG:   "Next.js 15有什么新特性?" 
           → 1. 搜索博客找到《Next.js 15新特性》文章
           → 2. 把文章内容塞进prompt
           → 3. AI基于文章回答，准确且可控

关键是"分块策略":
  整篇文章太长(超过AI的上下文窗口) → 切成块
  怎么切?
    ❌ 按500字硬切 → 可能切到一半
    ✅ 按Markdown标题切 → 每个#是一块
    ✅ 每块保留200字上下文重叠 → 不丢信息
```

**精华参考:**

| 概念 | 一句话理解 | 怎么用 |
|------|-----------|-------|
| Chunking | 把长文章切成小块 | 按Markdown标题切，每块重叠200字 |
| Context Window | AI一次能看多长的内容 | Gemini 1.5=1M tokens, DeepSeek=128K |
| Hybrid Search | 向量+关键词一起搜 | 加权平均两个结果 |

---

### M5: SSE 流式输出

**你需要知道的（5分钟）:**

```
不用SSE: 用户问问题 → AI想10秒 → 一次性返回全部文字
        用户干等10秒，体验差

用SSE:  用户问问题 → AI边想边发 → 一个字一个字出现
        就像有人在打字一样，用户体验好

你项目里已经有SSE了:
  blog.controller.ts:432 → detectIncompleteTranslationsStream()
  用 @Sse() + Observable<MessageEvent>
  
新加的: 
  让AI provider返回stream(true) → 逐token推送
  前端用EventSource接收 → 逐个显示
```

**精华参考:**

| 概念 | 一句话理解 | 怎么用 |
|------|-----------|-------|
| SSE | Server-Sent Events，服务器单向推数据 | NestJS的 `@Sse()` 装饰器 |
| Stream | AI provider边生成边返回 | `generateText({ stream: true })` |
| EventSource | 前端接收SSE的API | `new EventSource(url)` |

---

### M6: AI 聊天助手

**你需要知道的（5分钟）:**

```
多轮对话 = 每次把历史消息也发给AI:
  
  第1轮: 
    用户: "React是什么?"
    AI: "React是..."
    (历史: [{user: "React是什么?"}, {ai: "React是..."}])
  
  第2轮:
    用户: "那Next.js呢?"  ← 只有"那"和"呢"，单独看不知道在说什么
    AI: ← 需要看到历史才能理解
    实际给AI的: 
      [{user: "React是什么?"}, {ai: "React是..."}, {user: "那Next.js呢?"}]
    → AI看到上下文，回答"Next.js是基于React的框架..."

会话管理: Redis保存聊天历史
  为什么用Redis? 因为速度快，有过期时间
  key: chat:session:{sessionId} → value: 消息数组
  过期时间: 24小时后自动删除（不用手动清理）
```

**精华参考:**

| 概念 | 一句话理解 | 怎么用 |
|------|-----------|-------|
| 多轮对话 | 每次把历史消息发给AI | 维护 `messages[]` 数组 |
| 滑动窗口 | 历史太长时只保留最近的N轮 | 保留最近10轮对话 |
| 会话存储 | 用Redis存聊天记录 | `SETEX chat:123 86400 ...` |

---

### M7: Tool Use / Function Calling

**你需要知道的（5分钟）:**

```
普通AI: 只能"说话"
  "帮我搜一下React相关的文章" → "好的我建议你搜一下"（它不能实际搜）

Tool Use: AI会"用工具"
  "帮我搜一下React相关的文章" 
  → AI决定"我需要调用 searchArticles 工具"
  → 调用 searchArticles("React")
  → 拿到结果 → AI总结给你

本质就是一个循环:
  用户问题 → AI思考需要什么工具 → 调工具 → 拿结果 → AI继续思考 → 回复

你项目里BlogService有几十个方法可以给AI当工具:
  searchArticles(), getArticleBySlug(), getPopularArticles(), 
  getRelatedArticles(), getCategories(), getTags() ...
```

**精华参考:**

| 概念 | 一句话理解 | 怎么用 |
|------|-----------|-------|
| Function Calling | AI决定调用哪个函数 | 定义tool schema，AI选择 |
| Tool Registry | 所有可用工具的注册表 | Map<toolName, {schema, execute}> |
| ReAct Loop | 思考→行动→观察→再思考 | while循环直到AI满意 |

---

### M8: Multi-Agent 系统

**你需要知道的（5分钟）:**

```
一个Agent做不了复杂任务 → 多个Agent分工

场景: 自动写一篇技术文章
  1. Research Agent: 调研技术资料 ← 用RAG搜你的博客 + 网上搜
  2. Planner Agent: 规划文章大纲
  3. Writer Agent: 逐段写内容
  4. Code Agent: 生成代码示例
  5. Review Agent: 检查质量

它们怎么合作? 用 BullMQ 消息队列（你已经有了!）
  Orchestrator发任务 → Research Queue → 结果存Redis
  → Writer去Redis读 → 继续写 → 发到下一个Queue

你项目里已经有 BullMQ 了:
  blog-ai 队列 / group_settlement 队列
  BlogAiProcessor 就是 Worker
```

**精华参考:**

| 概念 | 一句话理解 | 怎么用 |
|------|-----------|-------|
| Agent编排 | 决定Agent的执行顺序 | 顺序/并行/条件分支 |
| Agent通信 | Agent之间怎么传递数据 | BullMQ消息队列 |
| 任务分解 | 把大任务拆成小任务 | "写文章"→调研/规划/写作/代码/审核 |
| 状态管理 | 跟踪整个流程的进度 | Redis存状态，前端轮询 |

---

### M9: LLM-as-a-Judge 质量评估

**你需要知道的（5分钟）:**

```
用AI来评AI:
  1. AI生成了一篇文章
  2. 让另一个AI（prompt不同）来评估这篇文章
  3. 从准确性/完整性/可读性等维度打分
  4. 分数低于阈值 → 要求重写

为什么用AI来评?
  人工评太慢，而且主观
  AI评: 30秒出结果，多个维度一致

评估维度:
  技术准确性: 代码对吗? 技术概念对吗?
  完整性: 有没有漏掉重要部分?
  可读性: 语言通顺吗? 结构清晰吗?
```

**精华参考:**

| 概念 | 一句话理解 | 怎么用 |
|------|-----------|-------|
| LLM-as-a-Judge | 用AI评估AI的输出 | 写评估prompt，让AI打分 |
| G-Eval | 一种评估方法 | 多个维度独立评分 |
| A/B测试 | 对比两个prompt哪个好 | 各生成10篇，对比平均分 |

---

### M10: 生产部署

**你需要知道的（5分钟）:**

```
AI上生产 != 调个API就完事

必须考虑的:
  1. 成本: Gemini $0.15/1M tokens, 一天调1万次 ≈ $1.5/天
  2. 缓存: 相同问题直接返回，不调AI
  3. 降级: AI不可用时，回退到离线数据
  4. 监控: 每次调用的耗时/成功率/花多少钱
  5. 限流: 每个用户每分钟最多调N次

你的AiService已经实现了:
  - circuit breaker (失败10次停5分钟)
  - rate limiting (每分钟12次)
  - key rotation (API key用满自动换)
```

**精华参考:**

| 概念 | 一句话理解 | 怎么用 |
|------|-----------|-------|
| 语义缓存 | 相似问题直接返回缓存 | 算embedding距离，距离<0.1就用缓存 |
| 降级策略 | AI挂了怎么办 | 返回"暂时无法回答"+推荐相关文章 |
| 成本监控 | 每天花了多少钱 | 每次调用记录token数*cost |

---

## 四、记住这几句话就够了

```
大模型 = 超级文字接龙机（输入文字→输出接下去的文字）
Token = AI的"字数"（计价单位）
Embedding = 文字的"地图坐标"（语义位置）
RAG = 给AI开卷考试（先查数据库再回答）
Agent = AI+工具箱（不仅能说，还能做事）
LLM-as-a-Judge = 用AI评AI（自动质检）
SSE = 打字机效果（一个字一个字出现）
```

---

## 五、每个模块你只改/加这些文件

```
M1:  + apps/api/src/blog/ai/seo-suggestion.service.ts
     + apps/api/src/blog/ai/seo-suggestion.controller.ts

M2:  + apps/api/src/blog/ai/tag-suggestion.service.ts

M3:  + apps/api/src/blog/search/embedding.service.ts
     + apps/api/src/blog/search/hybrid-search.service.ts
     mod apps/api/prisma/schema.prisma (加一列)

M4:  + apps/api/src/blog/search/rag-qa.service.ts
     + apps/frontend-blog/src/components/ArticleQABlock.tsx

M5:  mod apps/api/src/blog/search/rag-qa.service.ts (加stream)
     mod apps/frontend-blog/src/components/ArticleQABlock.tsx (加打字效果)

M6:  + apps/api/src/blog/chat/chat-session.service.ts
     + apps/api/src/blog/chat/chat.gateway.ts (WebSocket)
     + apps/frontend-blog/src/components/FloatingChatButton.tsx

M7:  + apps/api/src/blog/agents/tools/tool-registry.ts
     mod apps/api/src/blog/chat/chat.gateway.ts

M8:  + apps/api/src/blog/agents/ (整个目录)
     + apps/admin-blog/... (AI内容工坊页面)

M9:  + apps/api/src/blog/evaluation/quality-evaluator.service.ts

M10: + apps/api/src/common/ai/monitor.service.ts
```

---

## 六、Bonus 模块 — "拿得出手"的扩展功能

> 做完 10 个模块后可选做。这些是面试时的"杀手锏"，展示深度和广度。

### Bonus 总览

| # | 模块 | 做什么 | 复杂程度 | 新学技术 | 求职加分 |
|---|------|--------|---------|---------|---------|
| **B1** | GraphRAG 知识图谱检索 | 不只看相似度，还能多跳推理 | ⭐⭐⭐⭐⭐ | Neo4j / 图遍历 | 🔥🔥🔥🔥🔥 |
| **B2** | AI Code Sandbox | AI生成的代码自动在沙箱运行验证 | ⭐⭐⭐⭐⭐ | Docker + 安全隔离 | 🔥🔥🔥🔥🔥 |
| **B3** | AI Copilot 协作写作 | 实时AI建议，像Cursor写代码一样写文章 | ⭐⭐⭐⭐ | WebSocket + OT | 🔥🔥🔥🔥 |

---

### B1: GraphRAG — 知识图谱增强检索

**目标**: 从"搜到相关文章"升级到"理解文章之间的关系"

**你现在做的RAG**:
```
用户: "Next.js和Remix有什么区别?"
→ 搜到两篇单独的文章
→ AI分别读两篇，自己总结对比
→ 可能漏掉关键对比点
```

**GraphRAG**:
```
用户: "Next.js和Remix有什么区别?"
→ 1. 从所有文章中提取实体和关系:
     Next.js --使用--> 文件路由
     Remix --使用--> 嵌套路由
     Next.js --采用--> SSR
     Remix --采用--> 全栈SSR
     ...
→ 2. 构建知识图谱 (Neo4j 或 pgvector图遍历)
→ 3. 多跳推理: Next.js vs Remix 对比
     - 路由方式: 文件路由 vs 嵌套路由
     - 数据获取: getServerSideProps vs loader
     - 部署: Vercel vs 任意Node服务器
→ 4. 输出结构化的对比分析
```

**核心逻辑**:

```typescript
// 1. 从文章提取实体和关系
class EntityExtractor {
  async extract(article: Article): Promise<Entity[]> {
    // AI分析文章，提取技术实体和它们的关系
    // "Next.js 15引入了Turbopack"
    // → entities: [{name: "Next.js", type: "framework"}, {name: "Turbopack", type: "bundler"}]
    // → relation: {from: "Next.js", to: "Turbopack", type: "uses"}
  }
}

// 2. 图检索
class GraphRAGService {
  async query(question: string): Promise<Context> {
    // 1. 识别问题中的实体 (Next.js, Remix)
    // 2. 图遍历: 找到两个实体的属性、关系、对比点
    // 3. 把图结构塞进prompt
    // 4. AI基于图结构回答
  }
}
```

**新增技术**: Neo4j 图数据库 或 pgvector的图遍历能力

**面试官会问**:
- "GraphRAG和Vector RAG比有什么优点？" → 多跳推理更准确，适合对比类问题
- "实体的关系怎么提取的？" → AI分析文章，用结构化输出提取三元组

**求职加分点**: 展示你追踪最新技术（微软GraphRAG 2024）的能力

---

### B2: AI Code Sandbox — 代码沙箱执行

**目标**: AI不是"写代码给你看"，而是"写代码并运行给你看"

**流程**:

```
用户: "写一个React计数器组件"
  ↓
Code Agent生成代码
  ↓
发送到 Sandbox API
  ↓
Docker 容器启动 (限制: 1CPU, 256MB内存, 5秒超时)
  → npm install react
  → 编译/运行
  → 捕获输出/错误
  ↓
结果反馈给 Code Agent
  ✅ 运行成功 → 输出到文章 + 展示运行结果
  ❌ 有错误 → Agent自动修复 → 重新运行
  ↓
用户看到: 代码 + 实时运行结果 + 如果出错AI自动修复过程
```

**核心架构**:

```typescript
class CodeSandboxService {
  async runCode(code: string, language: string): Promise<SandboxResult> {
    // 1. 生成唯一容器ID
    const containerId = uuid();
    
    // 2. Docker run (限制资源)
    const result = await docker.run({
      image: `sandbox:${language}`,  // 预构建的镜像
      cmd: ['timeout', '5', 'node', '-e', code],
      memory: '256m',
      cpu: 1,
      autoRemove: true,  // 运行完自动删除
    });
    
    // 3. 解析结果
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      duration: result.duration,
    };
  }
  
  async runWithRetry(code: string, maxRetries = 3): Promise<CodeResult> {
    for (let i = 0; i < maxRetries; i++) {
      const result = await this.runCode(code);
      if (result.exitCode === 0) return { success: true, ...result };
      
      // 把错误反馈给AI，让它修复
      code = await this.aiFixCode(code, result.stderr);
    }
    return { success: false, error: 'Max retries exceeded' };
  }
}
```

**新增技术**: Dockerode (Node.js Docker SDK), 安全容器配置

**面试官会问**:
- "怎么防止恶意代码？" → 资源限制、超时、网络隔离、只读文件系统
- "支持多少种语言？" → 每种语言一个预构建Docker镜像

**求职加分点**: AI + DevOps + 安全 三合一，展示全栈能力

---

### B3: AI Copilot 协作写作

**目标**: 写博客时AI实时辅助，像Cursor写代码一样

**场景**:

```
你在后台写文章:
  "Next.js 15 是一个重要的版本更新，它带来了 Turbopack 的稳定版..."

  → AI实时检测到你在写"Next.js 15"
  → 自动弹出建议: "要不要补充Turbopack的性能数据？"
  → 你点"接受" → AI自动插入一段

  → 你继续写: "在路由方面..."
  → AI检测到不完整，建议补全三种路由方式
  → 你点"接受"

  → 你写: ```jsx\nfunction Counter()
  → AI自动补全完整组件代码
  → 你点"接受"
```

**核心逻辑**:

```typescript
class AiCopilotService {
  // 增量分析 (不是每次重新扫全文)
  async analyzeDelta(context: {
    recentContent: string;  // 最近写的200字
    cursorPosition: number;
    articleSoFar: string;
    language: string;
  }): Promise<Suggestion[]> {
    // 1. 判断用户在写什么 (技术概念? 代码? 普通文字?)
    const intent = await this.detectIntent(context.recentContent);
    
    // 2. 根据意图生成不同建议
    switch (intent) {
      case 'technical_concept':
        return this.suggestTechnicalDetail(context);
      case 'code':
        return this.suggestCodeCompletion(context);
      case 'transition':
        return this.suggestNextSection(context);
      case 'explanation':
        return this.suggestSimplification(context);
    }
  }
  
  // 延迟控制: 用户停顿 > 2秒 才开始分析
  async onUserPause(context: EditorContext) {
    await delay(2000);  // 防抖
    const suggestions = await this.analyzeDelta(context);
    // 通过WebSocket推送到编辑器
    this.eventsGateway.dispatch(sessionId, 'copilot_suggestion', suggestions);
  }
}
```

**新增技术**: 不需要新工具，用已有的 Socket.IO 推送建议

**面试官会问**:
- "怎么做到低延迟的？" → 增量分析，只处理最近内容，不是全文
- "怎么避免建议太频繁干扰写作？" → 用户停顿2秒后才触发分析

**求职加分点**: 展示你理解"用户体验"——不只能调API，还能设计交互

---

## 七、最终作品集 — 面试时能展示什么

```
面试官: "这个项目你做了什么?"
你打开博客:

  🌐 读者端:
    1. 搜索"数据库优化" → 搜到"索引调优"文章 ← M3语义搜索
    2. 打开文章 → 底部"🤖 问AI" → 提问 → AI基于文章回答 ← M4 RAG
    3. 右下角AI助手 → "推荐React文章" → AI调用搜索返回结果 ← M6+M7
    4. 英文版文章 → AI辅助翻译(已有) + 跨语言搜索 ← 现有+M3

  🔧 管理端:
    5. AI内容工坊 → 输入"写一篇Next.js文章" → 5个Agent协作生成 ← M8
    6. 质量看板 → AI自动评估每一篇生成的文章 ← M9
    7. 成本监控 → 每天花了多少钱、调了多少次API ← M10

  💎 Bonus（如果做了）:
    8. GraphRAG → "Next.js和Remix区别?" → 知识图谱推理回答
    9. Code Sandbox → 文章里的代码都能在线运行验证
    10. AI Copilot → 写文章时AI实时辅助

  → 面试官: "你用了LangChain?"
  → 你: "没有，我基于NestJS手写的全栈LLM应用"
  → 面试官: "...... 下周一来上班"
```

---

## 八、一句话总结

```
M1-M10 = 地基（必须做完，面试敲门砖）
Bonus  = 皇冠（选做，面试杀手锏）
全部做完 = 市面上90%的AI岗位你都能投
```

---

## 九、面试题映射 — 每个模块对应什么面试题

这是你之前问"能不能找到工作"最直接的答案。每个模块学会之后，你就能回答下面的面试题。

| 模块 | 面试官会问 | 难度 |
|------|-----------|------|
| M1 Prompt Engineering | 你是怎么设计 prompt 的？system prompt 和 user prompt 有什么区别？temperature 怎么调？什么情况用高/低 temperature？ | ⭐ 必问 |
| M2 结构化输出 | LLM 返回格式你怎么保证？JSON parse 失败了怎么办？Zod 校验怎么写的？retry 逻辑怎么设计？ | ⭐⭐ 常问 |
| M3 向量检索 | Embedding 是什么？pgvector 用过吗？余弦相似度和点积有什么区别？IVFFlat 和 HNSW 索引哪个好？ | ⭐⭐⭐⭐ 高频 |
| M4 RAG | 完整 RAG 流程讲一下。Chunking 策略怎么做的？Hybrid search 怎么实现？Reranking 是什么为什么需要？ | ⭐⭐⭐⭐⭐ 必问 |
| M5 SSE 流式输出 | 流式输出怎么实现的？SSE vs WebSocket 什么场景选哪个？背压问题怎么处理？ | ⭐⭐ 中频 |
| M6 AI 聊天助手 | 多轮对话上下文窗口怎么管理？Redis 存会话还是数据库存？滑动窗口策略？Token 超了怎么办？ | ⭐⭐⭐ 高频 |
| M7 Tool Use / Function Calling | Function Calling 原理讲一下。Tool Registry 模式怎么设计的？如果 LLM 调工具失败了怎么处理？ | ⭐⭐⭐⭐ 高频 |
| M8 Multi-Agent | 多个 Agent 怎么协作的？Orchestrator 模式？Agent 之间怎么通信？用队列还是直接调用？如果某个 Agent 超时了怎么办？ | ⭐⭐⭐⭐⭐ 加分项 |
| M9 LLM-as-a-Judge | LLM 输出质量怎么评估？用 LLM 来评 LLM 有什么 bias？评估维度有哪些？ | ⭐⭐⭐⭐ 加分项 |
| M10 生产部署 | 生产环境 LLM 要考虑什么？Rate limit？Circuit breaker？缓存策略？成本怎么控制？监控怎么做的？ | ⭐⭐⭐ 必问 |

**关键**: 你不需要背这些答案 —— 代码写出来，自然就知道怎么回答了。

---

## 十、岗位与薪资参考

### 你能投的岗位

| 岗位名称 | 对应模块 | 说明 |
|---------|---------|------|
| **Node.js AI 应用开发** (AIGC Backend) | M1-M7 + M10 | 最多的岗位，用 NestJS/Node.js 调 LLM API |
| **RAG 系统开发** | M3-M4 | 专门做知识库问答、文档问答的公司 |
| **AI Agent 开发** | M7-M8 | AI Agent 创业公司，Function Calling + Multi-Agent |
| **LLM 工程化 / AI Infra** | M3 + M10 | Embedding pipeline、缓存、监控、成本优化 |
| **全栈 AI 工程师** | M1-M10 + Bonus | 小公司/创业公司，前后端AI都做 |

### 薪资范围参考（2025-2026）

| 地区 | 岗位 | 月薪范围 |
|------|------|---------|
| 中国一线城市 深圳/上海/北京 | AIGC 后端开发 | 20k-45k RMB |
| 中国一线城市 | AI Agent 开发 | 25k-55k RMB |
| 中国一线城市 | RAG 系统工程师 | 22k-50k RMB |
| 新加坡 | AI 全栈工程师 | 6000-12000 SGD |
| 远程 / 海外远程 | Node.js AI Developer | 3000-8000 USD |

### 你的简历比别人的优势

```
别人的简历:
  - 用过 ChatGPT
  - 看过 LangChain 文档
  - 调过 OpenAI API

你的简历:
  - 基于 NestJS 手写了完整 LLM 应用全栈（10个模块）
  - 生产级 RAG 系统：pgvector + hybrid search + reranking
  - Multi-Agent 系统：5个 Agent 通过 BullMQ 协作
  - 生产部署：circuit breaker + rate limit + 成本监控
  - Bonus: GraphRAG / Code Sandbox / AI Copilot
```

---

## 十一、Node.js vs Python — 你到底该用什么

你问"人家招聘用的都是Python" — 这是对的。但需要看清市场结构：

### 市场真相

| | Python AI 岗 | Node.js/TypeScript AI 岗 |
|---|---|---|
| 数量 | 多（约70%） | 少（约30%） |
| 竞争 | 极其激烈 | 竞争小很多 |
| 典型公司 | AI Lab、大厂AI部门 | 创业公司、AIGC应用层、全栈团队 |
| 做的东西 | 模型训练、算法研究、数据处理 | 应用开发、API编排、AI功能集成 |
| 你的情况 | 从零开始，没有项目 | **已有生产级NestJS项目，直接改造** |

### 关键问题：你的核心竞争力是什么？

```
面试官真正关心的，不是"你用Python还是Node.js"，而是:

  ❌ "你用过什么框架？"           ← Python新人也能背
  ✅ "LLM应用的架构你懂吗？"       ← 做过才知道

  ❌ "你调过OpenAI API吗？"        ← 谁都能调
  ✅ "RAG的reranking你怎么做的？"  ← 架构思维

  ❌ "你会Python吗？"              ← 学两周就会
  ✅ "生产环境你踩过什么坑？"      ← 做过才知道
```

### 用你的项目证明架构能力，不在语言

你的博客系统已经有:
- **[`AiService`](apps/api/src/common/ai/ai.service.ts)** — circuit breaker + RPM limit + key rotation + service degradation
- **[`BlogAiProcessor`](apps/api/src/blog/processors/blog-ai.processor.ts)** — BullMQ job queue with retry + rate limiting
- **[`EventsGateway`](apps/common/events/events.gateway.ts)** — Socket.IO real-time events
- **SSE streaming** — already in [`detectIncompleteTranslationsStream`](apps/api/src/blog/blog.service.ts:3349)

面试官看到这些代码，根本不会问"你为什么不用Python"。

### 做完之后想转Python，多久？

```
你现在：NestJS + TypeScript 全栈
  ↓ 做完10个模块，理解了所有概念
  ↓ 2周：用 FastAPI + Python 把同样的架构写一遍
  ↓ 再1周：加 LangChain（这次你真的知道它解决了什么问题）
  ↓ 3周后：Python 简历 + 两个项目（Node.js版 + Python版）

  → 这时候：Python岗和Node.js岗你都能投
```

### 结论

| 路径 | 时间 | 风险 |
|------|------|------|
| 现在学Python做AI项目 | 3-6个月才能到现有基建水平 | 高（从零开始，没有项目基础） |
| 用Node.js做完10个模块 | 按进度走 | 低（在现有项目上迭代） |
| 做完后转Python翻译一遍 | +3周 | 极低（概念已通，只是翻译语法） |

**先做10个模块打通概念，再做Python版就是降维打击。**

---

> 📌 **每次开始前**: 打开这个文件，看当前进度和今天要做的模块
> 📌 **每次结束后**: 更新学习日志，写下来学到了什么
> 📌 **不用看的文档**: LangChain文档、OpenAI cookbook、论文
