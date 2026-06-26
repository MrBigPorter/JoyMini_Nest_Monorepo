# 12. 实现人机审核与发布 SSE

## 🎯 本步骤目标

为 BlogWritingAgent 的 Workflow 模式实现：
1. **HITL 审核流程** — 文章草稿完成后暂停，等待管理员审批
2. **SSE 实时推送** — 将写作进度流式推送到管理后台前端
3. **审核恢复** — 管理员审批/驳回/修改后继续流程

---

## 📖 背景说明

### 承上

上两步完成了 WritingAgent 的双模式架构（doc 10）和 9 个写作工具（doc 11）。Workflow 模式需要人工审核节点，而 ReAct 模式和管理员都需要实时看到写作进度。

### 这一步要解决的问题

- 文章自动生成后需要管理员把关 — 不能直接发布
- 管理员需要能看到写作进度 — 不是黑盒等待
- 审批后需要恢复图执行 — 不能重新开始
- 长时间运行需要超时处理 — 避免流程死锁

### 设计决策

| 决策 | 选项 | 选择 |
|------|------|------|
| 暂停机制 | 数据库轮询 / interrupt() | **interrupt()** — LangGraph 原生支持，参考 python-ai-quickstart 13 |
| 审批存储 | 内存 / 数据库 | **数据库 ApprovalTask 表** — 可持久化、可查询、可超时 |
| 恢复机制 | 重启 Graph / Command resume | **Command(resume=...)** — LangGraph 原生 resume |
| 推送协议 | WebSocket / SSE | **SSE** — 与现有系统一致，简单可靠 |
| 事件格式 | 自定义 / 标准协议 | **4 事件类型** — 参考 general-agent 18 |

### 从教学项目提取的模式

| 教学项目 | 模式 | 应用 |
|----------|------|------|
| `workflow-agent/11-human-approval.md` | Prisma ApprovalTask + interrupt() + 超时 | 审核任务表 + 超时自动处理 |
| `python-ai-quickstart/13-human-in-the-loop.md` | interrupt() + Command(resume=...) | 中断与恢复 |
| `general-agent/18-agent-thinking-real-time-display.md` | SSE 4 事件协议 + React 组件 | 实时推送事件 + ThinkingStream 组件 |
| `travel-agent/backend/src/agent/agent.service.ts` | AsyncGenerator 流式 | SSE 流式输出 |

---

## ⚙️ 前置条件

### 环境要求

- `@langchain/langgraph` — `interrupt()`, `Command()`
- Prisma — ApprovalTask 模型
- `@nestjs/event-emitter` — 事件驱动

### 文件/配置准备

```
apps/api/src/blog/agent/
├── nodes/
│   ├── review.node.ts            # 12 - HITL 审核节点
│   └── publishing.node.ts        # 12 - 发布节点
├── services/
│   ├── approval.service.ts       # 12 - 审核任务管理
│   └── writing-sse.service.ts    # 12 - SSE 事件推送
├── graph/
│   └── writing.graph.ts          # 12 - 更新（添加 review/publish 节点）
└── writing-agent.controller.ts   # 12 - 更新（添加审批端点）
```

---

## 📝 实现步骤

### Step 1: 创建 ApprovalTask Prisma 模型

```prisma
// 在 prisma/schema.prisma 中追加

model ApprovalTask {
  id          String   @id @default(cuid())
  type        String   // "writing_review" | "comment_moderation" | ...
  status      String   @default("pending") // pending | approved | rejected | edit
  data        Json?    // 需要审核的数据（文章草稿等）
  result      Json?    // 审核结果
  feedback    String?  // 管理员反馈/修改意见
  createdBy   String?  // 触发审核的用户/系统
  reviewedBy  String?  // 审核人
  expiresAt   DateTime? // 超时时间
  createdAt   DateTime @default(now())
  reviewedAt  DateTime?
  updatedAt   DateTime @updatedAt

  @@index([type, status])
  @@index([status, expiresAt])  // 超时查询
  @@map("approval_tasks")
}
```

### Step 2: 实现 ApprovalService

参考 workflow-agent 11-human-approval.md 的 ApprovalService 设计。

```typescript
// apps/api/src/blog/agent/services/approval.service.ts

@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createTask(data: {
    type: string;
    data: any;
    createdBy?: string;
    timeoutMinutes?: number;
  }): Promise<ApprovalTask> {
    const expiresAt = data.timeoutMinutes
      ? new Date(Date.now() + data.timeoutMinutes * 60 * 1000)
      : null;

    const task = await this.prisma.approvalTask.create({
      data: {
        type: data.type,
        data: data.data,
        createdBy: data.createdBy,
        expiresAt,
        status: 'pending',
      },
    });

    // 发送新审核任务事件
    this.eventEmitter.emit('approval.task.created', task);

    return task;
  }

  async approveTask(taskId: string, reviewerId: string, feedback?: string): Promise<void> {
    await this.prisma.approvalTask.update({
      where: { id: taskId },
      data: {
        status: 'approved',
        reviewedBy: reviewerId,
        feedback,
        reviewedAt: new Date(),
      },
    });
  }

  async rejectTask(taskId: string, reviewerId: string, feedback: string): Promise<void> {
    await this.prisma.approvalTask.update({
      where: { id: taskId },
      data: {
        status: 'rejected',
        reviewedBy: reviewerId,
        feedback,
        reviewedAt: new Date(),
      },
    });
  }

  async editTask(taskId: string, reviewerId: string, feedback: string, edits: any): Promise<void> {
    await this.prisma.approvalTask.update({
      where: { id: taskId },
      data: {
        status: 'edit',
        reviewedBy: reviewerId,
        feedback,
        result: edits,
        reviewedAt: new Date(),
      },
    });
  }

  async getPendingTasks(type?: string): Promise<ApprovalTask[]> {
    const where: any = { status: 'pending' };
    if (type) where.type = type;
    return this.prisma.approvalTask.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  // 处理超时任务
  async handleTimeoutTasks(): Promise<void> {
    const overdueTasks = await this.prisma.approvalTask.findMany({
      where: {
        status: 'pending',
        expiresAt: { lte: new Date() },
      },
    });

    for (const task of overdueTasks) {
      await this.prisma.approvalTask.update({
        where: { id: task.id },
        data: { status: 'rejected', feedback: '审批超时，自动驳回' },
      });
      this.eventEmitter.emit('approval.task.timeout', task);
    }
  }
}
```

### Step 3: 实现审核节点（使用 interrupt()）

参考 workflow-agent 11-human-approval.md 的 InterruptNode 和 python-ai-quickstart 13 的 interrupt() 模式。

```typescript
// apps/api/src/blog/agent/nodes/review.node.ts

export function createReviewNode(approvalService: ApprovalService) {
  return async (state: typeof WorkflowWritingState) => {
    // 创建审核任务
    const task = await approvalService.createTask({
      type: 'writing_review',
      data: {
        topic: state.topic,
        outline: state.outline,
        draftContent: state.draftContent,
        polishedContent: state.polishedContent,
        abstract: state.abstract,
        suggestedTags: state.suggestedTags,
      },
      createdBy: state.adminId,
      timeoutMinutes: 30, // 30 分钟超时
    });

    // ⚠️ 中断点 — 图执行在此暂停
    // 等待管理员通过 resume 端点注入审核结果
    const approvalResult = interrupt({
      type: 'writing_review',
      taskId: task.id,
      message: '请审核文章草稿，可批准、驳回或提供修改意见',
      preview: {
        title: extractTitle(state.polishedContent || state.draftContent || ''),
        abstract: state.abstract,
        tags: state.suggestedTags,
        wordCount: (state.polishedContent || state.draftContent || '').length,
      },
    });

    // 处理审核结果
    const { action, feedback } = approvalResult as {
      action: 'approve' | 'reject' | 'edit';
      feedback?: string;
      edits?: any;
    };

    switch (action) {
      case 'approve':
        return {
          ...state,
          approvalStatus: 'approved' as const,
          editorFeedback: feedback,
        };
      case 'reject':
        return {
          ...state,
          approvalStatus: 'rejected' as const,
          editorFeedback: feedback || '文章被驳回',
        };
      case 'edit':
        return {
          ...state,
          approvalStatus: 'edit' as const,
          editorFeedback: feedback,
          polishedContent: approvalResult.edits?.content || state.polishedContent,
        };
      default:
        return { ...state, approvalStatus: 'rejected' as const };
    }
  };
}
```

### Step 4: 实现审核恢复端点

```typescript
// 在 WritingAgentController 中追加

@Post('workflow/resume')
@ApiOperation({ summary: '审核后恢复 Workflow 执行' })
async resumeWorkflow(
  @Body() dto: ResumeWorkflowDto,
  @Req() req: Request,
) {
  const { threadId, taskId, action, feedback, edits } = dto;

  // 1. 更新审核任务状态
  if (action === 'approve') {
    await this.approvalService.approveTask(taskId, req.user.id, feedback);
  } else if (action === 'reject') {
    await this.approvalService.rejectTask(taskId, req.user.id, feedback || '');
  } else {
    await this.approvalService.editTask(taskId, req.user.id, feedback || '', edits);
  }

  // 2. 使用 Command(resume=...) 恢复图执行
  const graph = this.writingAgentService.getWritingGraph();
  const result = await graph.resume(
    { configurable: { thread_id: threadId } },
    new Command({
      resume: { action, feedback, edits },
    }),
  );

  return result;
}
```

### Step 5: 实现 SSE 事件协议

参考 general-agent 18-agent-thinking-real-time-display.md 的 4 事件协议。

```typescript
// apps/api/src/blog/agent/services/writing-sse.service.ts

export interface SSEEvent {
  type: 'token' | 'step' | 'done' | 'error';
  data: any;
}

export class WritingSSEService {
  async *streamWorkflow(threadId: string): AsyncGenerator<string> {
    const graph = this.getWritingGraph();
    const config = { configurable: { thread_id: threadId } };

    try {
      const eventStream = await graph.streamEvents(null, {
        ...config,
        version: 'v2',
      });

      for await (const event of eventStream) {
        switch (event.event) {
          case 'on_chat_model_stream':
            // token 级流式
            yield this.formatSSE({
              type: 'token',
              data: {
                content: event.data?.chunk?.content || '',
                node: event.metadata?.langgraph_node || '',
              },
            });
            break;

          case 'on_chain_start':
            // step 开始
            if (event.metadata?.langgraph_node) {
              yield this.formatSSE({
                type: 'step',
                data: {
                  node: event.metadata.langgraph_node,
                  status: 'running',
                  timestamp: new Date().toISOString(),
                },
              });
            }
            break;

          case 'on_chain_end':
            // step 完成
            if (event.metadata?.langgraph_node) {
              yield this.formatSSE({
                type: 'step',
                data: {
                  node: event.metadata.langgraph_node,
                  status: 'completed',
                  timestamp: new Date().toISOString(),
                },
              });
            }
            break;
        }
      }

      // 整体完成
      yield this.formatSSE({
        type: 'done',
        data: { message: '写作流程完成', timestamp: new Date().toISOString() },
      });

    } catch (error) {
      yield this.formatSSE({
        type: 'error',
        data: { message: error.message, timestamp: new Date().toISOString() },
      });
    }
  }

  private formatSSE(event: SSEEvent): string {
    return `data: ${JSON.stringify(event)}\n\n`;
  }
}
```

### Step 6: 实现 SSE Controller 端点

```typescript
// 在 WritingAgentController 中追加

@Post('workflow/start/stream')
@ApiOperation({ summary: '启动 Workflow 并流式推送' })
@Header('Content-Type', 'text/event-stream')
@Header('Cache-Control', 'no-cache')
@Header('Connection', 'keep-alive')
async startWorkflowStream(
  @Body() dto: StartWorkflowDto,
  @Req() req: Request,
  @Res() res: Response,
) {
  // 1. 启动 Workflow
  const { threadId } = await this.writingAgentService.startWorkflow(req.user.id, dto);

  // 2. 推送 threadId 给前端
  res.write(`data: ${JSON.stringify({ type: 'step', data: { node: 'start', status: 'running', threadId } })}\n\n`);

  // 3. 流式推送写作进度
  const stream = this.writingSSEService.streamWorkflow(threadId);
  for await (const chunk of stream) {
    res.write(chunk);

    // 如果遇到 HITL 中断，发送中断事件
    if (chunk.includes('"type":"step"') && chunk.includes('review')) {
      // 等待审核... SSE 连接保持打开
    }
  }

  res.end();
}
```

### Step 7: 前端 React Hook（参考 general-agent 18）

```typescript
// 管理后台 React 组件

function useWritingSSE(threadId: string | null) {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'review' | 'done' | 'error'>('idle');

  useEffect(() => {
    if (!threadId) return;

    const eventSource = new EventSource(
      `/admin/blog/writing-agent/workflow/stream`,
      { withCredentials: true }
    );

    eventSource.onmessage = (event) => {
      const parsed: SSEEvent = JSON.parse(event.data);
      setEvents((prev) => [...prev, parsed]);

      switch (parsed.type) {
        case 'token':
          // 追加内容到当前步骤
          break;
        case 'step':
          if (parsed.data.node === 'review' && parsed.data.status === 'running') {
            setStatus('review');
          }
          break;
        case 'done':
          setStatus('done');
          eventSource.close();
          break;
        case 'error':
          setStatus('error');
          eventSource.close();
          break;
      }
    };

    return () => eventSource.close();
  }, [threadId]);

  return { events, status };
}
```

### Step 8: Workflow 完整生命周期

```
管理员                     WritingAgent                  ApprovalService             管理员（审核人）
  |                            |                              |                          |
  |-- POST /workflow/start --->|                              |                          |
  |                            |-- planNode (生成大纲)        |                          |
  |   <-- SSE: step plan -----|                              |                          |
  |                            |-- researchNode (搜索参考)    |                          |
  |   <-- SSE: step research--|                              |                          |
  |                            |-- draftNode (写草稿)         |                          |
  |   <-- SSE: token ... -----|                              |                          |
  |                            |-- polishNode (润色)          |                          |
  |   <-- SSE: token ... -----|                              |                          |
  |                            |-- reviewNode                |                          |
  |                            |   ├── createTask() -------->|                          |
  |                            |   └── interrupt() ⏸️        |                          |
  |   <-- SSE: step review ---|                              |                          |
  |                            |                              |                          |
  |                            |          [等待审核...]       |                          |
  |                            |                              |                          |
  |                            |                              |<-- 管理员查看待审批任务 --|
  |                            |                              |                          |
  |-- POST /workflow/resume -->|                              |-- approveTask()          |
  |   {action: "approve"}     |                              |                          |
  |                            |-- Command(resume) 🔄         |                          |
  |                            |-- publishNode (发布)         |                          |
  |   <-- SSE: step publish---|                              |                          |
  |                            |-- BlogService.createArticle()|                          |
  |   <-- SSE: done ----------|                              |                          |
```

---

## ✅ 验收方式

### 手动验证

1. **启动 Workflow**：
   ```bash
   curl -N -X POST http://localhost:3000/admin/blog/writing-agent/workflow/start/stream \
     -H "Authorization: Bearer <admin-token>" \
     -H "Content-Type: application/json" \
     -d '{"topic": "NestJS 微服务架构", "locale": "zh", "style": "technical"}'
   ```
   预期：SSE 流式输出 step → token → step → ... → step review

2. **查看待审批任务**：
   ```bash
   curl http://localhost:3000/admin/blog/writing-agent/workflow/pending-tasks \
     -H "Authorization: Bearer <admin-token>"
   ```
   预期：返回包含 taskId 的待审批列表

3. **审核通过并恢复**：
   ```bash
   curl -X POST http://localhost:3000/admin/blog/writing-agent/workflow/resume \
     -H "Authorization: Bearer <admin-token>" \
     -H "Content-Type: application/json" \
     -d '{
       "threadId": "...",
       "taskId": "...",
       "action": "approve",
       "feedback": "写得很棒，发布吧"
     }'
   ```
   预期：继续执行 publishNode，文章发布成功

### 自动化测试

```typescript
describe('ApprovalService', () => {
  it('应创建审核任务并触发事件', async () => {
    const task = await approvalService.createTask({
      type: 'writing_review',
      data: { topic: 'test' },
    });
    expect(task.status).toBe('pending');
    expect(task.id).toBeDefined();
  });

  it('审批通过应更新状态', async () => {
    const task = await approvalService.createTask({ type: 'writing_review', data: {} });
    await approvalService.approveTask(task.id, 'admin-1', 'Good!');
    const updated = await prisma.approvalTask.findUnique({ where: { id: task.id } });
    expect(updated?.status).toBe('approved');
    expect(updated?.reviewedBy).toBe('admin-1');
  });

  it('超时任务应自动驳回', async () => {
    const task = await approvalService.createTask({
      type: 'writing_review',
      data: {},
      timeoutMinutes: -1, // 立即超时
    });
    await approvalService.handleTimeoutTasks();
    const updated = await prisma.approvalTask.findUnique({ where: { id: task.id } });
    expect(updated?.status).toBe('rejected');
  });
});

describe('WritingSSEService', () => {
  it('应流式输出 SSE 事件', async () => {
    const chunks: string[] = [];
    for await (const chunk of writingSSEService.streamWorkflow('test-thread')) {
      chunks.push(chunk);
      if (chunk.includes('"type":"done"')) break;
    }
    expect(chunks.length).toBeGreaterThan(0);
    chunks.forEach((c) => expect(c).toMatch(/^data: /));
  });
});
```

---

## 🔜 下一步

至此，Blog AI Agent 系列文档（00-12）已全部完成：

| 阶段 | 文档 | 状态 |
|------|------|------|
| 架构分析 | 00 | ✅ |
| 基础设施 | 01 | ✅ |
| 数据模型 | 02 | ✅ |
| 核心引擎 | 03 | ✅ |
| 专业 Agent | 04-06 | ✅ |
| 推荐 Agent | 07 | ✅ |
| 编排层 | 08 | ✅ |
| 向量基础设施 | 09 | ✅ |
| 管理员 AI 工具 | 10-12 | ✅ |

后续可继续扩展的方向：
- **PostgreSQL Checkpointer** — 替换内存状态管理
- **LangSmith 集成** — Agent 调试追踪
- **SEO 优化 Agent** — 自动优化文章 SEO
- **多模态写作** — 图片生成/视频转文章
