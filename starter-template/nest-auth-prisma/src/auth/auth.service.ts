import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma/prisma.service';
import { AdminLoginDto } from './dto/admin-login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private getSecret() {
    return process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || 'change_me';
  }

  async adminLogin(dto: AdminLoginDto, ip: string, ua: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { username: dto.username } });

    if (!admin || admin.status !== 1) {
      throw new UnauthorizedException('invalid username or password');
    }

    const ok = await bcrypt.compare(dto.password, admin.password);
    if (!ok) {
      throw new UnauthorizedException('invalid username or password');
    }

    const payload = { sub: admin.id, role: admin.role, type: 'admin' as const };
    const secret = this.getSecret();

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret,
        expiresIn: process.env.ADMIN_JWT_ACCESS_EXPIRATION || '12h',
      }),
      this.jwt.signAsync(payload, {
        secret,
        expiresIn: process.env.ADMIN_JWT_REFRESH_EXPIRATION || '7d',
      }),
    ]);

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ip },
    });

    await this.prisma.adminOperationLog.create({
      data: {
        adminId: admin.id,
        module: 'auth',
        action: 'login',
        requestIp: ip,
        details: JSON.stringify({ ua }),
      },
    });

    return { tokens: { accessToken, refreshToken } };
  }

  async verifyAdminToken(token: string) {
    try {
      await this.jwt.verifyAsync(token, { secret: this.getSecret() });
      return true;
    } catch {
      throw new UnauthorizedException('Token is invalid or expired');
    }
  }
}

