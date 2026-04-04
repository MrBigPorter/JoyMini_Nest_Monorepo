import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

interface JwtPayload {
  sub: string;
  role?: string;
  type?: 'admin' | 'user';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      secretOrKey: process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET,
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
    });
  }

  validate(payload: JwtPayload) {
    return {
      id: payload.sub,
      userId: payload.sub,
      role: payload.role ?? '',
      type: payload.type ?? '',
    };
  }
}

