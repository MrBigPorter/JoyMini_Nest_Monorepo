/**
 * Apple Universal Links — AASA Route Handler
 *
 * iOS 系统会请求 /.well-known/apple-app-site-association（无扩展名）
 * 必须返回 Content-Type: application/json，否则系统忽略该文件，
 * 点击 tarsierlabs.app 链接会打开 Safari 而不是 App。
 *
 * 用 Route Handler 而不是 public/ 静态文件，是因为：
 *   - public/ 静态文件无法精确控制 Content-Type（Next.js 按扩展名猜测，无扩展名返回 octet-stream）
 *   - Route Handler 明确设置头部，不依赖 nginx 或任何中间层配置
 */

import { NextResponse } from 'next/server';

const AASA_CONTENT = {
  applinks: {
    apps: [],
    details: [
      {
        appID: 'A1B2C3D4E5.com.porter.joyminis',
        paths: ['/group/*', '/oauth/callback'],
      },
      {
        appID: 'A1B2C3D4E5.com.porter.joyminis.test',
        paths: ['/group/*', '/oauth/callback'],
      },
      {
        appID: 'PK28T343BP.com.tarsier.labs',
        paths: ['*', 'NOT /_next/*', 'NOT /__/*'],
      },
    ],
  },
};

export async function GET() {
  return new NextResponse(JSON.stringify(AASA_CONTENT, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
