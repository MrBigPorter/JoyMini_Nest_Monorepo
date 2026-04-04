import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { OAuthDeepLinkController } from './oauth-deeplink.controller';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { JwtStrategy } from '@api/common/jwt/jwt.strategy';
import { GoogleProvider } from '@api/client/auth/providers/google.provider';
import { FacebookProvider } from '@api/client/auth/providers/facebook.provider';
import { AppleProvider } from '@api/client/auth/providers/apple.provider';
import { FirebaseProvider } from '@api/client/auth/providers/firebase.provider';
import type { StringValue } from 'ms';
@Module({
  imports: [
    PrismaModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'please_change_me_very_secret',
      signOptions: {
        expiresIn:
          (process.env.JWT_ACCESS_EXPIRATION as StringValue | undefined) ||
          '15m',
      },
    }),
  ],
  controllers: [AuthController, OAuthDeepLinkController],
  providers: [
    AuthService,
    JwtAuthGuard,
    JwtStrategy,
    GoogleProvider,
    FacebookProvider,
    AppleProvider,
    FirebaseProvider,
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
