import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { RealIp, UserAgent } from '@api/common/decorators/http.decorators';
import { AdminLoginDto } from './dto/admin-login.dto';
import { SetCookieDto } from './dto/set-cookie.dto';
import { AdminRefreshTokenDto } from './dto/admin-refresh-token.dto';
import { AdminTokenResponseDto } from './dto/admin-token-response.dto';

@ApiTags('admin Auth Management')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private buildAdminCookieBaseOptions() {
    const isProd = process.env.NODE_ENV === 'production';
    const configuredDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();
    const sameSite: 'strict' | 'lax' = isProd ? 'strict' : 'lax';

    // In production we need a shared parent-domain cookie so admin.joyminis.com
    // middleware can read the token set by api.joyminis.com responses.
    const cookieDomain =
      isProd && configuredDomain
        ? configuredDomain
        : isProd
          ? '.joyminis.com'
          : undefined;

    return {
      httpOnly: true,
      secure: isProd,
      sameSite,
      path: '/',
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    };
  }

  private buildAdminSetCookieOptions() {
    return {
      ...this.buildAdminCookieBaseOptions(),
      maxAge: 24 * 60 * 60 * 1000,
    };
  }

  /**
   * 获取当前登录的管理员信息
   * 用于前端 page refresh 后从 JWT token 恢复 userInfo（角色、权限等）
   */
  @Get('admin/me')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async getAdminMe(@CurrentUserId() userId: string) {
    return this.auth.getAdminMe(userId);
  }

  /**
   * Admin login
   * @param dto
   * @param ip
   * @param ua
   */
  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  async loginAdmin(
    @Body() dto: AdminLoginDto,
    @RealIp() ip: string,
    @UserAgent() ua: string,
  ) {
    return this.auth.adminLogin(dto, ip, ua);
  }

  @Post('admin/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOkResponse({ type: AdminTokenResponseDto })
  async refreshAdminToken(@Body() dto: AdminRefreshTokenDto) {
    return this.auth.refreshAdminToken(dto.refreshToken);
  }

  /**
   * Admin logout
   */
  @Post('admin/logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async logoutAdmin(
    @CurrentUserId() userId: string,
    @RealIp() ip: string,
    @UserAgent() ua: string,
  ) {
    return this.auth.adminLogout(userId, ip, ua);
  }

  /**
   * 设置 HTTP-only auth_token Cookie
   * 前端登录成功后调用此接口，由后端设置 HttpOnly Cookie（JS 无法读取，防 XSS）
   */
  @Post('admin/set-cookie')
  @HttpCode(HttpStatus.OK)
  async setAuthCookie(
    @Body() dto: SetCookieDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.verifyAdminToken(dto.token);

    res.cookie('auth_token', dto.token, this.buildAdminSetCookieOptions());

    return { ok: true };
  }

  /**
   * 清除 HTTP-only auth_token Cookie（登出时调用）
   */
  @Post('admin/clear-cookie')
  @HttpCode(HttpStatus.OK)
  clearAuthCookie(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('auth_token', this.buildAdminCookieBaseOptions());
    return { ok: true };
  }
}
