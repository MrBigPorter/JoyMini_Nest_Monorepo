'use server';

import { revalidateTag } from 'next/cache';
import { ORDERS_LIST_TAG } from '@/lib/cache/orders-cache';

/**
 * 订单写操作后触发：
 * 1) 失效 orders 页列表缓存
 * 2) 失效 dashboard 最近订单缓存
 */
export async function revalidateOrdersList(): Promise<void> {
  revalidateTag(ORDERS_LIST_TAG);
  revalidateTag('dashboard:orders');
}
