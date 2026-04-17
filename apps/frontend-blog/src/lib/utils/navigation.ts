/**
 * 导航工具函数
 * 提供通用的导航相关工具函数，避免重复逻辑
 */

/**
 * 智能路径匹配函数
 * 判断当前路径是否匹配目标路径，考虑语言前缀
 *
 * @param pathname 当前路径（如 '/zh/categories'）
 * @param href 目标路径（如 '/categories'）
 * @returns 是否匹配
 */
export function getIsActive(pathname: string, href: string): boolean {
  // 处理首页
  if (href === '/') {
    // 首页只匹配根路径或空路径
    // 包括：'/', '', '/zh', '/zh/' 等语言前缀首页
    return (
      pathname === '/' ||
      pathname === '' ||
      // 检查是否是语言前缀首页（如 '/zh' 或 '/zh/'）
      /^\/[a-z]{2}\/?$/.test(pathname)
    );
  }

  // 处理其他页面 - 支持子页面匹配
  // 例如：'/zh/categories/web-development' 应该匹配 '/categories'
  // 检查精确匹配或作为前缀匹配

  // 精确匹配：当前路径以目标路径结尾
  if (pathname.endsWith(href)) {
    return true;
  }

  // 子页面匹配：当前路径包含目标路径后跟斜杠
  // 例如：'/zh/categories/web-development' 包含 '/categories/'
  // 但需要确保不会误匹配，比如 '/categories-old' 不应该匹配 '/categories'
  // 所以检查 `${href}/` 而不是简单的 includes(href)
  if (pathname.includes(`${href}/`)) {
    return true;
  }

  return false;
}

/**
 * 导航项配置类型
 */
export interface NavItem {
  href: string;
  labelKey: string;
  icon?: React.ReactNode;
  label?: string;
}

/**
 * 获取基础导航项配置
 * 可以在不同导航组件中复用
 */
export function getBaseNavItems(t: (key: string) => string): NavItem[] {
  return [
    {
      href: '/',
      labelKey: 'common.home',
    },
    {
      href: '/categories',
      labelKey: 'common.categories',
    },
    {
      href: '/tags',
      labelKey: 'common.tags',
    },
    {
      href: '/bookmarks',
      labelKey: 'common.bookmarks',
    },
    {
      href: '/about',
      labelKey: 'common.about',
    },
  ];
}

/**
 * 检查是否是子页面
 * 例如：'/zh/categories/web-development' 是 '/categories' 的子页面
 */
export function isSubPage(pathname: string, parentHref: string): boolean {
  if (parentHref === '/') {
    return false; // 首页没有子页面
  }
  const pattern = new RegExp(`^.*${parentHref}/[^/]+$`);
  return pattern.test(pathname);
}

/**
 * 获取当前激活的导航项索引
 * 用于滑动指示器等需要索引的场景
 */
export function getActiveNavIndex(
  pathname: string,
  navItems: NavItem[],
): number {
  for (let i = 0; i < navItems.length; i++) {
    if (getIsActive(pathname, navItems[i].href)) {
      return i;
    }
  }
  return -1; // 没有匹配项
}
