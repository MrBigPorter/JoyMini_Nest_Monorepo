# AI JoyMini 知识点图谱 — 概念 · 位置 · 类比

> 本文档是 AI 客服代码库的知识地图，帮你快速找到"每个技术概念在哪里、为什么用、是什么、怎么做"。
> 每个概念都配有一个生活类比，让你像听故事一样理解架构设计。

---

## 目录

1. [LangGraph 状态图 — 整个系统的骨架](#1-langgraph-状态图--整个系统的骨架)
2. [AgentState — 14 个字段承载所有状态](#2-agentstate--14-个字段承载所有状态)
3. [LLM Factory — 云端/本地模型切换](#3-llm-factory--云端本地模型切换)
4. [Intent Router — 入口分拣员](#4-intent-router--入口分拣员)
5. [ReAct Agent Loop — 手动 while 循环](#5-react-agent-loop--手动-while-循环)
6. [Tool Registry — 编程式工具注册](#6-tool-registry--编程式工具注册)
7. [Tool Result — 统一成功/失败格式](#7-tool-result--统一成功失败格式)
8. [prepareAgentContext — 消息过滤](#8-prepareagentcontext--消息过滤)
9. [Prompt Builder — 10 段 System Prompt 模板](#9-prompt-builder--10-段-system-prompt-模板)
10. [Supervisor 模式 — 多 Agent 协作](#10-supervisor-模式--多-agent-协作)
11. [Answer Synthesizer — 结果合成为自然语言](#11-answer-synthesizer--结果合成为自然语言)
12. [General Chat — 闲聊 fallback](#12-general-chat--闲聊-fallback)

---

## 1. LangGraph 状态图 — 整个系统的骨架

| 维度 | 内容 |
|------|------|
| **在哪里** | [`customer.graph.ts`](apps/api/src/client/ai-customer/graph/customer.graph.ts) — 第 82-168 行 |
| **为什么** | LangGraph 是 LangChain 的图框架，把 AI 客服流程拆成"节点 + 边"。每个节点做一件事，边决定"做完这一步下一步去哪"。比直接调 LLM API 多了流程控制、状态持久化、并行执行。 |
| **是什么** | StateGraph = 有状态的有向图。编译时检查所有节点都有入口出口、没有死循环。就像地铁线路图：每个站是一个 Node，铁轨是 Edge，你刷地铁卡进站（START），到终点站出站（END）。 |
| **如何做** | `.addNode(name, fn)` 注册节点 → `.addEdge(from, to)` 或 `.addConditionalEdges(from, router)` 连接 → `.compile()` 编译执行 |

**生活类比** 🏭
> 这就像一家工厂的流水线：`intentRouter` 是入口处"分拣员"，把不同物料分到不同车间（Agent）；每个车间有工人（LLM）和工具；`supervisorNode` 是车间主任，协调多个车间同时工作；`answerSynthesizer` 是包装工，把成品打包成统一格式发给客户。工厂总图就是 `customer.graph.ts`。

---

## 2. AgentState — 14 个字段承载所有状态

| 维度 | 内容 |
|------|------|
| **在哪里** | [`state.ts`](apps/api/src/client/ai-customer/graph/state.ts) — 第 54-166 行 |
| **为什么** | LangGraph 每个 Node 的输入输出都是"状态对象"。所有信息（用户消息、意图、工具结果、流程数据）必须统一放在这个对象里才能在不同 Node 之间传递。 |
| **是什么** | `Annotation.Root()` 定义 14 个字段，每个字段有 `reducer`（如何合并新旧值）+ `default`（初始值）。 |
| **如何做** | 字段分 3 种 reducer：`(a,b) => b` 覆盖（intent, flowType）、`{...a, ...b}` 合并（flowData, taskResults）、`a.concat(b)` 追加（messages, agentSteps）。 |

**核心字段速记表：**

| 组 | 字段 | 用途 | 类比 |
|----|------|------|------|
| 对话 | `messages` | 聊天记录（全部保留） | 会议录音带 |
| 对话 | `intent` | 当前意图 | 今天的任务标签 |
| 对话 | `userId` | 用户 ID | 工牌号 |
| Supervisor | `pendingTasks` | 待办任务列表 | 车间派工单 |
| Supervisor | `taskResults` | 各 Agent 结果汇总 | 各车间交上来的报告 |
| Supervisor | `supervisorRound` | 防死循环计数器 | 最多催 5 次 |
| Supervisor | `agentSteps` | 思考链日志 | 工人每一步的操作记录 |
| RAG | `sources` | 知识文档来源 | 引用的文献 |
| Flow | `flowType` | 业务类型（提现/充值/查询） | 订单类型 |
| Flow | `flowStatus` | 流程状态（IDLE→FILLING→CONFIRMING） | 进度条 |
| Flow | `flowData` | 表单数据 | 填写的表格 |
| 路由 | `currentAgent` | 当前 Agent 名称 | 谁在处理 |
| 路由 | `messageTopics` | Human 消息话题标记 | 邮件标签 |
| 调试 | `debug` | 调试模式开关 | 是否开引擎盖 |

**生活类比** 📋
> `AgentState` 就像工厂里"挂在墙上的白板"。每个工人（Node）上班第一件事是看白板上写了什么，干完活后把结果写在白板上。`reducer` 是白板的擦写规则：有些格子（intent）只能写最新值（覆盖），有些格子（taskResults）可以"在上面加内容"（合并），有些格子（messages）只能追加不能擦除。

---

## 3. LLM Factory — 云端/本地模型切换

| 维度 | 内容 |
|------|------|
| **在哪里** | [`llm-factory.ts`](apps/api/src/client/ai-customer/graph/llm-factory.ts) — 第 20-40 行 |
| **为什么** | 开发时用本地 Ollama（免费、离线、快），生产用 ChatGPT/DeepSeek（更聪明）。需要一个统一入口，改一行配置就切模型。 |
| **是什么** | Factory Pattern（工厂模式）：根据 `config.type === 'online'` 决定创建 `ChatOpenAI` 还是 `ChatOllama`。 |
| **如何做** | `createLLM(config, { temperature })` → 传入 `{ type: 'online', model: 'deepseek-chat', ... }` 或 `{ type: 'local', model: 'qwen3.5:0.8b' }` |

**生活类比** 🔌
> 这就像你家的插座转换器：你去不同国家（开发/生产），只需要换一个插头（改 config.type），电器（你的代码）不用动。`ChatOpenAI` 是美标插头，`ChatOllama` 是欧标插头，`createLLM` 就是那个万能转换器。

---

## 4. Intent Router — 入口分拣员

| 维度 | 内容 |
|------|------|
| **在哪里** | [`intent-router.node.ts`](apps/api/src/client/ai-customer/graph/nodes/intent-router.node.ts) — 第 206-336 行 |
| **为什么** | 用户说一句话，系统需要判断"这是关于什么的"，才能分给对应的 Agent（钱包问题→Wallet Agent，闲聊→General Chat）。 |
| **是什么** | Intent Classification（意图分类）：用 LLM 把用户输入分类成 9 种预定义意图之一。 |
| **如何做** | `Pipeline: Prompt(9-category system msg) → LLM(temperature=0) → StringOutputParser` → 校验 → 写入 `state.intent` |

**分类表：**

| 意图 | 对应节点 | 用户说 |
|------|---------|--------|
| `order` | orderAgent | "我的订单到哪了" |
| `wallet` | walletAgent | "查一下余额" |
| `coupon` | couponAgent | "有没有优惠券" |
| `user` | userAgent | "帮我改一下地址" |
| `rag` | ragNode | "退货政策是什么" |
| `general` | generalChat | "你好" |
| `supervised` | supervisorNode | "查余额和订单"（多领域） |
| `product` | generalChat（fallback） | "搜一下手机" |
| `lucky-draw` | generalChat（fallback） | "查中奖记录" |

**生活类比** 🏪
> 这就像便利店入口处的店员：你进门说"买瓶水"→ 他指路到饮料区（wallet）。你说"取快递"→ 他指到快递架（order）。你说"你好"→ 他就跟你闲聊（general）。如果 LLM 拿不准会回复 "unknown"，店员就会带你去"综合服务台"（generalChat fallback）。

---

## 5. ReAct Agent Loop — 手动 while 循环

| 维度 | 内容 |
|------|------|
| **在哪里** | [`agent-runner.ts`](apps/api/src/client/ai-customer/graph/agents/agent-runner.ts) — 第 93-204 行 |
| **为什么** | LangChain 的 `createReactAgent` 不够灵活。手动实现 while 循环让我们能：提前提取 flow data、更细粒度的错误处理、自定义迭代次数控制。 |
| **是什么** | Manual ReAct Loop（手动推理-行动循环）：LLM 思考 → 决定调不调工具 → 调工具 → 看结果 → 再思考...直到 LLM 觉得够了。 |
| **如何做** | `while (iterations < MAX_ITERATIONS) { llm.invoke() → if no tool_calls: break → for each toolCall: execute tool → append ToolMessage }` |

**生活类比** 🧑‍💼
> 这就像你让助理去查一个事情：
> 1. 你问："帮我查一下这个客户的订单状态"（LLM 思考）
> 2. 助理说："我需要查一下客户 ID"→ 查数据库（工具调用）
> 3. 助理看结果："找到了，这是物流信息"（LLM 再次思考）
> 4. 如果还需要继续查 → 重复
> 5. 助理说："好了，这就是全部信息" → 结束循环

---

## 6. Tool Registry — 编程式工具注册

| 维度 | 内容 |
|------|------|
| **在哪里** | [`tool-registry.service.ts`](apps/api/src/client/ai-customer/graph/tools/tool-registry.service.ts) — 第 20-76 行 |
| **为什么** | 每个领域模块（Wallet、Order、Coupon）独立定义自己的工具，但 Agent 需要按标签（tag）获取工具。程序化注册比硬编码更灵活、可扩展。 |
| **是什么** | `TaggedTool = { tool, tags[] }`。模块在 `OnApplicationBootstrap` 时主动注册，Agent 按 `tag` 查询获取工具列表。 |
| **如何做** | 模块实现 `OnApplicationBootstrap` → `constructor(private toolRegistry: ToolRegistryService)` → `onApplicationBootstrap() { this.toolRegistry.registerMany(createXxxTools(...)) }` |

**生活类比** 🛠️
> 这就像一个工具箱（ToolRegistry），每个部门（Wallet、Order 等）把自己用的工具放进去，并贴上标签（tag）。Wallet 部门放进去"查余额"、"提现"工具 → 贴标签 "wallet"。Order 部门放进去"查订单"工具 → 贴标签 "order"。Agent 领任务时说"给我 wallet 标签的所有工具" → ToolRegistry 就给他。

---

## 7. Tool Result — 统一成功/失败格式

| 维度 | 内容 |
|------|------|
| **在哪里** | [`tool-result.ts`](apps/api/src/client/ai-customer/graph/tools/tool-result.ts) — 全部 |
| **为什么** | 21 个工具需要统一的返回格式，LLM 才能统一判断"这次调用成功了还是失败了"。 |
| **是什么** | `ToolResult<T> = { ok: true; data: T } | { ok: false; error: string }` + 解析工具。 |
| **如何做** | 工具函数返回 `toolSuccess(data)` 或 `toolFailure(error)` → LLM 收到前通过 `stripToolResult()` 剥掉 `{ok, data}` 包装。 |

**生活类比** 📦
> 这就像快递包裹：外面是一个标准箱子（`{ ok, data }`），里面是实际商品。快递员（Agent runner）收到箱子后用一把小刀（`stripToolResult()`）划开外包装，只把商品给客户（LLM）看。如果箱子上面贴了"破损"标签（`ok: false`），快递员就跟客户说"对不起，这个件出了问题"。

---

## 8. prepareAgentContext — 消息过滤

| 维度 | 内容 |
|------|------|
| **在哪里** | [`prepare-context.ts`](apps/api/src/client/ai-customer/graph/utils/prepare-context.ts) — 第 183-289 行 |
| **为什么** | 对话历史中包含大量技术消息（tool_calls、ToolMessage），LLM 不需要看到这些"内部 wiring"。单 Agent 模式保留最后一批工具调用结果（API 要求），Supervisor 模式还要按话题隔离不同 Agent 的上下文。 |
| **是什么** | 消息过滤函数。单 Agent 模式 = 去噪，只保留 Human + AI 纯文本 + 最后一个 AI(tool_calls) + 对应的 ToolMessage。Supervisor 模式 = 去噪 + 话题隔离。 |
| **如何做** | 从后往前扫描 → 找到最后一个 AI(tool_calls) → 收集后面的所有 ToolMessage → 过滤消息数组。 |

**单 Agent 过滤示例：**
```
输入: [H, AI(text), H, AI(tc:balance), T(balance result), AI(text:回复), H, AI(tc:balance+kyc), T(balance), T(kyc), AI(text)]
                                                                                              ↑ 只保留这个 AI(tc) 和后面的两个 T
输出: [H, AI(text), H, T(balance), T(kyc), AI(text)]
```

**生活类比** 🗑️
> 这就像你整理微信聊天记录发给同事。原始记录里有很多"对方正在输入..."、"刚才那条发错了"、"撤回了一条消息"等中间状态信息。你整理时会删掉这些杂音，只保留"人说的话"和"最终结论"。如果同事只需要看跟"订单"有关的部分，你还会把"聊优惠券"的部分也去掉。

---

## 9. Prompt Builder — 10 段 System Prompt 模板

| 维度 | 内容 |
|------|------|
| **在哪里** | [`prompt-builder.ts`](apps/api/src/client/ai-customer/graph/agents/prompt-builder.ts) — 第 140-186 行 |
| **为什么** | 所有 Agent 的 System Prompt 结构一致。如果直接手写，容易遗漏关键安全规则（Scope Restriction、Current User 等）。模板化确保一致性。 |
| **是什么** | 10 段式 Prompt 模板生成器：Role → Current User → Flow Context → Workflow → Available Tools → Domain Rules → Hard Rules → Example → Display Format → Extra Sections。 |
| **如何做** | `buildAgentPrompt(config)` → 传入 `AgentPromptConfig` → 输出完整 System Prompt 字符串。 |

**生活类比** 📝
> 这就像每个新员工入职时的"岗位说明书"，模板是统一的：
> 1. 你是谁（Role）
> 2. 你的客户是谁（Current User）
> 3. 现在项目进度（Flow Context）
> 4. 你的工作流程（Workflow）
> 5. 你的工具箱（Available Tools）
> 6. 部门规范（Domain Rules）
> 7. 公司红线（Hard Rules）
> 8. 参考案例（Example）
> 9. 输出格式要求（Display Format）
> 10. 补充说明（Extra Sections）

---

## 10. Supervisor 模式 — 多 Agent 协作

| 维度 | 内容 |
|------|------|
| **在哪里** | [`supervisor.node.ts`](apps/api/src/client/ai-customer/graph/nodes/supervisor.node.ts) — 全部 + [`customer.graph.ts`](apps/api/src/client/ai-customer/graph/customer.graph.ts) 第 45-55 行 |
| **为什么** | 用户一句话涉及多个领域（"查余额和订单"），需要多个 Agent 协作。Supervisor 模式 = 任务分解 + 结果汇总。 |
| **是什么** | IntentRouter 检测到多领域 → 输出 `intent='supervised'` + `tasks[]` → supervisorNode 计数轮次 → supervisorRouter 按轮次派发 Agent → agentDoneRouter 检查是否继续。 |
| **如何做** | `supervisorRouter` 根据 `round - 1` 作为 `taskIndex` 取 `pendingTasks[taskIndex].agent`。所有任务完成 → 返回 `answerSynthesizer`。 |

**生活类比** 👨‍🏭
> 这就像一个车间主任。用户说"帮我看看余额和订单状态"→ 车间主任（supervisorNode）给两个班组派活：班组 A 查余额，班组 B 查订单。A 干完活回来交差，主任说"好，下一个 B 去"。B 干完回来，主任说"两个都完成了，交给包装工合成一个回复"。

---

## 11. Answer Synthesizer — 结果合成为自然语言

| 维度 | 内容 |
|------|------|
| **在哪里** | [`answer-synthesizer.node.ts`](apps/api/src/client/ai-customer/graph/nodes/answer-synthesizer.node.ts) — 第 66-134 行 |
| **为什么** | Agent 返回的是原始数据 JSON，用户需要听自然语言回复。合成器把这些数据"翻译"成友好、专业的客服话术。 |
| **是什么** | 一个 LLM 调用，用 `{agentOutput}` 和 `{userInput}` 填充 Prompt，生成最终回复。还负责清空旧状态（taskResults、pendingTasks）。 |
| **如何做** | 合并 `taskResults` 中所有 Agent 的输出 → 过滤越权声明（`cleanResult`）→ 调用 LLM 生成回复 → 写入 `messages` 数组。 |

**生活类比** 🎤
> 这就像一个同声传译员。Agent 们给你的是"数据语言"（JSON、数字、状态码），Answer Synthesizer 把它"翻译"成人话。比如 Agent 返回 `[walletAgent]: Balance is 1500.50` → 合成器说"亲，您的钱包余额是 1500.50 元哦，请问还有什么需要帮忙的吗？"

---

## 12. General Chat — 闲聊 fallback

| 维度 | 内容 |
|------|------|
| **在哪里** | [`general-chat.node.ts`](apps/api/src/client/ai-customer/graph/nodes/general-chat.node.ts) — 第 44-73 行 |
| **为什么** | 用户不会只问业务问题，也会打招呼、问好、闲聊。需要专门的"聊天模式"处理。也是 unknown 意图的兜底节点。 |
| **是什么** | 纯 LLM 对话节点，不绑定任何工具。输出直接作为最终回复。 |
| **如何做** | 只传用户输入给 LLM → 生成回复 → 写入 `taskResults` + `messages`。 |

**生活类比** 🗣️
> 就像客服中心里的"闲聊专线"。你打电话说"你好，今天天气不错"→ 自动转接到闲聊专线，那边有个机器人陪你聊天。你说"我要查订单"→ 再转接到"业务专线"（其他 Agent）。

---

## 对照速查：面试概念 → 代码位置

| 技术概念 | 生活类比 | 代码位置 |
|---------|---------|---------|
| StateGraph / 状态图 | 工厂流水线总图 | [`customer.graph.ts`](apps/api/src/client/ai-customer/graph/customer.graph.ts) |
| Reducer / 状态管理 | 白板擦写规则 | [`state.ts`](apps/api/src/client/ai-customer/graph/state.ts) |
| Factory Pattern / 工厂模式 | 万能插座转换器 | [`llm-factory.ts`](apps/api/src/client/ai-customer/graph/llm-factory.ts) |
| Intent Classification / 意图分类 | 便利店分拣员 | [`intent-router.node.ts`](apps/api/src/client/ai-customer/graph/nodes/intent-router.node.ts) |
| ReAct Loop / 推理-行动循环 | 助理查资料 | [`agent-runner.ts`](apps/api/src/client/ai-customer/graph/agents/agent-runner.ts) |
| Registry Pattern / 注册模式 | 工具箱贴标签 | [`tool-registry.service.ts`](apps/api/src/client/ai-customer/graph/tools/tool-registry.service.ts) |
| Union Type / 联合类型 | 快递标准箱 | [`tool-result.ts`](apps/api/src/client/ai-customer/graph/tools/tool-result.ts) |
| Context Filtering / 上下文过滤 | 整理聊天记录 | [`prepare-context.ts`](apps/api/src/client/ai-customer/graph/utils/prepare-context.ts) |
| Template Method / 模板方法 | 岗位说明书模板 | [`prompt-builder.ts`](apps/api/src/client/ai-customer/graph/agents/prompt-builder.ts) |
| Supervisor Pattern / 监督模式 | 车间主任派工 | [`supervisor.node.ts`](apps/api/src/client/ai-customer/graph/nodes/supervisor.node.ts) |
| Result Synthesis / 结果合成 | 同声传译员 | [`answer-synthesizer.node.ts`](apps/api/src/client/ai-customer/graph/nodes/answer-synthesizer.node.ts) |
| Fallback / 兜底策略 | 闲聊专线 | [`general-chat.node.ts`](apps/api/src/client/ai-customer/graph/nodes/general-chat.node.ts) |
| Chain of Responsibility / 职责链 | 地铁线路换乘 | [`customer.graph.ts`](apps/api/src/client/ai-customer/graph/customer.graph.ts) |
| Builder Pattern / 建造者模式 | 组装汉堡（一层层加） | [`agent-result.ts`](apps/api/src/client/ai-customer/graph/agents/agent-result.ts) |
