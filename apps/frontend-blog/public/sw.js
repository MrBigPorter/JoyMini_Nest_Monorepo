if (!self.define) {
  let e,
    c = {};
  const s = (s, a) => (
    (s = new URL(s + '.js', a).href),
    c[s] ||
      new Promise((c) => {
        if ('document' in self) {
          const e = document.createElement('script');
          ((e.src = s), (e.onload = c), document.head.appendChild(e));
        } else ((e = s), importScripts(s), c());
      }).then(() => {
        let e = c[s];
        if (!e) throw new Error(`Module ${s} didn’t register its module`);
        return e;
      })
  );
  self.define = (a, i) => {
    const n =
      e ||
      ('document' in self ? document.currentScript.src : '') ||
      location.href;
    if (c[n]) return;
    let t = {};
    const f = (e) => s(e, n),
      o = { module: { uri: n }, exports: t, require: f };
    c[n] = Promise.all(a.map((e) => o[e] || f(e))).then((e) => (i(...e), t));
  };
}
define(['./workbox-fe2caf3f'], function (e) {
  'use strict';
  (importScripts(),
    self.skipWaiting(),
    e.clientsClaim(),
    e.precacheAndRoute(
      [
        {
          url: '/_next/app-build-manifest.json',
          revision: '289c521828b7e5d729aa4067c53202b9',
        },
        {
          url: '/_next/static/XOYWDVeHtsQW1l5bbRn7R/_buildManifest.js',
          revision: '2e148fb35139d208094ea0aa8f2f78fe',
        },
        {
          url: '/_next/static/XOYWDVeHtsQW1l5bbRn7R/_ssgManifest.js',
          revision: 'b6652df95db52feb4daf4eca35380933',
        },
        {
          url: '/_next/static/chunks/127-c2d06c6cf06ad678.js',
          revision: 'c2d06c6cf06ad678',
        },
        {
          url: '/_next/static/chunks/18-9b2e754c4e2c6f98.js',
          revision: '9b2e754c4e2c6f98',
        },
        {
          url: '/_next/static/chunks/211-3f691222f1b8c8f5.js',
          revision: '3f691222f1b8c8f5',
        },
        {
          url: '/_next/static/chunks/276.0fa7b7607be9ed67.js',
          revision: '0fa7b7607be9ed67',
        },
        {
          url: '/_next/static/chunks/287-4278c54ecd43916d.js',
          revision: '4278c54ecd43916d',
        },
        {
          url: '/_next/static/chunks/328-3e4c7d3609015bf4.js',
          revision: '3e4c7d3609015bf4',
        },
        {
          url: '/_next/static/chunks/375-a5758909a1f693f1.js',
          revision: 'a5758909a1f693f1',
        },
        {
          url: '/_next/static/chunks/462.981326fc6c7f56f5.js',
          revision: '981326fc6c7f56f5',
        },
        {
          url: '/_next/static/chunks/615-1fb0db7734391bd4.js',
          revision: '1fb0db7734391bd4',
        },
        {
          url: '/_next/static/chunks/664-c5092dbc8314718b.js',
          revision: 'c5092dbc8314718b',
        },
        {
          url: '/_next/static/chunks/735-a99275efb4ce7578.js',
          revision: 'a99275efb4ce7578',
        },
        {
          url: '/_next/static/chunks/739-ea7639cfc38af9b4.js',
          revision: 'ea7639cfc38af9b4',
        },
        {
          url: '/_next/static/chunks/799-941eb09f318946ee.js',
          revision: '941eb09f318946ee',
        },
        {
          url: '/_next/static/chunks/81-95d7b1e12d4ac0b4.js',
          revision: '95d7b1e12d4ac0b4',
        },
        {
          url: '/_next/static/chunks/85582243-64cd6d835f086ece.js',
          revision: '64cd6d835f086ece',
        },
        {
          url: '/_next/static/chunks/87c73c54-11a3c0c1d83d34a4.js',
          revision: '11a3c0c1d83d34a4',
        },
        {
          url: '/_next/static/chunks/92-5cfdd39e0bc1a272.js',
          revision: '5cfdd39e0bc1a272',
        },
        {
          url: '/_next/static/chunks/934-cb425b066ccb2433.js',
          revision: 'cb425b066ccb2433',
        },
        {
          url: '/_next/static/chunks/994.ab2699347bcd24c6.js',
          revision: 'ab2699347bcd24c6',
        },
        {
          url: '/_next/static/chunks/app/%5Blocale%5D/about/page-33c2a60a2c953260.js',
          revision: '33c2a60a2c953260',
        },
        {
          url: '/_next/static/chunks/app/%5Blocale%5D/articles/%5Bslug%5D/page-dc9208fc3ef7b25f.js',
          revision: 'dc9208fc3ef7b25f',
        },
        {
          url: '/_next/static/chunks/app/%5Blocale%5D/bookmarks/page-bd15b16c037a6a7f.js',
          revision: 'bd15b16c037a6a7f',
        },
        {
          url: '/_next/static/chunks/app/%5Blocale%5D/categories/%5Bslug%5D/page-60a0d28f90ba4afa.js',
          revision: '60a0d28f90ba4afa',
        },
        {
          url: '/_next/static/chunks/app/%5Blocale%5D/categories/page-d19d6c623aa99d6e.js',
          revision: 'd19d6c623aa99d6e',
        },
        {
          url: '/_next/static/chunks/app/%5Blocale%5D/layout-12a992734709d94e.js',
          revision: '12a992734709d94e',
        },
        {
          url: '/_next/static/chunks/app/%5Blocale%5D/login/page-7e140688cf173411.js',
          revision: '7e140688cf173411',
        },
        {
          url: '/_next/static/chunks/app/%5Blocale%5D/page-091bd5c494016121.js',
          revision: '091bd5c494016121',
        },
        {
          url: '/_next/static/chunks/app/%5Blocale%5D/search/page-00ca234461f63827.js',
          revision: '00ca234461f63827',
        },
        {
          url: '/_next/static/chunks/app/%5Blocale%5D/sitemap.xml/route-5dd9aa80973fbe53.js',
          revision: '5dd9aa80973fbe53',
        },
        {
          url: '/_next/static/chunks/app/%5Blocale%5D/tags/%5Bslug%5D/page-84ef648c252cc5fd.js',
          revision: '84ef648c252cc5fd',
        },
        {
          url: '/_next/static/chunks/app/%5Blocale%5D/tags/page-911679b48e7e281c.js',
          revision: '911679b48e7e281c',
        },
        {
          url: '/_next/static/chunks/app/_not-found/page-202907a5e24f03c2.js',
          revision: '202907a5e24f03c2',
        },
        {
          url: '/_next/static/chunks/app/layout-b0d3c8483495f935.js',
          revision: 'b0d3c8483495f935',
        },
        {
          url: '/_next/static/chunks/app/oauth/callback/page-2ae7cbd90e61f972.js',
          revision: '2ae7cbd90e61f972',
        },
        {
          url: '/_next/static/chunks/app/oauth/layout-1c835cc4d06bd582.js',
          revision: '1c835cc4d06bd582',
        },
        {
          url: '/_next/static/chunks/app/page-0730ad4f6e404819.js',
          revision: '0730ad4f6e404819',
        },
        {
          url: '/_next/static/chunks/app/robots.txt/route-f6869c07909e2812.js',
          revision: 'f6869c07909e2812',
        },
        {
          url: '/_next/static/chunks/app/sitemap.xml/route-5bd175eab45b0165.js',
          revision: '5bd175eab45b0165',
        },
        {
          url: '/_next/static/chunks/framework-3e07cb4cc3784b4d.js',
          revision: '3e07cb4cc3784b4d',
        },
        {
          url: '/_next/static/chunks/main-025f08a5d2d6dbc0.js',
          revision: '025f08a5d2d6dbc0',
        },
        {
          url: '/_next/static/chunks/main-app-61b09f9a662ca1ab.js',
          revision: '61b09f9a662ca1ab',
        },
        {
          url: '/_next/static/chunks/pages/_app-863297809e7dfcb5.js',
          revision: '863297809e7dfcb5',
        },
        {
          url: '/_next/static/chunks/pages/_error-5a18f3a529f1491c.js',
          revision: '5a18f3a529f1491c',
        },
        {
          url: '/_next/static/chunks/polyfills-42372ed130431b0a.js',
          revision: '846118c33b2c0e922d7b3a7676f81f6f',
        },
        {
          url: '/_next/static/chunks/webpack-30450f3d01eb34de.js',
          revision: '30450f3d01eb34de',
        },
        {
          url: '/_next/static/css/081a0afca5a9bd20.css',
          revision: '081a0afca5a9bd20',
        },
        {
          url: '/_next/static/css/92d61baea8eaf19d.css',
          revision: '92d61baea8eaf19d',
        },
        {
          url: '/_next/static/media/19cfc7226ec3afaa-s.woff2',
          revision: '9dda5cfc9a46f256d0e131bb535e46f8',
        },
        {
          url: '/_next/static/media/21350d82a1f187e9-s.woff2',
          revision: '4e2553027f1d60eff32898367dd4d541',
        },
        {
          url: '/_next/static/media/8e9860b6e62d6359-s.woff2',
          revision: '01ba6c2a184b8cba08b0d57167664d75',
        },
        {
          url: '/_next/static/media/ba9851c3c22cd980-s.woff2',
          revision: '9e494903d6b0ffec1a1e14d34427d44d',
        },
        {
          url: '/_next/static/media/c5fe6dc8356a8c31-s.woff2',
          revision: '027a89e9ab733a145db70f09b8a18b42',
        },
        {
          url: '/_next/static/media/df0a9ae256c0569c-s.woff2',
          revision: 'd54db44de5ccb18886ece2fda72bdfe0',
        },
        {
          url: '/_next/static/media/e4af272ccee01ff0-s.p.woff2',
          revision: '65850a373e258f1c897a2b3d75eb74de',
        },
        { url: '/favicon.ico', revision: 'bdd2c9b91b92217f25cdf808e6b58e33' },
        {
          url: '/icons/apple-touch-icon-120x120.png',
          revision: '41b50d865c972b927227a9e7b25f71e3',
        },
        {
          url: '/icons/apple-touch-icon-152x152.png',
          revision: '2bbf41675384ffb6fa3cbf45779d485b',
        },
        {
          url: '/icons/apple-touch-icon-167x167.png',
          revision: '397450ddd6d10c0427cbb3c6472e11ca',
        },
        {
          url: '/icons/apple-touch-icon.png',
          revision: '35de1832f7026bff44e778f85d29da17',
        },
        {
          url: '/icons/favicon-16x16.png',
          revision: '9122bbf79fa6ddbea479ca5d74df7038',
        },
        {
          url: '/icons/favicon-32x32.png',
          revision: '779b13c0335b2014e1a72d19004f1de8',
        },
        {
          url: '/icons/icon-144x144.png',
          revision: '8fabcb0f77e34ed3c1ea0354974fd211',
        },
        {
          url: '/icons/icon-192x192.png',
          revision: 'a8bf04399afc444a1a86036047142034',
        },
        {
          url: '/icons/icon-48x48.png',
          revision: 'b7ad74fd087b84ccdde57a6c8fcab408',
        },
        {
          url: '/icons/icon-512x512.png',
          revision: '2fa7ad672d7a6de8d7cd9b4fb87b886a',
        },
        {
          url: '/icons/icon-72x72.png',
          revision: '983ed4ac5ba44f97dd46a7b34953df78',
        },
        {
          url: '/icons/icon-96x96.png',
          revision: '15b119deb1175b52348035abec6da69c',
        },
        {
          url: '/images/article-placeholder.svg',
          revision: '4e2e0d474f4e09bfe6da74ac6bf4f12a',
        },
        { url: '/logo.png', revision: '7b60992ca2acc3a64055da2003bccde4' },
        {
          url: '/manifest-en.json',
          revision: '6bcf5021af71ddf655fe5223993e99e4',
        },
        {
          url: '/manifest-ja.json',
          revision: 'ba08cb3cc743a34d0e3b1b26a09dfa7c',
        },
        {
          url: '/manifest-ko.json',
          revision: '94ce698d720ecdddddf5df68ce74de8e',
        },
        {
          url: '/manifest-zh.json',
          revision: '9fcc7771af6618145a79926c45fbace5',
        },
        { url: '/manifest.json', revision: 'daab8e4204bb1387ff1b3869ca678459' },
        { url: '/offline.html', revision: 'b4bf09f335717c468d70125e11c96fc2' },
        {
          url: '/pwa-icons-config.json',
          revision: '050f26bfda0f6da413c712cf078ca27f',
        },
      ],
      { ignoreURLParametersMatching: [] },
    ),
    e.cleanupOutdatedCaches(),
    e.registerRoute(
      '/',
      new e.NetworkFirst({
        cacheName: 'start-url',
        plugins: [
          {
            cacheWillUpdate: async ({
              request: e,
              response: c,
              event: s,
              state: a,
            }) =>
              c && 'opaqueredirect' === c.type
                ? new Response(c.body, {
                    status: 200,
                    statusText: 'OK',
                    headers: c.headers,
                  })
                : c,
          },
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
      new e.CacheFirst({
        cacheName: 'google-fonts',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 31536e3 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\.(?:eot|otf|ttc|ttf|woff|woff2|font.css)$/i,
      new e.StaleWhileRevalidate({
        cacheName: 'static-font-assets',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 604800 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
      new e.CacheFirst({
        cacheName: 'static-image-assets',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 2592e3 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\.(?:js|css|mjs)$/i,
      new e.StaleWhileRevalidate({
        cacheName: 'static-js-css-assets',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /^https?:\/\/api\.joyminis\.com\/.*/i,
      new e.NetworkFirst({
        cacheName: 'api-cache',
        networkTimeoutSeconds: 10,
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 300 }),
          new e.CacheableResponsePlugin({ statuses: [0, 200] }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /^https?:\/\/.*\.(joyminis\.com|localhost).*$/i,
      new e.NetworkFirst({
        cacheName: 'pages-cache',
        networkTimeoutSeconds: 10,
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 }),
          new e.CacheableResponsePlugin({ statuses: [0, 200] }),
        ],
      }),
      'GET',
    ));
});
