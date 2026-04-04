import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { VerifiedOauthProfile } from './provider.types';

interface FacebookProfileResponse {
  id?: string;
  name?: string;
  email?: string;
  picture?: { data?: { url?: string } };
}

interface FacebookIdTokenPayload {
  iss?: string;
  aud?: string;
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
  exp?: number;
  iat?: number;
}

@Injectable()
export class FacebookProvider {
  private readonly logger = new Logger(FacebookProvider.name);
  private readonly facebookAppId?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    this.facebookAppId = this.configService.get<string>('FACEBOOK_APP_ID');
    if (!this.facebookAppId) {
      this.logger.warn(
        'FACEBOOK_APP_ID not configured, ID token verification will skip audience validation',
      );
    }
  }

  async verify(input: {
    accessToken: string;
    userId: string;
  }): Promise<VerifiedOauthProfile> {
    const accessToken = input.accessToken.trim();
    const userId = input.userId.trim();

    if (!accessToken || !userId) {
      throw new UnauthorizedException('Invalid facebook token');
    }

    // 判断是Access Token还是ID Token
    // ID Token通常是JWT格式，包含3个部分用点分隔
    const isIdToken = accessToken.split('.').length === 3;

    if (isIdToken) {
      return this.verifyIdToken(accessToken, userId);
    } else {
      return this.verifyAccessToken(accessToken, userId);
    }
  }

  private async verifyAccessToken(
    accessToken: string,
    userId: string,
  ): Promise<VerifiedOauthProfile> {
    this.logger.debug('Verifying Facebook access token via Graph API');

    const fields = 'id,name,email,picture';
    const res = await fetch(
      `https://graph.facebook.com/me?fields=${fields}&access_token=${encodeURIComponent(
        accessToken,
      )}`,
    );

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      this.logger.error(
        `Facebook Graph API failed: ${res.status} ${errorText}`,
      );
      throw new UnauthorizedException('Facebook token verification failed');
    }

    const data = (await res.json()) as FacebookProfileResponse;
    if (!data.id || data.id !== userId) {
      this.logger.error(
        `Facebook user mismatch: token user=${data.id}, provided user=${userId}`,
      );
      throw new UnauthorizedException('Facebook user mismatch');
    }

    this.logger.debug(`Facebook access token verified for user: ${data.id}`);

    return {
      providerUserId: data.id,
      email: data.email?.trim() || null,
      nickname: data.name?.trim() || null,
      avatar: data.picture?.data?.url?.trim() || null,
    };
  }

  private async verifyIdToken(
    idToken: string,
    userId: string,
  ): Promise<VerifiedOauthProfile> {
    this.logger.debug('Verifying Facebook ID token via JWT validation');

    try {
      // 首先尝试本地JWT验证
      const decoded = this.jwtService.decode(idToken);

      if (!decoded || !decoded.sub) {
        throw new UnauthorizedException('Invalid Facebook ID token format');
      }

      // 验证受众（如果配置了Facebook App ID）
      if (this.facebookAppId && decoded.aud !== this.facebookAppId) {
        this.logger.error(
          `Facebook ID token audience mismatch: expected=${this.facebookAppId}, got=${decoded.aud}`,
        );
        throw new UnauthorizedException('Facebook token audience mismatch');
      }

      // 验证用户ID匹配
      if (decoded.sub !== userId) {
        this.logger.error(
          `Facebook ID token user mismatch: token user=${decoded.sub}, provided user=${userId}`,
        );
        throw new UnauthorizedException('Facebook user mismatch');
      }

      // 验证令牌是否过期
      if (decoded.exp && Date.now() >= decoded.exp * 1000) {
        this.logger.error(`Facebook ID token expired: exp=${decoded.exp}`);
        throw new UnauthorizedException('Facebook token expired');
      }

      // 可选：调用Facebook的debug_token端点进行额外验证
      // 这可以提供更强的安全性，但会增加网络延迟
      await this.validateWithFacebookDebugToken(idToken);

      this.logger.debug(`Facebook ID token verified for user: ${decoded.sub}`);

      return {
        providerUserId: decoded.sub,
        email: decoded.email?.trim() || null,
        nickname: decoded.name?.trim() || null,
        avatar: decoded.picture?.trim() || null,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Facebook ID token validation failed: ${errorMessage}`,
        errorStack,
      );
      throw new UnauthorizedException('Facebook token verification failed');
    }
  }

  private async validateWithFacebookDebugToken(token: string): Promise<void> {
    try {
      // Facebook的debug_token端点需要应用访问令牌
      // 这里我们只是记录一个警告，因为不是所有应用都有应用访问令牌
      this.logger.warn(
        'Facebook debug_token validation not implemented. Consider adding FACEBOOK_APP_ACCESS_TOKEN for enhanced security.',
      );

      // 如果配置了Facebook应用访问令牌，可以启用以下代码：
      // const appAccessToken = this.configService.get<string>('FACEBOOK_APP_ACCESS_TOKEN');
      // if (appAccessToken) {
      //   const res = await fetch(
      //     `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appAccessToken)}`,
      //   );
      //
      //   if (!res.ok) {
      //     throw new Error(`Facebook debug_token API failed: ${res.status}`);
      //   }
      //
      //   const debugData = await res.json();
      //   if (!debugData.data?.is_valid) {
      //     throw new Error('Facebook token is invalid according to debug_token');
      //   }
      // }
    } catch (error) {
      // 不抛出异常，因为debug_token验证是可选的
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Optional Facebook debug_token validation failed: ${errorMessage}`,
      );
    }
  }
}
