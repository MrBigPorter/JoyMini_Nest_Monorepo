// Cloudflare Workers TypeScript definitions
// Note: In production, install @cloudflare/workers-types
// For now, using simplified type definitions

export interface Env {
  // KV namespaces for caching
  CACHE: any; // KVNamespace in production
  ISR_CACHE: any; // KVNamespace in production

  // D1 database for edge data
  DB: any; // D1Database in production

  // R2 bucket for static assets
  R2_STORAGE: any; // R2Bucket in production

  // Analytics engine
  ANALYTICS: any; // AnalyticsEngineDataset in production

  // Environment variables
  NODE_ENV: string;
  NEXT_PUBLIC_ENVIRONMENT: string;
  ENABLE_ISR: string;
  ENABLE_STREAMING: string;
  ENABLE_EDGE_MIDDLEWARE: string;
  NEXT_PUBLIC_API_URL: string;
  NEXT_PUBLIC_CDN_URL: string;
  SENTRY_DSN?: string;
}

// Simplified type definitions for development
interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
}

interface KVNamespace {
  get(key: string, options?: { type: string }): Promise<any>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

interface R2Bucket {
  get(key: string): Promise<any>;
}

interface AnalyticsEngineDataset {
  writeDataPoint(data: any): Promise<void>;
}

// Cache configuration
const CACHE_CONFIG = {
  // Static assets (CSS, JS, fonts)
  STATIC: {
    ttl: 31536000, // 1 year
    swr: 86400, // 1 day stale-while-revalidate
  },
  // Images
  IMAGES: {
    ttl: 604800, // 1 week
    swr: 3600, // 1 hour stale-while-revalidate
  },
  // API responses
  API: {
    ttl: 60, // 1 minute
    swr: 30, // 30 seconds stale-while-revalidate
  },
  // Content pages
  CONTENT: {
    ttl: 300, // 5 minutes
    swr: 60, // 1 minute stale-while-revalidate
  },
  // ISR pages
  ISR: {
    ttl: 60, // 1 minute
    swr: 30, // 30 seconds stale-while-revalidate
  },
};

// ISR revalidation configuration
const ISR_CONFIG = {
  // Article pages
  ARTICLE: {
    revalidate: 60, // Revalidate every 60 seconds
    staleWhileRevalidate: true,
  },
  // Category/Tag pages
  CATEGORY: {
    revalidate: 300, // Revalidate every 5 minutes
    staleWhileRevalidate: true,
  },
  // Home page
  HOME: {
    revalidate: 60, // Revalidate every 60 seconds
    staleWhileRevalidate: true,
  },
};

// Performance monitoring
interface PerformanceMetrics {
  requestId: string;
  url: string;
  method: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  cacheStatus: 'hit' | 'miss' | 'stale' | 'bypass';
  isrStatus: 'fresh' | 'stale' | 'revalidating' | 'miss';
  userAgent?: string;
  country?: string;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    // 生产环境禁用所有 console.* 日志
    if (env.NODE_ENV === 'production') {
      console.log = () => {};
      console.info = () => {};
      console.debug = () => {};
      console.trace = () => {};
      console.warn = () => {};
      console.error = () => {};
    }

    const startTime = Date.now();
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();

    // Collect performance metrics
    const metrics: PerformanceMetrics = {
      requestId,
      url: url.toString(),
      method: request.method,
      startTime,
      cacheStatus: 'miss',
      isrStatus: 'miss',
    };

    // ── 103 Early Hints ──────────────────────────────────────────────
    // Warm critical connections (CDN + API) before HTML body arrives.
    // Requires Cloudflare Early Hints enabled in Dashboard:
    //   Speed → Optimization → Early Hints → On
    // ─────────────────────────────────────────────────────────────────
    if (
      request.method === 'GET' &&
      !this.isStaticAsset(url) &&
      url.pathname !== '/'
    ) {
      const cdnOrigin = env.NEXT_PUBLIC_CDN_URL
        ? new URL(env.NEXT_PUBLIC_CDN_URL).origin
        : 'https://img.joyminis.com';
      const apiOrigin = env.NEXT_PUBLIC_API_URL
        ? new URL(env.NEXT_PUBLIC_API_URL).origin
        : 'https://api.joyminis.com';

      ctx.waitUntil(
        Promise.resolve(
          new Response(null, {
            status: 103,
            headers: {
              Link: [
                `<${cdnOrigin}>; rel=preconnect`,
                `<${apiOrigin}>; rel=preconnect`,
              ].join(', '),
            },
          }),
        ),
      );
    }

    try {
      // Add security headers
      const securityHeaders = {
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://api.joyminis.com;",
      };

      // Handle preflight requests
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            ...securityHeaders,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
          },
        });
      }

      // Check cache first for GET requests
      if (request.method === 'GET') {
        const cacheKey = this.generateCacheKey(request);
        const cachedResponse = await this.getFromCache(cacheKey, env.CACHE);

        if (cachedResponse) {
          metrics.cacheStatus = 'hit';

          // Check if cache is stale and needs revalidation
          if (this.isCacheStale(cachedResponse)) {
            metrics.cacheStatus = 'stale';

            // Revalidate in background for ISR pages
            if (this.isISRPage(url)) {
              ctx.waitUntil(this.revalidateISRPage(request, env, cacheKey));
              metrics.isrStatus = 'revalidating';
            }
          }

          // Return cached response with updated headers
          return this.buildResponseFromCache(
            cachedResponse,
            securityHeaders,
            metrics,
          );
        }
      }

      // Serve Apple App Site Association file for Universal Links
      if (url.pathname === '/.well-known/apple-app-site-association') {
        const aasaResponse = await this.serveAASA(env);
        if (aasaResponse) {
          return this.addHeaders(aasaResponse, securityHeaders);
        }
      }

      // Handle static assets from R2
      if (this.isStaticAsset(url)) {
        const assetResponse = await this.serveStaticAsset(url, env.R2_STORAGE);
        if (assetResponse) {
          // Cache static asset
          const cacheKey = this.generateCacheKey(request);
          ctx.waitUntil(
            this.cacheResponse(
              cacheKey,
              assetResponse,
              env.CACHE,
              CACHE_CONFIG.STATIC,
            ),
          );

          metrics.cacheStatus = 'miss'; // First time serving
          return this.addHeaders(assetResponse, securityHeaders);
        }
      }

      // Handle ISR pages
      if (this.isISRPage(url) && env.ENABLE_ISR === 'true') {
        const isrResponse = await this.handleISRPage(request, env, ctx);
        if (isrResponse) {
          metrics.isrStatus = 'fresh';
          return this.addHeaders(isrResponse, securityHeaders);
        }
      }

      // Forward to origin (Next.js application)
      const originResponse = await this.fetchFromOrigin(request, env);

      // Cache the response if cacheable
      if (this.isCacheable(request, originResponse)) {
        const cacheKey = this.generateCacheKey(request);
        const cacheConfig = this.getCacheConfig(url, originResponse);

        ctx.waitUntil(
          this.cacheResponse(cacheKey, originResponse, env.CACHE, cacheConfig),
        );

        // Set ISR cache for ISR pages
        if (this.isISRPage(url) && env.ENABLE_ISR === 'true') {
          ctx.waitUntil(
            this.setISRCache(cacheKey, originResponse, env.ISR_CACHE),
          );
        }
      }

      // Add performance headers
      const finalResponse = this.addPerformanceHeaders(
        originResponse,
        metrics,
        startTime,
      );

      // Log analytics
      ctx.waitUntil(this.logAnalytics(metrics, env.ANALYTICS, request));

      return this.addHeaders(finalResponse, securityHeaders);
    } catch (error) {
      console.error('Error in worker:', error);

      // Log error to analytics
      metrics.endTime = Date.now();
      metrics.duration = metrics.endTime - metrics.startTime;

      ctx.waitUntil(this.logError(error, metrics, env.ANALYTICS, request));

      // Return error response
      return new Response('Internal Server Error', {
        status: 500,
        headers: {
          'Content-Type': 'text/plain',
          'X-Request-ID': requestId,
          'X-Cache-Status': 'error',
        },
      });
    }
  },

  // Generate cache key from request
  generateCacheKey(request: Request): string {
    const url = new URL(request.url);

    // Remove query parameters that don't affect content
    const cleanUrl = new URL(url.pathname, url.origin);

    // Add important query parameters
    const importantParams = ['locale', 'page', 'sort'];
    importantParams.forEach((param) => {
      if (url.searchParams.has(param)) {
        cleanUrl.searchParams.set(param, url.searchParams.get(param)!);
      }
    });

    // Include user agent for device-specific caching
    const userAgent = request.headers.get('user-agent') || '';
    const isMobile =
      userAgent.includes('Mobile') || userAgent.includes('Android');

    return `${cleanUrl.toString()}:${isMobile ? 'mobile' : 'desktop'}`;
  },

  // Get response from cache
  async getFromCache(
    cacheKey: string,
    cache: KVNamespace,
  ): Promise<Response | null> {
    try {
      const cached = await cache.get(cacheKey, { type: 'arrayBuffer' });
      if (!cached) return null;

      // Parse cached data
      const cachedData = JSON.parse(new TextDecoder().decode(cached));

      // Reconstruct response
      return new Response(cachedData.body, {
        status: cachedData.status,
        statusText: cachedData.statusText,
        headers: new Headers(cachedData.headers),
      });
    } catch (error) {
      console.warn('Cache read error:', error);
      return null;
    }
  },

  // Check if cache is stale
  isCacheStale(response: Response): boolean {
    const cacheControl = response.headers.get('cache-control');
    if (!cacheControl) return false;

    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    if (!maxAgeMatch) return false;

    const maxAge = parseInt(maxAgeMatch[1], 10);
    const age = parseInt(response.headers.get('age') || '0', 10);

    return age >= maxAge;
  },

  // Check if URL is a static asset
  isStaticAsset(url: URL): boolean {
    const staticExtensions = [
      '.css',
      '.js',
      '.woff',
      '.woff2',
      '.ttf',
      '.eot',
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.webp',
      '.svg',
      '.ico',
    ];
    return staticExtensions.some((ext) => url.pathname.endsWith(ext));
  },

  // Serve static asset from R2
  async serveStaticAsset(url: URL, assets: R2Bucket): Promise<Response | null> {
    try {
      const objectKey = url.pathname.slice(1); // Remove leading slash
      const object = await assets.get(objectKey);

      if (!object) return null;

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);

      // Set cache headers based on file type
      if (url.pathname.match(/\.(css|js|woff2?|ttf|eot)$/)) {
        headers.set(
          'cache-control',
          `public, max-age=${CACHE_CONFIG.STATIC.ttl}, stale-while-revalidate=${CACHE_CONFIG.STATIC.swr}`,
        );
      } else if (url.pathname.match(/\.(jpg|jpeg|png|gif|webp|svg|ico)$/)) {
        headers.set(
          'cache-control',
          `public, max-age=${CACHE_CONFIG.IMAGES.ttl}, stale-while-revalidate=${CACHE_CONFIG.IMAGES.swr}`,
        );
      }

      return new Response(object.body, {
        headers,
        status: 200,
      });
    } catch (error) {
      console.warn('R2 asset error:', error);
      return null;
    }
  },

  // Serve the Apple App Site Association file for Universal Links
  async serveAASA(env: Env): Promise<Response | null> {
    try {
      const object = await env.R2_STORAGE.get(
        '.well-known/apple-app-site-association',
      );
      if (!object) return null;

      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      headers.set('Cache-Control', 'public, max-age=3600');

      return new Response(object.body, {
        headers,
        status: 200,
      });
    } catch (error) {
      console.warn('AASA serve error:', error);
      return null;
    }
  },

  // Check if URL is an ISR page
  isISRPage(url: URL): boolean {
    const isrPaths = [
      /^\/articles\/[^/]+$/, // Article detail pages
      /^\/(categories|tags)\/[^/]+$/, // Category/Tag pages
      /^\/$/, // Home page
    ];

    return isrPaths.some((pattern) => pattern.test(url.pathname));
  },

  // Handle ISR page
  async handleISRPage(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response | null> {
    const cacheKey = this.generateCacheKey(request);

    // Check ISR cache first
    const isrCached = await env.ISR_CACHE.get(cacheKey);
    if (isrCached) {
      const cachedData = JSON.parse(isrCached);

      // Check if ISR cache is stale
      const cacheTime = cachedData.timestamp;
      const currentTime = Date.now();
      const isrConfig = this.getISRConfig(new URL(request.url));

      if (currentTime - cacheTime < isrConfig.revalidate * 1000) {
        // Cache is fresh, serve from KV cache
        const kvResponse = await this.getFromCache(cacheKey, env.CACHE);
        if (kvResponse) {
          // Update age header
          const age = Math.floor((currentTime - cacheTime) / 1000);
          kvResponse.headers.set('age', age.toString());
          kvResponse.headers.set('x-isr-cache', 'hit');

          return kvResponse;
        }
      } else {
        // Cache is stale, revalidate in background
        ctx.waitUntil(this.revalidateISRPage(request, env, cacheKey));

        // Serve stale content while revalidating
        const kvResponse = await this.getFromCache(cacheKey, env.CACHE);
        if (kvResponse) {
          kvResponse.headers.set('x-isr-cache', 'stale');
          kvResponse.headers.set('x-isr-revalidating', 'true');
          return kvResponse;
        }
      }
    }

    return null;
  },

  // Revalidate ISR page in background
  async revalidateISRPage(
    request: Request,
    env: Env,
    cacheKey: string,
  ): Promise<void> {
    try {
      // Fetch fresh content from origin
      const freshResponse = await this.fetchFromOrigin(request, env);

      if (freshResponse.ok) {
        // Update KV cache
        const cacheConfig = this.getCacheConfig(
          new URL(request.url),
          freshResponse,
        );
        await this.cacheResponse(
          cacheKey,
          freshResponse,
          env.CACHE,
          cacheConfig,
        );

        // Update ISR cache timestamp
        await env.ISR_CACHE.put(
          cacheKey,
          JSON.stringify({
            timestamp: Date.now(),
            url: request.url,
          }),
        );

        console.log(`ISR revalidated: ${request.url}`);
      }
    } catch (error) {
      console.error('ISR revalidation error:', error);
    }
  },

  // Set ISR cache
  async setISRCache(
    cacheKey: string,
    response: Response,
    isrCache: KVNamespace,
  ): Promise<void> {
    await isrCache.put(
      cacheKey,
      JSON.stringify({
        timestamp: Date.now(),
        url: response.url,
      }),
    );
  },

  // Get ISR configuration for URL
  getISRConfig(url: URL): {
    revalidate: number;
    staleWhileRevalidate: boolean;
  } {
    if (url.pathname.match(/^\/articles\/[^/]+$/)) {
      return ISR_CONFIG.ARTICLE;
    } else if (url.pathname.match(/^\/(categories|tags)\/[^/]+$/)) {
      return ISR_CONFIG.CATEGORY;
    } else if (url.pathname === '/') {
      return ISR_CONFIG.HOME;
    }

    // Default configuration
    return { revalidate: 60, staleWhileRevalidate: true };
  },

  // Fetch from origin (Next.js application)
  async fetchFromOrigin(request: Request, env: Env): Promise<Response> {
    // Modify request for origin
    const originRequest = new Request(request);

    // Add origin headers
    originRequest.headers.set('x-forwarded-host', new URL(request.url).host);
    originRequest.headers.set(
      'x-forwarded-proto',
      new URL(request.url).protocol.replace(':', ''),
    );
    originRequest.headers.set(
      'x-real-ip',
      request.headers.get('cf-connecting-ip') || '',
    );

    // Forward to origin
    // Note: In production, this would point to your Next.js application
    // For now, we'll use a placeholder
    const originUrl = env.NEXT_PUBLIC_API_URL || 'http://localhost:4002';
    const originResponse = await fetch(
      originUrl + new URL(request.url).pathname + new URL(request.url).search,
      {
        method: request.method,
        headers: originRequest.headers,
        body: request.body,
      },
    );

    return originResponse;
  },

  // Check if response is cacheable
  isCacheable(request: Request, response: Response): boolean {
    // Only cache GET requests
    if (request.method !== 'GET') return false;

    // Don't cache non-OK responses
    if (!response.ok) return false;

    // Check cache-control headers
    const cacheControl = response.headers.get('cache-control');
    if (cacheControl && cacheControl.includes('no-store')) return false;
    if (cacheControl && cacheControl.includes('private')) return false;

    // Check for Set-Cookie headers (don't cache authenticated responses)
    if (response.headers.has('set-cookie')) return false;

    return true;
  },

  // Get cache configuration for URL and response
  getCacheConfig(url: URL, response: Response): { ttl: number; swr: number } {
    // Check response cache-control first
    const cacheControl = response.headers.get('cache-control');
    if (cacheControl) {
      const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
      if (maxAgeMatch) {
        const maxAge = parseInt(maxAgeMatch[1], 10);
        const swrMatch = cacheControl.match(/stale-while-revalidate=(\d+)/);
        const swr = swrMatch
          ? parseInt(swrMatch[1], 10)
          : Math.floor(maxAge / 2);

        return { ttl: maxAge, swr };
      }
    }

    // Default based on URL pattern
    if (url.pathname.match(/\.(css|js|woff2?|ttf|eot)$/)) {
      return CACHE_CONFIG.STATIC;
    } else if (url.pathname.match(/\.(jpg|jpeg|png|gif|webp|svg|ico)$/)) {
      return CACHE_CONFIG.IMAGES;
    } else if (url.pathname.match(/^\/api\//)) {
      return CACHE_CONFIG.API;
    } else if (this.isISRPage(url)) {
      return CACHE_CONFIG.ISR;
    } else if (url.pathname.match(/^\/(articles|categories|tags)\//)) {
      return CACHE_CONFIG.CONTENT;
    }

    // Default cache configuration
    return { ttl: 60, swr: 30 };
  },

  // Cache response
  async cacheResponse(
    cacheKey: string,
    response: Response,
    cache: KVNamespace,
    config: { ttl: number; swr: number },
  ): Promise<void> {
    try {
      // Clone response to read body
      const responseClone = response.clone();
      const body = await responseClone.arrayBuffer();

      // Prepare cache data
      const cacheData = {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: Array.from(new Uint8Array(body)),
        timestamp: Date.now(),
        ttl: config.ttl,
        swr: config.swr,
      };

      // Store in cache with TTL
      await cache.put(cacheKey, JSON.stringify(cacheData), {
        expirationTtl: config.ttl + config.swr,
      });
    } catch (error) {
      console.warn('Cache write error:', error);
    }
  },

  // Build response from cache
  buildResponseFromCache(
    cachedResponse: Response,
    securityHeaders: Record<string, string>,
    metrics: PerformanceMetrics,
  ): Response {
    // Clone the cached response
    const response = new Response(cachedResponse.body, cachedResponse);

    // Add security headers
    Object.entries(securityHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    // Add cache headers
    response.headers.set('x-cache-status', metrics.cacheStatus);
    response.headers.set('x-isr-status', metrics.isrStatus);
    response.headers.set('x-request-id', metrics.requestId);

    // Update age header
    const cacheControl = response.headers.get('cache-control') || '';
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    if (maxAgeMatch) {
      const maxAge = parseInt(maxAgeMatch[1], 10);
      const currentAge = parseInt(response.headers.get('age') || '0', 10);
      const newAge = Math.min(currentAge + 1, maxAge); // Increment age by 1 second
      response.headers.set('age', newAge.toString());
    }

    return response;
  },

  // Add headers to response
  addHeaders(response: Response, headers: Record<string, string>): Response {
    const newResponse = new Response(response.body, response);

    Object.entries(headers).forEach(([key, value]) => {
      newResponse.headers.set(key, value);
    });

    return newResponse;
  },

  // Add performance headers
  addPerformanceHeaders(
    response: Response,
    metrics: PerformanceMetrics,
    startTime: number,
  ): Response {
    const newResponse = new Response(response.body, response);

    metrics.endTime = Date.now();
    metrics.duration = metrics.endTime - startTime;

    // Add performance headers
    newResponse.headers.set('x-request-id', metrics.requestId);
    newResponse.headers.set('x-cache-status', metrics.cacheStatus);
    newResponse.headers.set('x-isr-status', metrics.isrStatus);
    newResponse.headers.set('x-response-time', `${metrics.duration}ms`);

    // Add server timing header
    const serverTiming = `total;dur=${metrics.duration}, cache;desc="${metrics.cacheStatus}"`;
    newResponse.headers.set('server-timing', serverTiming);

    return newResponse;
  },

  // Log analytics
  async logAnalytics(
    metrics: PerformanceMetrics,
    analytics: AnalyticsEngineDataset,
    request: Request,
  ): Promise<void> {
    try {
      metrics.endTime = Date.now();
      metrics.duration = metrics.endTime - metrics.startTime;
      metrics.userAgent = request.headers.get('user-agent') || undefined;
      metrics.country = request.headers.get('cf-ipcountry') || undefined;

      // Write to analytics engine
      await analytics.writeDataPoint({
        indexes: [metrics.url],
        blobs: [
          metrics.requestId,
          metrics.method,
          metrics.cacheStatus,
          metrics.isrStatus,
          metrics.userAgent,
          metrics.country,
        ],
        doubles: [metrics.duration, metrics.startTime],
      });
    } catch (error) {
      console.warn('Analytics write error:', error);
    }
  },

  // Log error
  async logError(
    error: any,
    metrics: PerformanceMetrics,
    analytics: AnalyticsEngineDataset,
    request: Request,
  ): Promise<void> {
    try {
      await analytics.writeDataPoint({
        indexes: ['error'],
        blobs: [
          metrics.requestId,
          metrics.url,
          error.message || String(error),
          request.headers.get('user-agent') || '',
          request.headers.get('cf-ipcountry') || '',
        ],
        doubles: [metrics.duration || 0, Date.now()],
      });
    } catch (analyticsError) {
      console.warn('Error logging error:', analyticsError);
    }
  },
};
