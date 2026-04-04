import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

// 扩展 Request 类型以包含 session
interface RequestWithSession extends Request {
  session?: {
    [key: string]: any;
  };
}

/**
 * CSRF 保护中间件
 * 验证请求中的 CSRF Token 是否有效
 *
 * 设计原则：
 * 1. 只对基于 session/cookie 认证的请求进行 CSRF 验证
 * 2. 跳过所有基于 JWT token 认证的请求（Admin API 和 Client API）
 * 3. 跳过支付回调、webhook 等第三方调用
 * 4. 基于 Authorization header 智能判断认证方式
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: RequestWithSession, res: Response, next: NextFunction) {
    // 只对 POST, PUT, PATCH, DELETE 请求进行 CSRF 验证
    const method = req.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next();
    }

    // 跳过健康检查
    if (req.path === '/api/health') {
      return next();
    }

    // 智能判断：如果请求带有 JWT Bearer token，则跳过 CSRF 验证
    // 因为 JWT 认证本身就有防 CSRF 保护（token 不会自动携带）
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return next();
    }

    // 跳过支付回调和 webhook（第三方调用，通常使用签名验证）
    if (
      req.path.startsWith('/api/v1/payment/') ||
      req.path.startsWith('/api/v1/webhook/')
    ) {
      return next();
    }

    // 跳过登录、刷新token等认证相关接口
    if (req.path.startsWith('/api/v1/auth/')) {
      return next();
    }

    // 跳过客户端 API（Flutter 客户端使用 JWT 认证，不需要 CSRF）
    if (req.path.startsWith('/api/v1/client/')) {
      return next();
    }

    // 从请求头或请求体中获取 CSRF Token
    const csrfToken =
      (req.headers['x-csrf-token'] as string) ||
      (req.headers['x-xsrf-token'] as string) ||
      req.body?._csrf;

    if (!csrfToken) {
      throw new ForbiddenException('CSRF token missing');
    }

    // 验证 CSRF Token 格式（64位十六进制字符）
    if (!/^[a-f0-9]{64}$/i.test(csrfToken)) {
      throw new ForbiddenException('Invalid CSRF token format');
    }

    // 从 cookie 或 session 中获取存储的 CSRF Token
    const storedToken =
      req.cookies?.['csrf_token'] || req.session?.['csrf_token'];

    if (!storedToken) {
      throw new ForbiddenException('No CSRF token found in session');
    }

    // 验证 Token 是否匹配
    if (csrfToken !== storedToken) {
      throw new ForbiddenException('CSRF token mismatch');
    }

    // 验证通过，继续处理请求
    next();
  }
}

/**
 * CSRF Token 生成中间件
 * 为每个会话生成 CSRF Token
 */
@Injectable()
export class CsrfTokenMiddleware implements NestMiddleware {
  use(req: RequestWithSession, res: Response, next: NextFunction) {
    // 只对 GET 请求生成 CSRF Token
    if (req.method.toUpperCase() !== 'GET') {
      return next();
    }

    // 检查是否已有 CSRF Token
    let csrfToken = req.cookies?.['csrf_token'] || req.session?.['csrf_token'];

    if (!csrfToken) {
      // 生成新的 CSRF Token
      csrfToken = this.generateCsrfToken();

      // 设置到 cookie 中
      res.cookie('csrf_token', csrfToken, {
        httpOnly: false, // 前端需要读取
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24小时
      });

      // 也存储到 session 中
      if (req.session) {
        req.session['csrf_token'] = csrfToken;
      }
    }

    // 将 Token 添加到响应头中，方便前端获取
    res.setHeader('X-CSRF-Token', csrfToken);

    next();
  }

  private generateCsrfToken(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  }
}
