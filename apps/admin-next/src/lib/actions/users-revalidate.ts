'use server';

import { revalidateTag } from 'next/cache';
import { USERS_LIST_TAG } from '@/lib/cache/users-cache';

/**
 * 用户写操作后触发（封禁/解封/资料更新）：
 * 1) 失效 users 页列表的 Next Data Cache
 * 2) 失效 Dashboard 统计卡片（用户数等指标）
 *
 * 客户端查询缓存由 useMutation 的 onSuccess / onSettled 负责刷新。
 */
export async function revalidateUsersList(): Promise<void> {
  revalidateTag(USERS_LIST_TAG);
  revalidateTag('dashboard:stats');
}
