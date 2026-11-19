import { Logger } from '@nestjs/common';
import { getRequestUserId } from '@api/common/logger/trace-context';

const logger = new Logger('ToolIdentity');

/** 统一失败文案：工具拒绝执行，而不是回退到不可信身份。 */
export const MISSING_USER_CONTEXT = 'Missing request user context';

/**
 * 读取当前请求的登录用户。
 *
 * AI 工具是启动时注册的全局单例，身份只能来自 AsyncLocalStorage
 * 请求上下文。没有上下文时返回 null，调用方必须 fail-closed；
 * 绝不能回退到模型传参、默认用户或上一个请求的身份。
 */
export function requireToolUserId(toolName: string): string | null {
  const userId = getRequestUserId();
  if (!userId) {
    logger.error(`[${toolName}] missing request user context`);
    return null;
  }
  return userId;
}
