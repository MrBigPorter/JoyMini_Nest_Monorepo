import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { VerifiedOauthProfile } from './provider.types';

interface GoogleTokenInfo {
  aud?: string;
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
  email_verified?: boolean | string;
}

@Injectable()
export class GoogleProvider {
  private readonly logger = new Logger(GoogleProvider.name);

  constructor(private readonly configService: ConfigService) {
    // Initialize Firebase Admin SDK if not already initialized
    if (!admin.apps.length) {
      const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
      const clientEmail = this.configService.get<string>(
        'FIREBASE_CLIENT_EMAIL',
      );
      const privateKey = this.configService
        .get<string>('FIREBASE_PRIVATE_KEY')
        ?.replace(/\\n/g, '\n');

      if (projectId && clientEmail && privateKey) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            clientEmail,
            privateKey,
          }),
        });
        this.logger.log('Firebase Admin SDK initialized in GoogleProvider');
      } else {
        this.logger.warn('Firebase Admin SDK not configured in GoogleProvider');
      }
    }
  }

  async verify(idToken: string): Promise<VerifiedOauthProfile> {
    const token = idToken.trim();
    if (!token) {
      throw new UnauthorizedException('Invalid google token');
    }

    // Check if this is a Firebase ID token by examining the JWT payload
    try {
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64').toString('utf-8'),
      );

      // Firebase ID tokens have iss starting with https://securetoken.google.com/
      if (payload.iss?.startsWith('https://securetoken.google.com/')) {
        this.logger.debug(
          'Detected Firebase ID token, using Firebase verification',
        );
        return await this.verifyFirebaseToken(token);
      }
    } catch (error) {
      // If we can't parse the JWT, fall through to Google verification
      this.logger.debug(
        'Could not parse JWT payload, using Google verification',
      );
    }

    // Original Google OAuth token verification
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(
        token,
      )}`,
    );

    if (!res.ok) {
      throw new UnauthorizedException('Google token verification failed');
    }

    const data = (await res.json()) as GoogleTokenInfo;
    const providerUserId = data.sub?.trim();
    if (!providerUserId) {
      throw new UnauthorizedException('Google token missing subject');
    }

    // 从环境配置获取允许的Client ID列表
    // 注意：环境变量中的JSON数组需要特殊处理
    const allowedClientIdsRaw = this.configService.get<string>(
      'GOOGLE_ALLOWED_CLIENT_IDS',
    );
    const singleClientId = this.configService.get<string>('GOOGLE_CLIENT_ID');

    // 构建最终的允许列表
    const finalAllowedIds: string[] = [];

    // 解析 GOOGLE_ALLOWED_CLIENT_IDS（支持JSON数组格式）
    if (allowedClientIdsRaw) {
      try {
        // 尝试解析JSON数组
        const parsedIds = JSON.parse(allowedClientIdsRaw);
        if (Array.isArray(parsedIds)) {
          finalAllowedIds.push(
            ...parsedIds.filter((id): id is string => typeof id === 'string'),
          );
        }
      } catch (error) {
        // 如果不是JSON，尝试按逗号分割
        const ids = allowedClientIdsRaw
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
        finalAllowedIds.push(...ids);
      }
    }

    // 向后兼容：添加 GOOGLE_CLIENT_ID（如果存在且不在列表中）
    if (singleClientId && !finalAllowedIds.includes(singleClientId)) {
      finalAllowedIds.push(singleClientId);
    }

    // 添加调试日志
    this.logger.debug('Google OAuth Debug:', {
      allowedClientIdsRaw,
      singleClientId,
      finalAllowedIds,
      tokenAud: data.aud,
    });

    // 如果没有配置任何Client ID，跳过验证（为了向后兼容，但生产环境应该配置）
    if (finalAllowedIds.length === 0) {
      this.logger.warn(
        'No Google Client IDs configured. Audience validation skipped.',
      );
    } else if (!finalAllowedIds.includes(data.aud || '')) {
      this.logger.error('Google token audience mismatch:', {
        allowedIds: finalAllowedIds,
        tokenAud: data.aud,
      });
      throw new UnauthorizedException('Google token audience mismatch');
    }

    if (data.email_verified === false || data.email_verified === 'false') {
      throw new UnauthorizedException('Google email not verified');
    }

    return {
      providerUserId,
      email: data.email?.trim() || null,
      nickname: data.name?.trim() || null,
      avatar: data.picture?.trim() || null,
    };
  }

  private async verifyFirebaseToken(
    idToken: string,
  ): Promise<VerifiedOauthProfile> {
    try {
      // Check if Firebase Admin SDK is initialized
      if (!admin.apps.length) {
        throw new UnauthorizedException('Firebase Admin SDK not initialized');
      }

      const decodedToken = await admin.auth().verifyIdToken(idToken);

      // Get provider information
      const provider = decodedToken.firebase?.sign_in_provider || 'unknown';
      let providerName = 'firebase';

      if (provider.includes('google.com')) {
        providerName = 'google';
      } else if (provider.includes('facebook.com')) {
        providerName = 'facebook';
      } else if (provider.includes('apple.com')) {
        providerName = 'apple';
      }

      this.logger.debug(
        `Firebase token verified: ${decodedToken.uid}, provider: ${providerName}`,
      );

      return {
        providerUserId: decodedToken.uid,
        email: decodedToken.email || null,
        nickname:
          decodedToken.name || decodedToken.email?.split('@')[0] || null,
        avatar: decodedToken.picture || null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Firebase token verification failed: ${message}`);
      throw new UnauthorizedException('Firebase token verification failed');
    }
  }
}
