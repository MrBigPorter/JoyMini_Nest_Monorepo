import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { AdminLoginDto } from './dto/admin-login.dto';

class SetCookieDto {
  token!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private buildCookieOptions() {
    const isProd = process.env.NODE_ENV === 'production';
    const configuredDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();

    return {
      httpOnly: true,
      secure: isProd,
      sameSite: (isProd ? 'strict' : 'lax') as 'strict' | 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
      ...(configuredDomain ? { domain: configuredDomain } : {}),
    };
  }

  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: AdminLoginDto) {
    return this.authService.adminLogin(dto, '0.0.0.0', 'unknown');
  }

  @Post('admin/set-cookie')
  @HttpCode(HttpStatus.OK)
  async setAuthCookie(@Body() dto: SetCookieDto, @Res({ passthrough: true }) res: Response) {
    await this.authService.verifyAdminToken(dto.token);
    res.cookie('auth_token', dto.token, this.buildCookieOptions());
    return { ok: true };
  }

  @Post('admin/clear-cookie')
  @HttpCode(HttpStatus.OK)
  clearAuthCookie(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('auth_token', this.buildCookieOptions());
    return { ok: true };
  }
}

