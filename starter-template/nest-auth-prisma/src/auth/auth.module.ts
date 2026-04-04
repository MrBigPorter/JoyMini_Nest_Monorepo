import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../common/prisma/prisma.module';
import { JwtAuthGuard } from '../common/jwt/jwt-auth.guard';
import { JwtStrategy } from '../common/jwt/jwt.strategy';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    PrismaModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || 'change_me',
      signOptions: { expiresIn: process.env.ADMIN_JWT_ACCESS_EXPIRATION || '12h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}

