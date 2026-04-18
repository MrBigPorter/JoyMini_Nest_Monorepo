/**
 * 防御性Hook库索引文件
 *
 * 根据.clinerules宪法v2.0要求，所有涉及浏览器API、客户端状态、异步操作的逻辑
 * 必须使用防御性Hook来避免水合错误和运行时错误。
 *
 * 使用原则：
 * 1. 所有依赖客户端状态的Class或组件，必须通过`useIsClient` Hook判断
 * 2. 所有动态导入的可选依赖必须使用`useOptionalModule` Hook
 * 3. 所有可能为null/undefined的值必须使用`useSafeAccess` Hook
 * 4. 所有浏览器API访问必须通过`useBrowserAPI` Hook
 * 5. 所有媒体查询必须通过`useMediaQuery` Hook
 * 6. 频繁触发的事件必须使用防抖(`useDebounce`)或节流(`useThrottle`)
 * 7. 所有异步操作必须考虑竞态条件(`useRaceConditionGuard`)
 */

export { useIsClient } from './useIsClient';
export { useOptionalModule } from './useIsClient';
export { useSafeAccess } from './useIsClient';
export { useBrowserAPI } from './useIsClient';
export { useMediaQuery } from './useIsClient';
export { useDebounce } from './useIsClient';
export { useThrottle } from './useIsClient';
export { useRaceConditionGuard } from './useIsClient';

// 项目特定Hook
export { useAuth } from './useAuth';
export { useArticles } from './useArticles';
export { useArticlesInfiniteQuery } from './useArticlesInfiniteQuery';
export { useBookmarks } from './useBookmarks';
export { useBookmarksInfiniteQuery } from './useBookmarksInfiniteQuery';
export { useCategories } from './useCategories';
export { useComments } from './useComments';
export { useCommentsInfiniteQuery } from './useCommentsInfiniteQuery';
export { useConfirm } from './useConfirm';
export { useEnvironment } from './useEnvironment';
export { useFrontendArticles } from './useFrontendArticles';
export { useInfiniteScrollDetection } from './useInfiniteScrollDetection';
export { useKeyboardShortcut } from './useKeyboardShortcut';
export { useTags } from './useTags';
export { useToast } from './useToast';
export { useBatchBookmarkStatus } from './useBatchBookmarkStatus';
