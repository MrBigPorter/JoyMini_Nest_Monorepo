import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';
import {
  ConsoleSmsProvider,
  FixedSmsProvider,
  resolveSmsProviderKind,
  UnconfiguredSmsProvider,
} from './sms.provider';

@Module({
  imports: [ConfigModule.forFeature(() => ({})), PrismaModule],
  controllers: [OtpController],
  providers: [
    OtpService,
    {
      provide: 'SMS_PROVIDER',
      useFactory: () => {
        switch (resolveSmsProviderKind()) {
          case 'fixed':
            return new FixedSmsProvider();
          case 'console':
            return new ConsoleSmsProvider();
          default:
            return new UnconfiguredSmsProvider();
        }
      },
    },
  ],
  exports: [OtpService],
})
export class OtpModule {}
