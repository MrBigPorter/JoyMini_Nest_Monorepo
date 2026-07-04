import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { AgentStep } from '@api/client/ai-customer/graph/types/agent-types';
import {
  FlowType,
  FlowStatus,
  getInitialStatus,
} from '@api/client/ai-customer/graph/types/flow-types';

/**
 * ================================================================
 * AgentState — LangGraph 状态定义（14 个字段）
 * ================================================================
 *
 * ── 是什么？ ──
 * Annotation.Root() 是 LangGraph 的状态容器。每个属性 = 一个 Annotation，
 * 每个 Annotation 有 reducer（新旧值如何合并）和 default（初始值）。
 *
 * ── 为什么用这个模式？ ──
 * LangGraph 支持多个 Node 并行执行。没有 Reducer，两个 Node 同时写一个字段会冲突。
 * 有了 Reducer，LangGraph 知道：覆盖？合并？追加？
 *
 * ── 生活类比：挂在墙上的白板 ──
 * 每个工人（Node）上班第一件事是看白板上写了什么，干完活后把结果写在白板上。
 * reducer 是白板的擦写规则：有些格子（intent）只能写最新值（覆盖），
 * 有些格子可以"在上面加内容"（合并），有些格子只能追加不能擦除（messages）。
 *
 * Reducer 类型说明：
 * - replace (a, b) => b：覆盖旧值（intent, flowType 等）
 * - merge  ({...a, ...b})：合并对象（flowData, taskResults）
 * - concat a.concat(b)：追加数组（messages, agentSteps, sources）
 *
 * ===== 14 个字段概览 =====
 *
 * ── 核心对话（3 个） ──
 * 1. messages:      对话消息列表。就像会议录音带，从头录到尾，不删减。
 * 2. intent:        当前意图（intentRouter 设置）。就像今天的任务标签。
 * 3. userId:        用户唯一标识。就像工牌号，区分不同员工。
 *
 * ── Supervisor 多 Agent（4 个） ──
 * 4. pendingTasks:  待处理的多 Agent 任务列表。就像车间派工单。
 * 5. taskResults:   子 Agent 执行结果汇总。就像各车间交上来的报告。
 * 6. supervisorRound: 轮次计数器。防止死循环，最多 5 轮。
 * 7. agentSteps:    Agent 执行日志。工人每一步的"操作记录"，前端展示用。
 *
 * ── RAG（1 个） ──
 * 8. sources:       知识文档来源。可追加，用于展示"信息来源"。
 *
 * ── Flow 状态管理（4 个） ──
 * 9. flowType:      业务类型（DEPOSIT/WITHDRAWAL 等）。像订单类型。
 * 10. flowStatus:    流程状态（IDLE→FILLING→CONFIRMING）。像进度条。
 * 11. flowData:      表单数据。像填写的表格，一步步往里填。
 * 12. currentAgent:  当前 Agent 名称。谁在处理这个请求。
 *
 * ── 路由（1 个） ──
 * 13. messageTopics: Human 消息话题标记。像邮件标签，用于按话题过滤。
 *
 * ── 调试（1 个） ──
 * 14. debug:         调试模式开关。像是否开引擎盖检查内部运转。
 */
export const AgentState = Annotation.Root({

  /**
   * ================================================================
   * messages — 对话消息列表
   * ================================================================
   *
   * ── 是什么？ ──
   * 核心数据。messagesStateReducer 是 LangGraph 内置的 reducer，自动追加新消息。
   *
   * ── 为什么用 concat？ ──
   * 对话历史必须全部保留。用户每说一句话追加一个 HumanMessage，
   * Agent 每回复一句话追加一个 AIMessage。不能覆盖，不能丢弃。
   *
   * ── 生活类比 ──
   * 就像微信聊天记录。你每发一条消息，对话框里就多一条记录。
   * 不会因为新消息而覆盖旧消息。Agent 也是同样的道理。
   *
   * ── 怎么用？ ──
   * const newState = { messages: [...state.messages, newAIMessage] };
   * messagesStateReducer 会自动处理追加。
   */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  /**
   * ================================================================
   * intent — 当前意图
   * ================================================================
   *
   * ── 是什么？ ──
   * intentRouter Node 把用户输入分类后的结果。如 'order' / 'wallet' / 'coupon' 等。
   *
   * ── 为什么用覆盖？ ──
   * 用户每轮只能有一种意图（即使说"查余额和订单"，也会被分类为 'supervised' 多领域）。
   * 意图是唯一的，所以用覆盖 reducer: (a, b) => b。
   *
   * ── 生活类比 ──
   * 就像你今天的工作状态：要么在"处理订单"模式，要么在"处理退款"模式。
   * 不可能同时处于两种模式。新状态覆盖旧状态。
   */
  intent: Annotation<string>({
    reducer: (a: string, b: string) => b,
    default: () => '',
  }),

  /**
   * ================================================================
   * previousIntent — 上一轮意图
   * ================================================================
   *
   * ── 是什么？ ──
   * answerSynthesizer 在每轮结束时把 state.intent 存到这里。
   * 下一轮 intentRouter 用 previousIntent 来判断"用户是否是继续上一轮的话题"。
   *
   * ── 为什么需要？ ──
   * 用户可能只说"确认"或"好的"。没有 previousIntent，系统不知道"确认什么"。
   * 有了它，intentRouter 就知道"用户之前在处理 wallet，所以'确认'=确认取款"。
   *
   * ── 生活类比 ──
   * 就像客服接到电话："喂，我上次问的那个事怎么样了？"
   * 客服需要查上一通电话的记录（previousIntent）才能知道"那个事"是什么。
   */
  previousIntent: Annotation<string>({
    reducer: (a: string, b: string) => b,
    default: () => '',
  }),

  /**
   * ================================================================
   * pendingTasks — 多 Agent 待办任务列表
   * ================================================================
   *
   * ── 是什么？ ──
   * Supervisor 模式下的任务队列。非空 = 当前在 supervisor 模式（多 Agent 协作）。
   * 空数组 = 单 Agent 模式。
   *
   * ── 为什么用覆盖？ ──
   * pendingTasks 每轮由 intentRouter 重新设置（或清空），不需要合并旧任务。
   * 比如上一轮 pendingTasks = [taskA, taskB]，本轮 intentRouter 清空 → []。
   *
   * ── 生活类比 ──
   * 就像车间主任的派工单：["A 组查余额", "B 组查订单"]。
   * 派工单是每轮重新写的，不会把上一轮的旧单子加上去。
   */
  pendingTasks: Annotation<Array<{ agent: string; description: string }>>({
    reducer: (a, b) => b,
    default: () => [],
  }),

  /**
   * ================================================================
   * taskResults — 子 Agent 执行结果汇总
   * ================================================================
   *
   * ── 是什么？ ──
   * 每个 Agent 完成任务后，结果写到这里。key = agent 名称，value = 结果内容。
   *
   * ── 为什么用 merge + 特殊空对象处理？ ──
   * 多个 Agent 的结果需要合并（不能覆盖）。但 answerSynthesizer 需要能清空旧结果。
   * 空对象 {} 触发清空（Object.keys(b).length === 0 → return {}）。
   *
   * ── 生活类比 ──
   * 就像各车间交上来的报告。A 组交了"余额报告"→ 放进文件夹。
   * B 组交了"订单报告"→ 也放进同一个文件夹。
   * 但如果新来的任务需要清空文件夹 → 传入空对象 {} 清空。
   */
  taskResults: Annotation<Record<string, any>>({
    reducer: (a, b) => {
      if (Object.keys(b).length === 0) return {};
      return { ...a, ...b };
    },
    default: () => ({}),
  }),

  /**
   * ================================================================
   * supervisorRound — 轮次计数器
   * ================================================================
   *
   * ── 是什么？ ──
   * Supervisor 模式下，每派发一个子任务就 +1。从 0 开始计数。
   *
   * ── 为什么需要？ ──
   * 防止死循环。如果 supervisorRouter 逻辑出错，round 会不断增长。
   * 达到 maxRounds（=5）时强制结束，走 answerSynthesizer。
   *
   * ── 生活类比 ──
   * 就像在电梯里按楼层：你按了 5 层→电梯到了→再按 4 层→电梯到了...
   * 但如果电梯系统出故障了，一直在 5 层和 4 层之间来回→
   * 有一个安全机制：最多跑 5 次，超过就报警停运。
   */
  supervisorRound: Annotation<number>({
    reducer: (a: number, b: number) => b,
    default: () => 0,
  }),

  /**
   * ================================================================
   * agentSteps — Agent 执行步骤日志
   * ================================================================
   *
   * ── 是什么？ ──
   * 记录 Agent 每一步做了什么：调了什么工具、查了什么数据、得到了什么结果。
   *
   * ── 为什么用 concat？ ──
   * 多个 Agent 的执行日志需要串联起来。每个 Node 追加自己的日志。
   * 前端 SSE 流式输出"思考链"，让用户看到 Agent 正在思考（像 ChatGPT 的"正在推理"）。
   *
   * ── 生活类比 ──
   * 就像工厂里的"操作日志"：09:00 A 组开始查余额 → 09:01 调用 getBalance 工具 →
   * 09:02 得到结果 → 09:03 完成。这些日志全部保留，用于审计和调试。
   */
  agentSteps: Annotation<AgentStep[]>({
    reducer: (a: AgentStep[], b: AgentStep[]) => a.concat(b),
    default: () => [],
  }),

  /**
   * ================================================================
   * sources — RAG 知识来源
   * ================================================================
   *
   * ── 是什么？ ──
   * 当用户问商品政策、退货规则等知识类问题时，RAG Node 从数据库检索相关文档。
   * 检索结果被追加到 sources 数组。
   *
   * ── 为什么需要？ ──
   * 前端可以展示"信息来源：xxx 文档"，增加可信度。也是审计追踪的依据。
   *
   * ── 生活类比 ──
   * 就像客服查手册："根据《退货政策》第 3 条第 2 款..."。
   * sources 记录了"我引用了哪份文档的哪一条"。
   */
  sources: Annotation<any[]>({
    reducer: (a: any[], b: any[]) => a.concat(b),
    default: () => [],
  }),

  /**
   * ================================================================
   * userId — 用户唯一标识
   * ================================================================
   *
   * ── 是什么？ ──
   * 当前用户的 ID。由 ai-customer.service.ts 在创建对话时传入。
   *
   * ── 为什么需要？ ──
   * 所有工具调用（查余额、查订单等）都需要 userId 作为参数。
   * 放在 state 里全局可用，避免每个工具都需要从消息中提取。
   *
   * ── 生活类比 ──
   * 就像你去银行办业务，柜员第一件事是看你的身份证号。
   * 所有后续操作（查余额、打流水、办汇款）都基于这个身份证号。
   * 不需要每办一个业务就掏一次身份证。
   */
  userId: Annotation<string>({
    reducer: (a: string, b: string) => b,
    default: () => '',
  }),

  /**
   * ================================================================
   * Phase 1 — Flow 状态管理（强类型）
   * ================================================================
   *
   * ── 这套机制是做什么的？ ──
   * 处理"多步骤业务流程"的状态跟踪，比如提现申请需要：
   * 1. 用户说"我要提现" → flowType=WITHDRAWAL, flowStatus=IDLE
   * 2. 用户输入金额 → flowStatus=FILLING, flowData.amount=100
   * 3. 用户确认 → flowStatus=CONFIRMING
   * 4. 执行提现 → flowStatus=COMPLETED
   *
   * ── 生活类比 ──
   * 就像你在网上填表买车险：第一步选方案（IDLE）、第二步填个人信息（FILLING）、
   * 第三步确认信息（CONFIRMING）、第四步付款（COMPLETED）。
   * 系统需要知道"你进行到哪一步了"，才能正确处理你的下一步操作。
   */

  /** 当前业务类型（如 DEPOSIT、WITHDRAWAL、ORDER_QUERY 等） */
  flowType: Annotation<FlowType>({
    reducer: (a: FlowType, b: FlowType) => b,
    default: () => '' as FlowType,
  }),
  /** 当前业务流程状态（如 IDLE、FILLING、CONFIRMING 等） */
  flowStatus: Annotation<FlowStatus>({
    reducer: (a: FlowStatus, b: FlowStatus) => b,
    default: () => 'IDLE' as FlowStatus,
  }),
  /**
   * ================================================================
   * flowData — 业务流程表单数据
   * ================================================================
   *
   * ── 为什么这个 reducer 最复杂？ ──
   * 三种情况的处理：
   * 1. b == null（undefined/null）= Node 没指定 flowData，保持现有数据不变
   * 2. b == {}（空对象）= 显式清空（话题切换时清空旧数据）
   * 3. 正常合并（Agent 通过 updateFlowData 逐步填充表单数据）
   *
   * ── 生活类比 ──
   * 就像你填一份申请表：
   * - 你填了姓名（→ { name: "小明" }）→ 合并到表格
   * - 你再填了电话（→ { phone: "123" }）→ 合并到表格，不覆盖姓名
   * - 换了一个业务（→ {}）→ 换成空白表格
   * - 什么也没填（→ null）= 保持当前表格不变
   */
  flowData: Annotation<Record<string, any>>({
    reducer: (a: Record<string, any>, b: Record<string, any>) => {
      // undefined/null = 节点未指定 flowData，保持现有数据不变
      if (b == null) return a;
      // 空对象 = 显式清空（话题切换时 intentRouter 传入 {}）
      if (Object.keys(b).length === 0) return {};
      // 正常合并（agent 通过 updateFlowData 逐步填充）
      return { ...a, ...b };
    },
    default: () => ({}),
  }),
  /** 当前正在执行的 Agent 名称（用于日志和中断恢复） */
  currentAgent: Annotation<string>({
    reducer: (a: string, b: string) => b,
    default: () => '',
  }),

  /**
   * ================================================================
   * Phase 3 — Message Topic Tracking（Human 消息按话题标记）
   * ================================================================
   *
   * ── 是什么？ ──
   * 记录每条 Human 消息被 intentRouter 分类时的 intent。
   * key = 消息在 state.messages 中的索引
   * value = intentRouter 分类结果（如 'coupon', 'wallet', 'supervised'）
   *
   * ── 为什么需要？ ──
   * Supervisor 模式下，多个 Agent 并行工作。不能把"优惠券"的 Human 消息发给"钱包" Agent。
   * messageTopics 就像每封邮件的"标签"——Gmail 的收件箱标签一样。
   * 有了标签，prepareAgentContext 可以按话题过滤，只保留当前 Agent 相关的消息。
   *
   * ── 生活类比 ──
   * 就像公司的收件室。每个部门有自己的邮箱（Agent）。
   * 信件（Human 消息）进来时，分拣员（intentRouter）在上面贴标签"财务部"或"销售部"。
   * 之后送信员（prepareAgentContext）只把"财务部"标签的信件放到财务部的邮箱里。
   */
  messageTopics: Annotation<Record<number, string>>({
    reducer: (a: Record<number, string>, b: Record<number, string>) => ({
      ...a,
      ...b,
    }),
    default: () => ({}),
  }),

  /**
   * ================================================================
   * debug — 调试模式开关
   * ================================================================
   *
   * ── 是什么？ ──
   * 开关变量。true 时 Agent 会输出完整的消息链到 agentSteps，方便调试。
   * 由外部调用时传入（如 testChat API）。
   */
  debug: Annotation<boolean>({
    reducer: (a: boolean, b: boolean) => b,
    default: () => false,
  }),
});
