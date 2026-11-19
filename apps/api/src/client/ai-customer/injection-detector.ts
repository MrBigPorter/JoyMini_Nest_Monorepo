/**
 * 输入注入检测（agent-trust-boundary 3.x）
 *
 * 只做模式匹配，不调用模型：
 *   - prompt_override：要求忽略/覆盖系统指令、进入开发者模式
 *   - internal_probe：索取系统提示、工具清单、密钥、内部结构
 *   - privilege_probe：冒充管理员/客服，要求越权访问他人数据
 *
 * 检测结果只记录类型与长度，不记录用户原文（#89 FR-7）。
 * 默认关闭，需 AI_INJECTION_DETECTION_ENABLED=true 才生效。
 */

export type InjectionType =
  | 'prompt_override'
  | 'internal_probe'
  | 'privilege_probe';

export interface InjectionResult {
  detected: boolean;
  type?: InjectionType;
}

const PATTERNS: Array<{ type: InjectionType; regex: RegExp }> = [
  {
    type: 'prompt_override',
    regex:
      /(忽略|无视|忘记|绕过|覆盖|ignore|disregard|forget|override).{0,20}(之前|以上|前面|系统|所有|previous|above|system|all).{0,20}(指令|提示|规则|设定|prompt|instruction|rule)|开发者模式|developer mode|jailbreak|越狱模式|act as (an? )?(admin|developer|system)/i,
  },
  {
    type: 'internal_probe',
    regex:
      /(系统提示词|系统提示|你的指令|你的设定|内部结构|内部实现|源代码|工具列表|工具清单|函数列表|api[\s-]?key|密钥|数据库结构|表结构|system prompt|your instructions|internal (structure|implementation)|source code|list (your )?tools|database schema)/i,
  },
  {
    type: 'privilege_probe',
    regex:
      /(我是|身为|作为).{0,6}(管理员|客服|开发者|超级管理员|admin|developer|support).{0,40}(别人|他人|所有用户|任意用户|其他用户|another user|all users|any user).{0,20}(给我|查看|查询|修改|删除|导出|show|view|query|update|delete|export)|(我是|身为|作为).{0,6}(管理员|客服|开发者|admin|developer|support).{0,20}(给我|查看|查询|修改|删除|导出|export).{0,20}(别人|他人|所有用户|任意用户|其他用户|another user|all users|any user)|越权|提权|绕过(权限|鉴权)|privilege escalation|bypass (auth|permission)/i,
  },
];

export function isInjectionDetectionEnabled(): boolean {
  return process.env.AI_INJECTION_DETECTION_ENABLED === 'true';
}

export function detectInjection(input: string): InjectionResult {
  for (const { type, regex } of PATTERNS) {
    if (regex.test(input)) return { detected: true, type };
  }
  return { detected: false };
}
