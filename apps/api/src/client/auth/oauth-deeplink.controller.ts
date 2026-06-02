import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import {
  OAuthError,
  OAuthStateError,
  OAuthProviderError,
  OAuthUserCancelledError,
  getUserFriendlyErrorMessage,
} from '@api/common/oauth/oauth-errors';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

interface OAuthStateData {
  // 必需字段
  provider: string; // 'google' | 'facebook' | 'apple'
  timestamp: number; // 创建时间戳（毫秒）
  nonce: string; // 随机数，防止重放攻击

  // 可选字段
  callback?: string; // Deep Link回调URL
  inviteCode?: string; // 邀请码
  redirectUri?: string; // Web端重定向URI
  webState?: string; // Web端生成的state（防CSRF）
}

@ApiTags('oauth-deeplink')
@Controller('auth')
export class OAuthDeepLinkController {
  private readonly logger = new Logger(OAuthDeepLinkController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Dynamically determine the OAuth provider redirect_uri based on
   * the app-level redirectUri parameter passed by the frontend.
   *
   * If the frontend is on the blog domain (tarsierlabs.app), use the blog
   * domain's callback URL so cookies are scoped to the blog domain.
   * Otherwise, fall back to the env config (api.joyminis.com for Flutter app etc.).
   *
   * This allows the blog domain to receive OAuth callbacks directly (via nginx proxy),
   * so the HttpOnly `token` cookie is scoped to the blog domain and readable by Next.js middleware.
   * The Flutter app (which calls api.joyminis.com directly) is unaffected.
   * tarsier.joyminis.com is the old AWS deployment and is not handled here.
   */
  private resolveOAuthRedirectUri(
    provider: string,
    appRedirectUri: string | undefined,
  ): string {
    // Blog domain (VPS deployment): tarsierlabs.app
    if (appRedirectUri?.includes('tarsierlabs.app')) {
      return `https://tarsierlabs.app/auth/${provider}/callback`;
    }
    // Fallback to env config (e.g., GOOGLE_REDIRECT_URI for Flutter app)
    const envKey = `${provider.toUpperCase()}_REDIRECT_URI`;
    return this.configService.get<string>(envKey) || '';
  }

  // ==========================================
  // 第一步：发起授权（直接302）
  // ==========================================

  @Get('google/login')
  @ApiOperation({ summary: 'Google OAuth登录 - 发起授权' })
  googleLogin(
    @Res() res: Response,
    @Query('callback') callback: string,
    @Query('inviteCode') inviteCode?: string,
    @Query('redirect_uri') redirectUri?: string,
    @Query('state') webState?: string,
  ) {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');

    const stateData: OAuthStateData = {
      provider: 'google',
      timestamp: Date.now(),
      nonce: this.generateNonce(),
      callback,
      inviteCode,
      redirectUri,
      webState,
    };

    const state = this.encodeState(stateData);
    const oauthRedirectUri = this.resolveOAuthRedirectUri(
      'google',
      redirectUri,
    );
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId || '');
    authUrl.searchParams.set('redirect_uri', oauthRedirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('state', state);

    this.logger.log(`Redirecting to Google OAuth: ${authUrl.toString()}`);
    return res.redirect(HttpStatus.FOUND, authUrl.toString());
  }

  @Get('facebook/login')
  @ApiOperation({ summary: 'Facebook OAuth登录 - 发起授权' })
  facebookLogin(
    @Res() res: Response,
    @Query('callback') callback: string,
    @Query('inviteCode') inviteCode?: string,
    @Query('redirect_uri') redirectUri?: string,
    @Query('state') webState?: string,
  ) {
    const appId = this.configService.get<string>('FACEBOOK_APP_ID');

    const stateData: OAuthStateData = {
      provider: 'facebook',
      timestamp: Date.now(),
      nonce: this.generateNonce(),
      callback,
      inviteCode,
      redirectUri,
      webState,
    };

    const state = this.encodeState(stateData);
    const oauthRedirectUri = this.resolveOAuthRedirectUri(
      'facebook',
      redirectUri,
    );
    const authUrl = new URL('https://www.facebook.com/v18.0/dialog/oauth');
    authUrl.searchParams.set('client_id', appId || '');
    authUrl.searchParams.set('redirect_uri', oauthRedirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'email public_profile');
    authUrl.searchParams.set('state', state);

    this.logger.log(`Redirecting to Facebook OAuth: ${authUrl.toString()}`);
    return res.redirect(HttpStatus.FOUND, authUrl.toString());
  }

  @Get('apple/login')
  @ApiOperation({ summary: 'Apple OAuth登录 - 发起授权' })
  appleLogin(
    @Res() res: Response,
    @Query('callback') callback: string,
    @Query('inviteCode') inviteCode?: string,
    @Query('redirect_uri') redirectUri?: string,
    @Query('state') webState?: string,
  ) {
    const clientId = this.configService.get<string>('APPLE_CLIENT_ID');

    const stateData: OAuthStateData = {
      provider: 'apple',
      timestamp: Date.now(),
      nonce: this.generateNonce(),
      callback,
      inviteCode,
      redirectUri,
      webState,
    };

    const state = this.encodeState(stateData);
    const oauthRedirectUri = this.resolveOAuthRedirectUri('apple', redirectUri);
    const authUrl = new URL('https://appleid.apple.com/auth/authorize');
    authUrl.searchParams.set('client_id', clientId || '');
    authUrl.searchParams.set('redirect_uri', oauthRedirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'name email');
    authUrl.searchParams.set('response_mode', 'form_post'); // 强制Apple返回POST
    authUrl.searchParams.set('state', state);

    this.logger.log(`Redirecting to Apple OAuth: ${authUrl.toString()}`);
    return res.redirect(HttpStatus.FOUND, authUrl.toString());
  }

  // ==========================================
  // 第二步：接收回调 & 唤醒App
  // ==========================================

  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth回调' })
  async googleCallback(
    @Res() res: Response,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error?: string,
  ) {
    // 用户取消授权：Google 返回 error=access_denied
    if (error) {
      this.logger.log(`Google OAuth cancelled/error: ${error}`);
      const stateData = state ? this.decodeState(state) : null;
      return this.handleCancelledOAuth(res, stateData, 'google');
    }

    try {
      this.logger.log('Received Google OAuth callback');

      // 验证state
      const stateData = this.decodeState(state);
      if (stateData.provider === 'unknown') {
        throw new OAuthStateError('Invalid or expired state', 'google');
      }

      // 验证时间有效性（10分钟内）
      const now = Date.now();
      const maxAge = 10 * 60 * 1000; // 10分钟
      if (now - stateData.timestamp > maxAge) {
        throw new OAuthStateError('State expired', 'google');
      }

      const oauthRedirectUri = this.resolveOAuthRedirectUri(
        'google',
        stateData.redirectUri,
      );
      const tokens = await this.exchangeGoogleCode(code, oauthRedirectUri);
      const userInfo = await this.getGoogleUserInfo(tokens.access_token);

      const loginResult = await this.authService.loginWithOauth(
        'google',
        {
          providerUserId: userInfo.id,
          email: userInfo.email,
          nickname: userInfo.name,
          avatar: userInfo.picture,
        },
        {
          inviteCode: stateData.inviteCode,
        },
      );

      return this.handleRedirect(
        res,
        stateData.callback,
        stateData.redirectUri,
        stateData.webState,
        {
          accessToken: loginResult.tokens.accessToken,
          refreshToken: loginResult.tokens.refreshToken,
        },
        'google',
      );
    } catch (error: unknown) {
      return this.handleOAuthError(error, res, 'google');
    }
  }

  @Get('facebook/callback')
  @ApiOperation({ summary: 'Facebook OAuth回调' })
  async facebookCallback(
    @Res() res: Response,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error?: string,
    @Query('error_reason') errorReason?: string,
  ) {
    // 用户取消授权：Facebook 返回 error=access_denied, error_reason=user_denied
    if (error || errorReason === 'user_denied') {
      this.logger.log(
        `Facebook OAuth cancelled/error: ${error}, reason: ${errorReason}`,
      );
      const stateData = state ? this.decodeState(state) : null;
      return this.handleCancelledOAuth(res, stateData, 'facebook');
    }

    try {
      this.logger.log('Received Facebook OAuth callback');

      // 验证state
      const stateData = this.decodeState(state);
      if (stateData.provider === 'unknown') {
        throw new OAuthStateError('Invalid or expired state', 'facebook');
      }

      // 验证时间有效性（10分钟内）
      const now = Date.now();
      const maxAge = 10 * 60 * 1000; // 10分钟
      if (now - stateData.timestamp > maxAge) {
        throw new OAuthStateError('State expired', 'facebook');
      }

      const oauthRedirectUri = this.resolveOAuthRedirectUri(
        'facebook',
        stateData.redirectUri,
      );
      const tokens = await this.exchangeFacebookCode(code, oauthRedirectUri);
      const userInfo = await this.getFacebookUserInfo(tokens.access_token);

      const loginResult = await this.authService.loginWithOauth(
        'facebook',
        {
          providerUserId: userInfo.id,
          email: userInfo.email,
          nickname: userInfo.name,
          avatar: userInfo.picture?.data?.url,
        },
        {
          inviteCode: stateData.inviteCode,
        },
      );

      return this.handleRedirect(
        res,
        stateData.callback,
        stateData.redirectUri,
        stateData.webState,
        {
          accessToken: loginResult.tokens.accessToken,
          refreshToken: loginResult.tokens.refreshToken,
        },
        'facebook',
      );
    } catch (error: unknown) {
      return this.handleOAuthError(error, res, 'facebook');
    }
  }

  // 修复: Apple 使用的是 form_post，必须是 @Post 和 @Body
  @Post('apple/callback')
  @ApiOperation({ summary: 'Apple OAuth回调' })
  async appleCallback(
    @Res() res: Response,
    @Body('code') code: string,
    @Body('state') state: string,
    @Body('user') userStr?: string, // 修复: 截获首登时传来的用户名字
  ) {
    try {
      this.logger.log('Received Apple OAuth callback (POST)');

      // 验证state
      const stateData = this.decodeState(state);
      if (stateData.provider === 'unknown') {
        throw new OAuthStateError('Invalid or expired state', 'apple');
      }

      // 验证时间有效性（10分钟内）
      const now = Date.now();
      const maxAge = 10 * 60 * 1000; // 10分钟
      if (now - stateData.timestamp > maxAge) {
        throw new OAuthStateError('State expired', 'apple');
      }

      const oauthRedirectUri = this.resolveOAuthRedirectUri(
        'apple',
        stateData.redirectUri,
      );
      const tokens = await this.exchangeAppleCode(code, oauthRedirectUri);
      const userInfo = this.parseAppleIdToken(tokens.id_token);

      // 修复: 只有第一次登录才会下发 user 字符串，解析出名字
      let nickname = null;
      if (userStr) {
        try {
          const parsedUser = JSON.parse(userStr);
          nickname =
            `${parsedUser.name?.firstName || ''} ${parsedUser.name?.lastName || ''}`.trim() ||
            null;
        } catch (e) {
          this.logger.warn('Failed to parse Apple user string');
        }
      }

      const loginResult = await this.authService.loginWithOauth(
        'apple',
        {
          providerUserId: userInfo.sub,
          email: userInfo.email,
          nickname: nickname,
          avatar: null, // Apple 不给头像
        },
        {
          inviteCode: stateData.inviteCode,
        },
      );

      return this.handleRedirect(
        res,
        stateData.callback,
        stateData.redirectUri,
        stateData.webState,
        {
          accessToken: loginResult.tokens.accessToken,
          refreshToken: loginResult.tokens.refreshToken,
        },
        'apple',
      );
    } catch (error: unknown) {
      return this.handleOAuthError(error, res, 'apple');
    }
  }

  // ==========================================
  // 核心：处理重定向（唤醒App或返回Web）
  // ==========================================

  private handleRedirect(
    res: Response,
    callback: string | undefined,
    redirectUri: string | undefined,
    webState: string | undefined,
    loginResult: { accessToken: string; refreshToken: string },
    provider: string,
  ) {
    this.logger.debug(`handleRedirect called with:
      callback: ${callback}
      redirectUri: ${redirectUri}
      webState: ${webState}
      provider: ${provider}`);

    // Web端重定向逻辑
    if (redirectUri) {
      // 验证Web端State（防CSRF）
      if (webState && !this.isValidWebState(webState, provider)) {
        this.logger.warn(`Invalid web state for provider ${provider}`);
        // 重定向到错误页面
        return res.redirect(
          HttpStatus.FOUND,
          '/oauth-error?code=INVALID_STATE',
        );
      }

      // 设置 HttpOnly cookie，前端中间件可读取 token 进行路由保护
      res.cookie('token', loginResult.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      });

      const redirectUrl = new URL(redirectUri);
      redirectUrl.searchParams.set('token', loginResult.accessToken);
      redirectUrl.searchParams.set('refreshToken', loginResult.refreshToken);

      if (webState) {
        redirectUrl.searchParams.set('state', webState);
      }

      this.logger.log(`Redirecting to Web: ${redirectUrl.toString()}`);
      return res.redirect(HttpStatus.FOUND, redirectUrl.toString());
    }

    // 移动端Deep Link逻辑
    if (callback) {
      try {
        const deepLink = new URL(callback);
        deepLink.searchParams.set('token', loginResult.accessToken);
        deepLink.searchParams.set('refreshToken', loginResult.refreshToken);

        this.logger.log(`Redirecting to App Deep Link: ${deepLink.toString()}`);
        return res.redirect(HttpStatus.FOUND, deepLink.toString());
      } catch (e) {
        this.logger.warn(
          `Invalid callback URL format: ${callback}. Error: ${e instanceof Error ? e.message : 'Unknown error'}`,
        );
        // URL 格式错误，降级跳回 Web 首页
      }
    }

    // Web fallback (默认)
    res.cookie('auth_token', loginResult.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    this.logger.log('Redirecting to Web dashboard');
    return res.redirect(HttpStatus.FOUND, '/dashboard');
  }

  private handleOAuthError(error: unknown, res: Response, provider: string) {
    if (error instanceof OAuthError) {
      const userMessage = getUserFriendlyErrorMessage(error);
      this.logger.warn(
        `OAuth error (${provider}): ${error.code} - ${error.message}`,
      );

      // 用户取消登录，静默处理
      if (error instanceof OAuthUserCancelledError) {
        return this.handleCancelledOAuth(res, null, provider);
      }

      // 其他错误，重定向到前端错误页面
      const frontendUrl = this.configService.get<string>(
        'FRONTEND_URL',
        'http://localhost:5173',
      );
      const errorUrl = `${frontendUrl}/oauth-error?code=${error.code}&provider=${provider}&message=${encodeURIComponent(userMessage)}`;
      return res.redirect(HttpStatus.FOUND, errorUrl);
    }

    // 未知错误
    const message = error instanceof Error ? error.message : 'Unknown error';
    this.logger.error(`Unexpected error in ${provider} callback: ${message}`);

    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'An unexpected error occurred',
    });
  }

  /**
   * 处理用户主动取消 OAuth 授权的重定向逻辑
   * 优先级：移动端 Deep Link > Web redirectUri > 前端首页
   */
  private handleCancelledOAuth(
    res: Response,
    stateData: OAuthStateData | null,
    provider: string,
  ) {
    this.logger.log(`User cancelled ${provider} OAuth, redirecting back`);

    // 移动端 Deep Link 回调
    if (stateData?.callback) {
      try {
        const deepLink = new URL(stateData.callback);
        deepLink.searchParams.set('error', 'cancelled');
        deepLink.searchParams.set('provider', provider);
        this.logger.log(
          `Cancelled: redirecting to deep link ${deepLink.toString()}`,
        );
        return res.redirect(HttpStatus.FOUND, deepLink.toString());
      } catch (_e) {
        this.logger.warn(
          `Invalid callback URL for cancelled OAuth: ${stateData.callback}`,
        );
      }
    }

    // Web 端 redirectUri 回调
    if (stateData?.redirectUri) {
      try {
        const webUrl = new URL(stateData.redirectUri);
        webUrl.searchParams.set('error', 'cancelled');
        webUrl.searchParams.set('provider', provider);
        this.logger.log(
          `Cancelled: redirecting to web URL ${webUrl.toString()}`,
        );
        return res.redirect(HttpStatus.FOUND, webUrl.toString());
      } catch (_e) {
        this.logger.warn(
          `Invalid redirectUri for cancelled OAuth: ${stateData.redirectUri}`,
        );
      }
    }

    // Fallback：前端登录页
    const frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:5173',
    );
    return res.redirect(
      HttpStatus.FOUND,
      `${frontendUrl}/login?cancelled=true&provider=${provider}`,
    );
  }

  // ==========================================
  // OAuth交换逻辑 (Google & Facebook 原样保留)
  // ==========================================

  private async exchangeGoogleCode(
    code: string,
    redirectUri: string,
  ): Promise<{ access_token: string }> {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GOOGLE_CLIENT_SECRET');

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId || '',
        client_secret: clientSecret || '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new OAuthProviderError(
        `Failed to exchange Google code: ${response.status} - ${errorText}`,
        'google',
      );
    }
    return response.json() as Promise<{ access_token: string }>;
  }

  private async getGoogleUserInfo(
    accessToken: string,
  ): Promise<{ id: string; email: string; name: string; picture: string }> {
    const response = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok)
      throw new OAuthProviderError('Failed to get Google user info', 'google');
    return response.json() as any;
  }

  private async exchangeFacebookCode(
    code: string,
    redirectUri: string,
  ): Promise<{ access_token: string }> {
    const appId = this.configService.get<string>('FACEBOOK_APP_ID');
    const appSecret = this.configService.get<string>('FACEBOOK_APP_SECRET');

    const url = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
    url.searchParams.set('code', code);
    url.searchParams.set('client_id', appId || '');
    url.searchParams.set('client_secret', appSecret || '');
    url.searchParams.set('redirect_uri', redirectUri);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new OAuthProviderError(
        `Failed to exchange Facebook code: ${response.status} - ${errorText}`,
        'facebook',
      );
    }
    return response.json() as any;
  }

  private async getFacebookUserInfo(accessToken: string): Promise<{
    id: string;
    email: string;
    name: string;
    picture?: { data?: { url?: string } };
  }> {
    const response = await fetch(
      'https://graph.facebook.com/me?fields=id,name,email,picture',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok)
      throw new OAuthProviderError(
        'Failed to get Facebook user info',
        'facebook',
      );
    return response.json() as any;
  }

  private async exchangeAppleCode(
    code: string,
    redirectUri: string,
  ): Promise<{ id_token: string }> {
    const clientId = this.configService.get<string>('APPLE_CLIENT_ID');

    const response = await fetch('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId || '',
        client_secret: this.generateAppleClientSecret(), // TODO: 需要实现动态Apple Client Secret生成
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new OAuthProviderError(
        `Failed to exchange Apple code: ${response.status} - ${errorText}`,
        'apple',
      );
    }
    return response.json() as any;
  }

  private parseAppleIdToken(idToken: string): { sub: string; email?: string } {
    const payload = idToken.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
  }

  /**
   * 生成 Apple Sign In with Apple 的 client_secret
   *
   * Apple 要求 client_secret 是一个用 ES256 算法签发的 JWT，
   * 使用 Apple Developer 后台的 .p8 私钥、Team ID 和 Key ID 实时签发。
   *
   * 参考 Apple 文档：
   * https://developer.apple.com/documentation/sign_in_with_apple/generate_and_validate_tokens
   */
  private generateAppleClientSecret(): string {
    const teamId = this.configService.get<string>('APPLE_TEAM_ID');
    const keyId = this.configService.get<string>('APPLE_KEY_ID');
    const privateKey = this.getApplePrivateKey();
    const clientId = this.configService.get<string>('APPLE_CLIENT_ID');

    if (!teamId || !keyId || !privateKey || !clientId) {
      this.logger.error(
        `Apple OAuth credentials not configured. teamId=${!!teamId} keyId=${!!keyId} privateKey=${!!privateKey && privateKey.length > 0} clientId=${!!clientId}`,
      );
      throw new OAuthProviderError(
        'Apple OAuth credentials not configured',
        'apple',
      );
    }

    const now = Math.floor(Date.now() / 1000);

    const claims: Record<string, string | number> = {
      iss: teamId,
      iat: now,
      exp: now + 60 * 60 * 24 * 30, // 30 天有效期（Apple 建议最长 6 个月）
      aud: 'https://appleid.apple.com',
      sub: clientId,
    };

    const options: jwt.SignOptions = {
      algorithm: 'ES256',
      keyid: keyId,
    };

    return jwt.sign(claims, privateKey, options);
  }

  /**
   * 获取 Apple .p8 私钥，支持多种格式：
   *
   * 1. APPLE_PRIVATE_KEY_BASE64（优先级最高）— base64 编码的 PEM 文件内容，
   *    单行无换行符，对 Docker Compose env_file 最友好。
   * 2. APPLE_PRIVATE_KEY（降级）— 原始 PEM，支持单行内用 \n 表示换行。
   *
   * 为什么需要两种格式？
   * Docker Compose `env_file` 使用标准 dotenv 解析，不支持多行值。
   * 如果 APPLE_PRIVATE_KEY 包含实际换行符，dotenv 会截断在第一行，
   * 导致私钥不完整（只有 "-----BEGIN PRIVATE KEY-----"）。
   * Base64 编码没有任何换行符问题，是最安全的方式。
   */
  private getApplePrivateKey(): string {
    // 优先级 1: Base64 编码的私钥（单行，对 dotenv 最友好）
    const base64Key = this.configService.get<string>('APPLE_PRIVATE_KEY_BASE64');
    if (base64Key) {
      try {
        const decoded = Buffer.from(base64Key, 'base64').toString('utf-8');
        if (decoded.includes('-----BEGIN') && decoded.includes('-----END')) {
          this.logger.debug('Using APPLE_PRIVATE_KEY_BASE64 (base64 decoded)');
          return decoded;
        }
        this.logger.warn(
          `APPLE_PRIVATE_KEY_BASE64 decoded but doesn't look like a valid PEM key`,
        );
      } catch (e) {
        this.logger.warn(
          'Failed to decode APPLE_PRIVATE_KEY_BASE64, falling back to APPLE_PRIVATE_KEY',
        );
      }
    }

    // 优先级 2: 原始 PEM（支持单行 \n 或实际换行符）
    const rawKey = this.configService.get<string>('APPLE_PRIVATE_KEY') || '';
    const key = rawKey.replace(/\\n/g, '\n').trim();

    // 诊断日志
    this.logger.debug(
      `Apple private key loaded from APPLE_PRIVATE_KEY. ` +
      `Length: ${key.length}, ` +
      `Starts with: ${key.substring(0, 35)}..., ` +
      `Ends with: ...${key.substring(Math.max(0, key.length - 30))}`,
    );

    if (!key.includes('-----BEGIN') || !key.includes('-----END')) {
      this.logger.warn(
        `APPLE_PRIVATE_KEY appears truncated or malformed (length=${key.length}). ` +
        `This usually means the env file has the key with actual newlines (multi-line) ` +
        `which Docker Compose truncates. ` +
        `Use APPLE_PRIVATE_KEY_BASE64 instead.`,
      );
    }

    return key;
  }

  // ==========================================
  // State编码/解码
  // ==========================================

  private encodeState(data: OAuthStateData): string {
    const stateString = JSON.stringify(data);
    return Buffer.from(stateString).toString('base64url');
  }

  private decodeState(state: string): OAuthStateData {
    try {
      const decoded = Buffer.from(state, 'base64url').toString('utf-8');
      const data = JSON.parse(decoded) as OAuthStateData;

      // 验证必需字段
      if (!data.provider || !data.timestamp || !data.nonce) {
        this.logger.warn(`Invalid state: missing required fields: ${state}`);
        return { provider: 'unknown', timestamp: 0, nonce: '' };
      }

      return data;
    } catch (error) {
      this.logger.warn(
        `Failed to decode state: ${state}, error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return { provider: 'unknown', timestamp: 0, nonce: '' };
    }
  }

  private generateNonce(): string {
    // 生成16字节的随机数
    const randomBytes = crypto.randomBytes(16);
    return randomBytes.toString('hex');
  }

  private isValidWebState(_state: string, _provider: string): boolean {
    // TODO: 在实际项目中，这里需要：
    // 1. 验证state格式
    // 2. 从sessionStorage或Redis中查找对应的state
    // 3. 验证state是否已使用（防止重放攻击）
    // 暂时返回true，后续实现
    return true;
  }
}
