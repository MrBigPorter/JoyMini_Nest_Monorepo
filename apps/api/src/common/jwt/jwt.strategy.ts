import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as jsonwebtoken from 'jsonwebtoken';

interface JwtPayload {
  sub: string;
  role?: string;
  type?: string;
}

// passport-jwt 运行时支持 secretOrKeyProvider，但 @nestjs/passport 泛型未完整暴露

type JwtStrategyOptions = any;

const FALLBACK_SECRET = 'please_change_me_very_secret';

/**
 * 解析验签密钥。必须与签发侧保持一致，否则会出现
 * “登录成功、所有接口 401、前端被反复踢回登录页”。
 *
 * 签发侧（admin/auth/auth.service.ts getAdminJwtSecret 与 auth.module.ts）
 * 的顺序是 ADMIN_JWT_SECRET → JWT_SECRET → 默认值；这里如果漏掉 JWT_SECRET，
 * 只配置了 JWT_SECRET 的环境（本地 .env、部分单机部署）里 admin token
 * 会用另一个密钥验签，必然 401。
 *
 * 只有在 ADMIN_JWT_SECRET 已配置时才真正隔离：admin token 永远优先用
 * admin 密钥验签，不会退回客户端密钥。
 */
export function resolveJwtSecret(
  payload: { type?: string } | null | undefined,
): string {
  if (payload?.type === 'admin') {
    return process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || FALLBACK_SECRET;
  }
  return process.env.JWT_SECRET || FALLBACK_SECRET;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const options: JwtStrategyOptions = {
      /**
       * secretOrKeyProvider: 根据 token 的 type 字段动态选择密钥。
       * - type === 'admin' → ADMIN_JWT_SECRET（未配置时回退 JWT_SECRET，与签发侧一致）
       * - 其他（client token）→ JWT_SECRET
       *
       * 安全说明：jsonwebtoken.decode() 不验证签名，仅用于读取 type 字段。
       * 即使攻击者伪造 type:'admin'，verify() 仍会用 admin 密钥验签，
       * 因其无法伪造合法签名，依然会失败。
       */
      secretOrKeyProvider: (
        _request: unknown,
        rawJwtToken: string,
        done: (err: null, key: string) => void,
      ) => {
        const payload = jsonwebtoken.decode(rawJwtToken) as {
          type?: string;
        } | null;
        done(null, resolveJwtSecret(payload));
      },
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
    };
    super(options);
  }

  validate(payload: JwtPayload) {
    // 只把 userId 传给 request.user
    return {
      id: payload.sub,
      userId: payload.sub,
      role: payload.role ?? '',
      type: payload.type ?? '',
    };
  }
}
