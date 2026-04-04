import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { VerifiedOauthProfile, OauthProvider } from './provider.types';

@Injectable()
export class FirebaseProvider {
  private readonly logger = new Logger(FirebaseProvider.name);

  constructor(private readonly configService: ConfigService) {
    // 初始化 Firebase Admin SDK
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
        this.logger.log('Firebase Admin SDK initialized');
      } else {
        this.logger.warn(
          'Firebase Admin SDK not configured, skipping initialization',
        );
      }
    }
  }

  async verifyIdToken(
    idToken: string,
  ): Promise<{ provider: OauthProvider; profile: VerifiedOauthProfile }> {
    try {
      // 检查 Firebase Admin SDK 是否已初始化
      if (!admin.apps.length) {
        throw new UnauthorizedException('Firebase Admin SDK not initialized');
      }

      const decodedToken = await admin.auth().verifyIdToken(idToken);

      // 获取 provider 信息
      const firebaseProvider =
        decodedToken.firebase?.sign_in_provider || 'unknown';
      let provider: OauthProvider = 'google'; // 默认为 google

      if (firebaseProvider.includes('google.com')) {
        provider = 'google';
      } else if (firebaseProvider.includes('facebook.com')) {
        provider = 'facebook';
      } else if (firebaseProvider.includes('apple.com')) {
        provider = 'apple';
      }

      this.logger.debug(
        `Firebase token verified: ${decodedToken.uid}, provider: ${provider}`,
      );

      return {
        provider,
        profile: {
          providerUserId: decodedToken.uid,
          email: decodedToken.email || null,
          nickname:
            decodedToken.name || decodedToken.email?.split('@')[0] || null,
          avatar: decodedToken.picture || null,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Firebase token verification failed: ${message}`);
      throw new UnauthorizedException('Firebase token verification failed');
    }
  }
}
