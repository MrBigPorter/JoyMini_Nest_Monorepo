/**
 * Android App Links — assetlinks.json Route Handler
 *
 * Android 系统会请求 /.well-known/assetlinks.json
 * 必须返回 Content-Type: application/json，否则系统校验失败，
 * 点击 tarsierlabs.app 链接会打开 Chrome 而不是 App。
 *
 * 用 Route Handler 明确控制 Content-Type，不依赖 nginx 或静态文件 MIME 推断。
 * （public/assetlinks.json 静态文件保留作为备用，Route Handler 优先级更高）
 */

import { NextResponse } from 'next/server';

const ASSET_LINKS_CONTENT = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.tarsier.labs',
      sha256_cert_fingerprints: [
        '93:C0:D3:0B:5B:61:51:63:BA:C1:4C:45:36:80:09:CB:76:F3:74:5F:AA:2B:06:9B:EE:62:93:0D:79:6E:5D:97',
      ],
    },
  },
];

export async function GET() {
  return new NextResponse(JSON.stringify(ASSET_LINKS_CONTENT, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

