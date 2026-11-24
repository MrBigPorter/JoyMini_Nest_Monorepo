import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';

/**
 * 拦下 PATCH /admin/rag/documents/:id 里的正文。
 *
 * 为什么不用 DTO 白名单就够了？
 *   ValidationPipe 开了 forbidNonWhitelisted，字段被移除后确实会 400，
 *   但报错是通用的 "property content should not exist"，运营看不懂该走哪条路。
 *   Guard 在 Pipe 之前执行，可以返回可操作的提示，同时 DTO 保持收口。
 *
 * 判定用 hasOwnProperty 而不是 `content !== undefined`：
 *   显式传 `content: null` 同样是想改正文，不能因为值是 null 就放行。
 */
@Injectable()
export class RejectRagContentGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ body?: Record<string, unknown> }>();
    const body = request.body;

    if (body && Object.prototype.hasOwnProperty.call(body, 'content')) {
      throw new BadRequestException(
        '文档正文不能通过该接口修改；请使用上传接口，或 PATCH /v1/admin/rag/documents/:id/content',
      );
    }

    return true;
  }
}
