import { getRequestConfig } from 'next-intl/server';

// 支持的语言列表
const locales = ['zh-CN', 'en'];

//  完全官方标准实现，没有任何hack
export default getRequestConfig(async ({ locale }) => {
  // 【服务端】 getRequestConfig 执行

  // 验证语言是否支持
  if (!locales.includes(locale as any)) {
    locale = 'zh-CN';
  }

  const messages = (await import(`./src/messages/${locale}.json`)).default;

  return {
    locale,
    messages,
  };
});
