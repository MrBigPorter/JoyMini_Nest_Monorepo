import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RecaptchaService {
  private readonly verifyUrl =
    'https://www.google.com/recaptcha/api/siteverify';
  private readonly secretKey: string;
  private readonly enabled: boolean;
  private readonly threshold: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.secretKey = this.configService.get<string>('RECAPTCHA_SECRET_KEY', '');
    this.enabled = this.configService.get<boolean>('RECAPTCHA_ENABLED', false);
    this.threshold = this.configService.get<number>('RECAPTCHA_THRESHOLD', 0.5);
  }

  /**
   * 验证ReCaptcha token
   * @param token 前端提交的验证token
   * @returns 验证结果 { success: boolean, score: number }
   */
  /**
   * @deprecated Use verifyToken instead
   */
  async verify(
    token: string,
    _action?: string,
  ): Promise<{ success: boolean; score: number }> {
    return this.verifyToken(token);
  }

  async verifyToken(
    token: string,
  ): Promise<{ success: boolean; score: number }> {
    if (!this.enabled) {
      // 开发环境关闭时直接通过
      return { success: true, score: 1.0 };
    }

    if (!token) {
      return { success: false, score: 0 };
    }

    try {
      const response = await this.httpService.axiosRef.post(
        this.verifyUrl,
        null,
        {
          params: {
            secret: this.secretKey,
            response: token,
          },
        },
      );

      const data = response.data;

      if (data.success && data.score >= this.threshold) {
        return { success: true, score: data.score };
      }

      return { success: false, score: data.score || 0 };
    } catch (error: any) {
      // Google服务不可用时降级放行
      console.error('ReCaptcha verify error:', error.message);
      return { success: true, score: 0.5 };
    }
  }

  /**
   * 是否需要人工审核
   * @param score 验证分值
   */
  needsReview(score: number): boolean {
    return score >= 0.3 && score < 0.5;
  }

  /**
   * 是否是机器人
   * @param score 验证分值
   */
  isBot(score: number): boolean {
    return score < 0.3;
  }
}
