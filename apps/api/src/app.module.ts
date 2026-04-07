import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as Joi from 'joi';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ThrottlerModule } from '@nestjs/throttler';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import { ClientModule } from '@api/client/client.module';
import { AdminModule } from '@api/admin/admin.module';
import { APP_GUARD } from '@nestjs/core';
import { OtpThrottlerGuard } from '@api/common/guards/otp-throttler.guard';
import { UploadModule } from '@api/common/upload/upload.module';
import { PaymentModule } from '@api/common/payment/payment.module';
import { ScheduleModule } from '@nestjs/schedule';
import { RedisLockModule } from '@api/common/redis/redis-lock.module';
import { PaymentChannelModule } from '@api/common/payment-channel/payment-channel.module';
import { BullModule } from '@nestjs/bullmq';
import { ChatModule } from '@api/common/chat/chat.module';
import { MediaModule } from '@api/common/media/media.module';
import { CallModule } from '@api/common/events/call/call.module';
import { EventsModule } from '@api/common/events/events.module';
import { EmailModule } from '@api/common/email/email.module';
import { RecaptchaModule } from '@api/common/recaptcha/recaptcha.module';
import { AiModule } from '@api/common/ai/ai.module';
import { BlogModule } from '@api/blog/blog.module';

// 根模块（第2步，挂子模块、配置、JWT等）
@Module({
  imports: [
    // 定时任务模块
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL'),
        },
        // 默认配置：防止 Redis 瞬间压力过大
        defaultJobOptions: {
          attempts: 3, // 默认重试3次
          backoff: { type: 'exponential', delay: 1000 }, // 指数补偿重试
          removeOnComplete: true, // 成功后清理
          removeOnFail: false, // 失败保留用于排查
        },
      }),
    }),
    // 1) 全局配置模块：环境变量校验
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        JWT_SECRET: Joi.string().required(),
        // Access Token 过期时间 (默认 15分钟)
        JWT_ACCESS_EXPIRATION: Joi.alternatives()
          .try(
            Joi.number().integer().positive(), // 支持纯数字(秒)
            Joi.string().pattern(/^\d+(ms|s|m|h|d|w|y)$/), // 支持 '15m' 格式
          )
          .default('15m'),

        // Refresh Token 过期时间 (默认 7天)
        JWT_REFRESH_EXPIRATION: Joi.alternatives()
          .try(
            Joi.number().integer().positive(),
            Joi.string().pattern(/^\d+(ms|s|m|h|d|w|y)$/),
          )
          .default('7d'),
        DATABASE_URL: Joi.string().required(),

        // Email service (Resend)
        RESEND_API_KEY: Joi.string().allow('').optional(),
        EMAIL_FROM: Joi.string().default(
          'JoyMini Admin <noreply@joyminis.com>',
        ),
        FRONTEND_URL: Joi.string().uri().optional(),

        // Email OTP fallback (no SMS budget)
        EMAIL_OTP_TTL_SECONDS: Joi.number().integer().positive().default(300),
        EMAIL_OTP_INTERVAL_SECONDS: Joi.number()
          .integer()
          .positive()
          .default(60),
        EMAIL_OTP_MAX_ATTEMPTS: Joi.number().integer().positive().default(5),
        EMAIL_OTP_DEV_CODE: Joi.string().min(4).max(20).optional(),

        CACHE_TTL: Joi.number().integer().positive().default(300),
        CACHE_PREFIX: Joi.string().default('lucky:'),
        REDIS_URL: Joi.string().required(),
        PORT: Joi.number().default(3000),
        // 其余变量也可顺手校验：PORT、CORS_ORIGIN、DATABASE_URL...
      }),
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
        convert: true,
      },
    }),

    // 2) 全局缓存：用 Redis 作为 store
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: async (cfg: ConfigService) => ({
        store: await redisStore({
          url: cfg.get<string>('REDIS_URL')!,
          keyPrefix: cfg.get<string>('CACHE_PREFIX')!,
          ttl: (cfg.get<number>('CACHE_TTL') ?? 300) * 1000, // 单位：秒
          socket: {
            // 温和重连，避免连接抖动崩溃
            reconnectStrategy: (retries) => Math.min(2000, 100 * (retries + 1)),
          },
        }),
      }),
    }),
    //全局默认 ttl: 60,     // 60s 窗口
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),
    //根模块，把业务模块“挂进来”。Nest 会读这些元数据，生成依赖图。
    RedisLockModule,
    PrismaModule,
    UploadModule,
    ClientModule,
    AdminModule,
    PaymentModule,
    PaymentChannelModule,
    ChatModule,
    MediaModule,
    CallModule,
    EventsModule,
    EmailModule,
    RecaptchaModule,
    BlogModule,

    // 其他模块：PrismaModule、ThrottlerModule、UsersModule、AuthModule 等
  ],

  controllers: [AppController],
  providers: [
    AppService,
    //让限流生效：把 ThrottlerGuard 设为全局守卫，否则 @Throttle 不会拦截。
    { provide: APP_GUARD, useClass: OtpThrottlerGuard },
  ],
})
export class AppModule {}
