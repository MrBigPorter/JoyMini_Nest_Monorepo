import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';
import { ConsoleSmsProvider, UnconfiguredSmsProvider } from './sms.provider';

@Module({
  imports: [ConfigModule.forFeature(() => ({})), PrismaModule],
  controllers: [OtpController],
  providers: [
    OtpService,
    {
      provide: 'SMS_PROVIDER',
      useFactory: () =>
        process.env.NODE_ENV === 'production'
          ? new UnconfiguredSmsProvider()
          : new ConsoleSmsProvider(),
    },
  ],
  exports: [OtpService],
})
export class OtpModule {}
