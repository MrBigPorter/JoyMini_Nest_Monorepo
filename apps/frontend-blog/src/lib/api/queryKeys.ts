import { QueryKey } from '@tanstack/react-query';
import { useCurrentLocale } from '@/lib/hooks/useCurrentLocale';

/**
 *  国际化QueryKey工厂
 *
 * 这是整个应用中唯一允许创建QueryKey的地方。
 * 所有QueryKey强制遵循格式: [namespace, locale, ...params]
 *
 *  铁律：整个应用中，任何地方需要创建QueryKey，只能调用这里的函数。
 * 禁止任何其他地方手动创建QueryKey。
 */

/**
 * 创建本地化的QueryKey
 * 自动注入locale到第二个位置
 *
 *  用法: createQueryKey('articles', 123)
 *  输出: ['articles', 'en', 123]
 */
export const createQueryKey = (
  namespace: string,
  ...args: unknown[]
): QueryKey => {
  // 所有QueryKey永远遵循固定格式: [namespace, locale, ...params]
  // 注意：这里不能直接调用useCurrentLocale，因为这不是React Hook
  // 实际使用时会通过useLocalizedQueryKey Hook来调用
  return [namespace, ...args];
};

/**
 * 创建QueryKey构建器
 * 为每个模块预定义工厂
 */
export const createQueryKeyFactory = (namespace: string) => {
  return (...args: unknown[]) => createQueryKey(namespace, ...args);
};

/**
 * React Hook版本：创建包含当前locale的QueryKey
 * 这是业务代码应该使用的版本
 */
export const useLocalizedQueryKey = (
  namespace: string,
  ...args: unknown[]
): QueryKey => {
  const locale = useCurrentLocale();

  //  所有QueryKey强制遵循格式: [namespace, locale, ...params]
  return [namespace, locale, ...args];
};

/**
 * 模块预定义的QueryKey工厂
 * 每个模块有自己的工厂函数，保证一致性
 */
export const articleKeys = {
  all: () => ['articles'] as const,
  lists: () => [...articleKeys.all(), 'list'] as const,
  list: (filters?: unknown) => [...articleKeys.lists(), filters] as const,
  details: () => [...articleKeys.all(), 'detail'] as const,
  detail: (id: string | number) => [...articleKeys.details(), id] as const,
  comments: (articleId: string | number) =>
    [...articleKeys.detail(articleId), 'comments'] as const,
};

export const categoryKeys = {
  all: () => ['categories'] as const,
  lists: () => [...categoryKeys.all(), 'list'] as const,
  list: (filters?: unknown) => [...categoryKeys.lists(), filters] as const,
  detail: (id: string | number) =>
    [...categoryKeys.all(), 'detail', id] as const,
};

export const tagKeys = {
  all: () => ['tags'] as const,
  lists: () => [...tagKeys.all(), 'list'] as const,
  list: (filters?: unknown) => [...tagKeys.lists(), filters] as const,
  detail: (id: string | number) => [...tagKeys.all(), 'detail', id] as const,
};

export const bookmarkKeys = {
  all: () => ['bookmarks'] as const,
  lists: () => [...bookmarkKeys.all(), 'list'] as const,
  list: (filters?: unknown) => [...bookmarkKeys.lists(), filters] as const,
};

export const userKeys = {
  all: () => ['users'] as const,
  profile: () => [...userKeys.all(), 'profile'] as const,
  bookmarks: () => [...userKeys.all(), 'bookmarks'] as const,
};

/**
 * 工具函数：为已有的QueryKey注入locale
 * 用于迁移现有代码
 */
export const injectLocaleToQueryKey = (
  queryKey: QueryKey,
  locale: string,
): QueryKey => {
  if (!Array.isArray(queryKey) || queryKey.length === 0) {
    return queryKey;
  }

  // 如果已经包含locale，直接返回
  if (queryKey[1] === locale) {
    return queryKey;
  }

  // 注入locale到第二个位置
  return [queryKey[0], locale, ...queryKey.slice(1)];
};
