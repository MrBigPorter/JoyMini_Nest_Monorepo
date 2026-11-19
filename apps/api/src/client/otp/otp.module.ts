import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';
import { ConsoleSmsProvider, UnconfiguredSmsProvider } from './sms.provider';
import { SemaphoreSmsProvider } from './semaphore-sms.provider';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [OtpController],
  providers: [
    OtpService,
    {
      provide: 'SMS_PROVIDER',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const nodeEnv = config.get<string>('NODE_ENV') ?? process.env.NODE_ENV;
        const provider =
          config.get<string>('SMS_PROVIDER') ??
          (nodeEnv === 'development' ? 'console' : 'none');

        if (provider === 'console') {
          if (nodeEnv === 'production') {
            throw new Error('SMS_PROVIDER=console is not allowed in production');
          }
          return new ConsoleSmsProvider();
        }

        if (provider === 'semaphore') {
          const apiKey = config.get<string>('SEMAPHORE_API_KEY') ?? '';
          if (!apiKey) {
            throw new Error(
              'SEMAPHORE_API_KEY is required when SMS_PROVIDER=semaphore',
            );
          }
          return new SemaphoreSmsProvider({
            apiKey,
            senderName: config.get<string>('SEMAPHORE_SENDER_NAME') || undefined,
            messageTemplate: config.get<string>('SEMAPHORE_OTP_MESSAGE') || undefined,
            timeoutMs:
              Number(config.get<string>('SMS_HTTP_TIMEOUT_MS')) || undefined,
          });
        }

        if (provider === 'none') {
          return new UnconfiguredSmsProvider();
        }

        throw new Error(`Unsupported SMS_PROVIDER: ${provider}`);
      },
    },
  ],
  exports: [OtpService],
})
export class OtpModule {}
