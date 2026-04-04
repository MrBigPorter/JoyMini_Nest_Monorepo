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

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const options: JwtStrategyOptions = {
      /**
       * secretOrKeyProvider: 根据 token 的 type 字段动态选择密钥。
       * - type === 'admin' → ADMIN_JWT_SECRET（admin 独立密钥，不降级）
       * - 其他（client token）→ JWT_SECRET
       *
       * 安全说明：jsonwebtoken.decode() 不验证签名，仅用于读取 type 字段。
       * 即使攻击者伪造 type:'admin'，verify() 仍会用 ADMIN_JWT_SECRET 验签，
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
        const secret =
          payload?.type === 'admin'
            ? process.env.ADMIN_JWT_SECRET || 'please_change_me_very_secret'
            : process.env.JWT_SECRET || 'please_change_me_very_secret';
        done(null, secret);
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
