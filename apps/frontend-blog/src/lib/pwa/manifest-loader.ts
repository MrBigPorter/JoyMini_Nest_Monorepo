/**
 * PWA Manifest加载工具
 * 处理多语言manifest动态加载
 */

import { LOCALES, DEFAULT_LOCALE } from '@/lib/i18n/config';

/**
 * 动态加载对应语言的manifest文件
 * @param locale 语言代码 (zh, en, ja, ko等)
 */
export function loadManifestByLocale(locale: string): void {
  if (typeof document === 'undefined') return;

  const manifestUrl = `/manifest-${locale}.json`;

  // 移除现有的manifest链接
  const existingLinks = document.querySelectorAll('link[rel="manifest"]');
  existingLinks.forEach((link) => link.remove());

  // 创建新的manifest链接
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = manifestUrl;
  document.head.appendChild(link);

  console.log(`已加载 ${locale} 语言的manifest文件`);
}

/**
 * 获取当前应该使用的manifest语言
 * 根据URL路径、localStorage或浏览器语言自动判断
 */
export function getManifestLocale(): string {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;

  // 1. 从URL路径获取
  const pathLocale = window.location.pathname.split('/')[1];
  if (pathLocale && LOCALES.includes(pathLocale as (typeof LOCALES)[number])) {
    return pathLocale;
  }

  // 2. 从localStorage获取
  const storedLocale = localStorage.getItem('locale');
  if (
    storedLocale &&
    LOCALES.includes(storedLocale as (typeof LOCALES)[number])
  ) {
    return storedLocale;
  }

  // 3. 从浏览器语言获取
  const browserLang = navigator.language.toLowerCase();

  // 检查浏览器语言是否匹配支持的语言
  for (const locale of LOCALES) {
    if (browserLang.startsWith(locale)) {
      return locale;
    }
  }

  // 4. 默认返回默认语言
  return DEFAULT_LOCALE;
}

/**
 * 初始化manifest加载
 * 应该在应用启动时调用
 */
export function initManifestLoader(): void {
  if (typeof window === 'undefined') return;

  const locale = getManifestLocale();
  loadManifestByLocale(locale);

  // 监听语言变化
  const observer = new MutationObserver(() => {
    const newLocale = getManifestLocale();
    const currentManifest = document
      .querySelector('link[rel="manifest"]')
      ?.getAttribute('href');
    const expectedManifest = `/manifest-${newLocale}.json`;

    if (currentManifest !== expectedManifest) {
      loadManifestByLocale(newLocale);
    }
  });

  // 观察body的lang属性变化
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['lang'],
  });

  // 监听localStorage变化
  window.addEventListener('storage', (event) => {
    if (event.key === 'locale') {
      const newLocale = event.newValue || DEFAULT_LOCALE;
      loadManifestByLocale(newLocale);
    }
  });
}

/**
 * 获取manifest配置
 * 用于动态生成meta标签等
 */
export interface ManifestConfig {
  name: string;
  short_name: string;
  description: string;
  theme_color: string;
  background_color: string;
  display: string;
  orientation: string;
  start_url: string;
}

/**
 * 获取默认manifest配置
 */
export function getDefaultManifestConfig(): ManifestConfig {
  return {
    name: 'JoyMinis Blog',
    short_name: 'JoyMinis',
    description: 'JoyMinis技术博客 - 探索前端与全栈开发',
    theme_color: '#3b82f6',
    background_color: '#ffffff',
    display: 'standalone',
    orientation: 'portrait',
    start_url: '/?source=pwa',
  };
}

/**
 * 生成PWA相关的meta标签HTML
 */
export function generatePWAMetaTags(locale: string = DEFAULT_LOCALE): string {
  const config = getDefaultManifestConfig();
  const manifestUrl = `/manifest-${locale}.json`;

  return `
    <link rel="manifest" href="${manifestUrl}" />
    <meta name="theme-color" content="${config.theme_color}" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="${config.short_name}" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta name="msapplication-TileColor" content="${config.theme_color}" />
    <meta name="msapplication-config" content="/browserconfig.xml" />
    <meta name="application-name" content="${config.name}" />
    <meta name="mobile-web-app-capable" content="yes" />
  `.trim();
}
