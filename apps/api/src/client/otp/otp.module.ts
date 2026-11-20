import { Logger, Module } from '@nestjs/common';
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
        const kind = resolveSmsProviderKind();
        if (kind === 'fixed' && process.env.NODE_ENV === 'production') {
          new Logger('OtpModule').warn(
            '⚠️ SMS OTP is running in FIXED mode in production: ' +
              'all phones share one code and /otp/request returns it. ' +
              'This is only acceptable for demo/acceptance environments.',
          );
        }
        switch (kind) {
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
