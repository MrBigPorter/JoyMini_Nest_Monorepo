import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VerifiedOauthProfile } from './provider.types';

interface GithubUserInfo {
  id: number;
  login: string;
  email?: string | null;
  name?: string | null;
  avatar_url?: string | null;
  html_url?: string;
}

interface GithubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

@Injectable()
export class GithubProvider {
  private readonly logger = new Logger(GithubProvider.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * 验证Github OAuth授权码，获取用户信息
   * @param code Github OAuth授权码
   * @returns 验证后的用户信息
   */
  async verify(code: string): Promise<VerifiedOauthProfile> {
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      throw new UnauthorizedException('Invalid github code');
    }

    try {
      // 1. 使用code交换access_token
      const accessToken = await this.exchangeCodeForToken(normalizedCode);

      // 2. 使用access_token获取用户信息
      const userInfo = await this.getUserInfo(accessToken);

      // 3. 验证并返回标准化用户信息
      return this.normalizeUserInfo(userInfo);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Github OAuth verification failed: ${message}`);
      throw new UnauthorizedException('Github OAuth verification failed');
    }
  }

  /**
   * 使用授权码交换access_token
   */
  private async exchangeCodeForToken(code: string): Promise<string> {
    const clientId = this.configService.get<string>('GITHUB_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GITHUB_CLIENT_SECRET');
    const redirectUri = this.configService.get<string>('GITHUB_REDIRECT_URI');

    if (!clientId || !clientSecret) {
      throw new UnauthorizedException('Github OAuth not configured');
    }

    const response = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri || undefined,
        }),
      },
    );

    if (!response.ok) {
      throw new UnauthorizedException(
        'Failed to exchange code for access token',
      );
    }

    const data = (await response.json()) as GithubTokenResponse;

    if (!data.access_token) {
      throw new UnauthorizedException('No access token in response');
    }

    return data.access_token;
  }

  /**
   * 使用access_token获取用户信息
   */
  private async getUserInfo(accessToken: string): Promise<GithubUserInfo> {
    // 获取用户基本信息
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'JoyMinis-App',
      },
    });

    if (!userResponse.ok) {
      throw new UnauthorizedException('Failed to get user info from Github');
    }

    const userInfo = (await userResponse.json()) as GithubUserInfo;

    // 如果用户信息中没有邮箱，尝试获取用户邮箱（需要额外权限）
    if (!userInfo.email) {
      try {
        const emailsResponse = await fetch(
          'https://api.github.com/user/emails',
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
              'User-Agent': 'JoyMinis-App',
            },
          },
        );

        if (emailsResponse.ok) {
          const emails = (await emailsResponse.json()) as Array<{
            email: string;
            primary: boolean;
            verified: boolean;
            visibility: string | null;
          }>;

          // 查找主要且已验证的邮箱
          const primaryEmail = emails.find(
            (email) => email.primary && email.verified,
          );
          if (primaryEmail) {
            userInfo.email = primaryEmail.email;
          }
        }
      } catch (error) {
        this.logger.warn('Failed to fetch user emails from Github:', error);
        // 邮箱不是必需的，继续使用基本信息
      }
    }

    return userInfo;
  }

  /**
   * 标准化用户信息为VerifiedOauthProfile格式
   */
  private normalizeUserInfo(userInfo: GithubUserInfo): VerifiedOauthProfile {
    const providerUserId = String(userInfo.id);
    if (!providerUserId) {
      throw new UnauthorizedException('Github user ID not found');
    }

    // Github可能返回null邮箱，特别是当用户设置了邮箱隐私时
    let email = userInfo.email;
    if (!email && userInfo.login) {
      // 如果用户没有公开邮箱，使用Github提供的noreply邮箱或生成伪邮箱
      // 注意：这只是一个后备方案，实际使用时可能需要用户提供邮箱
      email = `${userInfo.login}@users.noreply.github.com`;
    }

    return {
      providerUserId,
      email: email?.trim() || null,
      nickname: userInfo.name?.trim() || userInfo.login?.trim() || null,
      avatar: userInfo.avatar_url?.trim() || null,
    };
  }

  /**
   * 验证Github access_token（直接使用access_token登录的情况）
   * @param accessToken Github access_token
   * @returns 验证后的用户信息
   */
  async verifyAccessToken(accessToken: string): Promise<VerifiedOauthProfile> {
    const token = accessToken.trim();
    if (!token) {
      throw new UnauthorizedException('Invalid github access token');
    }

    try {
      const userInfo = await this.getUserInfo(token);
      return this.normalizeUserInfo(userInfo);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Github access token verification failed: ${message}`);
      throw new UnauthorizedException(
        'Github access token verification failed',
      );
    }
  }
}
