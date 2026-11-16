/**
 * 跨版本续话告知
 *
 * ── 解决什么？ ──
 * 用户 10:00 问退款政策，AI 答「7 个工作日」。10:05 政策改成 5 个工作日。
 * 10:06 用户追问「那我这单能退吗」——检索拿到的是新版内容，
 * 但上下文里还留着 AI 自己说的「7 个工作日」，模型倾向于自我一致。
 *
 * 显式告诉模型（并让它转告用户）「知识库更新了，以最新为准」，打断这个惯性。
 *
 * ── 为什么按用户而不是按会话？ ──
 * 按会话的话，用户在另一个会话里还会拿到旧口径；按用户只告知一次，
 * 覆盖面更大，代价是极少数无关追问也会看到这一句。
 */

import type { RedisService } from '@api/common/redis/redis.service';

/** 全局版本纪元：每次有文档切换版本就更新 */
export const KB_EPOCH_KEY = 'kb:version:epoch';

/** 告知语在 Redis 里保留多久（7 天，与 chunk 保留期一致） */
const NOTICE_TTL_SEC = 7 * 24 * 60 * 60;

/** 某个用户上一轮回答时所用的版本纪元 */
export function kbUserEpochKey(userId: string): string {
  return `kb:user:${userId}:epoch`;
}

/**
 * 版本变了就返回告知语，否则返回 null。
 * 任何一侧缺失（首次对话 / Redis 故障）都不告知——不能因为版本信息拿不到而打扰用户。
 */
export function buildKbVersionNotice(
  previousEpoch: string | null | undefined,
  currentEpoch: string | null | undefined,
): string | null {
  if (!previousEpoch || !currentEpoch) return null;
  if (previousEpoch === currentEpoch) return null;

  return (
    '注意：知识库内容已更新。以下回答以最新内容为准；' +
    '如果与之前对话中的信息冲突，请明确告知用户以本次为准。'
  );
}

/**
 * 读取该用户的版本纪元、与当前纪元比较，返回需要注入的告知语（没有则 null）。
 * 顺带把当前纪元写回去，作为「上一轮用过的版本」。
 *
 * Redis 不可用时返回 null —— 少一次告知，不能影响回答。
 */
export async function takeKbVersionNotice(
  redis: RedisService | undefined,
  userId: string,
): Promise<string | null> {
  if (!redis) return null;

  try {
    const current = await redis.get(KB_EPOCH_KEY);
    if (!current) return null;

    const key = kbUserEpochKey(userId);
    const previous = await redis.get(key);
    const notice = buildKbVersionNotice(previous, current);

    // 无论是否告知，都把当前纪元记为「这个用户已经看过的最新版本」
    await redis.set(key, current, NOTICE_TTL_SEC);
    return notice;
  } catch {
    return null;
  }
}
