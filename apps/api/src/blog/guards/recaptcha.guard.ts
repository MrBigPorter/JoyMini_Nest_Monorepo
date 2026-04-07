import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { RecaptchaService } from '@api/common/recaptcha/recaptcha.service';

/**
 * ReCaptcha v3 验证Guard
 * 复用系统现有Recaptcha服务
 */
@Injectable()
export class RecaptchaGuard implements CanActivate {
  constructor(private readonly recaptchaService: RecaptchaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // 从请求体中获取token
    const recaptchaToken = request.body?.recaptchaToken;

    const result = await this.recaptchaService.verifyToken(recaptchaToken);

    if (!result.success) {
      throw new HttpException(
        '人机验证失败，请刷新页面重试',
        HttpStatus.FORBIDDEN,
      );
    }

    // 将分值注入请求上下文
    (request as any).recaptchaScore = result.score;

    return true;
  }
}
