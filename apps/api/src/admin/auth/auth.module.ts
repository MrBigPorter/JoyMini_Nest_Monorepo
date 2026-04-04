import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { JwtStrategy } from '@api/common/jwt/jwt.strategy';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { PasswordService } from '@api/common/service/password.service';
import type { StringValue } from 'ms';

@Module({
  imports: [
    PrismaModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret:
        process.env.ADMIN_JWT_SECRET ||
        process.env.JWT_SECRET ||
        'please_change_me_very_secret',
      signOptions: {
        expiresIn:
          (process.env.ADMIN_JWT_ACCESS_EXPIRATION as
            | StringValue
            | undefined) || '12h',
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, JwtStrategy, PasswordService],
  exports: [AuthService, JwtModule], //导出给别人用
})
export class AuthModule {}
