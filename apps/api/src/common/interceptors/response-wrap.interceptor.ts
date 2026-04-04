import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { randomUUID } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import { SKIP_WRAP } from '@api/common/decorators/skip-wrap.decorator';

@Injectable()
export class ResponseWrapInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    // 1. 检查是否有 @SkipWrap 装饰器
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_WRAP, [
      context.getHandler(),
      context.getClass(),
    ]);

    // 如果加了 @SkipWrap，直接跳过拦截器，原样返回
    if (skip) {
      return next.handle();
    }

    // 2. 获取或生成 trace id (tid)
    const req = context
      .switchToHttp()
      .getRequest<Request & { id?: string | number }>();
    const rawReqId = req?.id ?? req?.headers?.['x-request-id'];
    const reqId =
      typeof rawReqId === 'string' || typeof rawReqId === 'number'
        ? String(rawReqId)
        : undefined;

    const makeTid = () =>
      reqId ? String(reqId) : randomUUID().replace(/-/g, '');

    // 3. 处理返回数据
    return next.handle().pipe(
      map((data: unknown) => {
        // ==================================================
        //  核心修复区域 START
        // ==================================================

        // 情况 A: 如果是 NestJS 的流式文件 (StreamableFile)，直接返回，不要包 JSON
        if (data instanceof StreamableFile) {
          return data;
        }

        // 情况 B: 如果是原始 Buffer (二进制数据)，通常也是文件下载，直接返回
        if (Buffer.isBuffer(data)) {
          return data;
        }

        // ==================================================
        //  核心修复区域 END
        // ==================================================

        // 情况 C: 如果数据已经是被包装过的对象 (防止双重包装)
        // (例如某些特殊逻辑手动返回了 standard response)
        if (
          data !== null &&
          typeof data === 'object' &&
          'code' in data &&
          'data' in data
        ) {
          return data;
        }

        // 默认情况: 包装成标准 JSON 格式
        return {
          code: 10000,
          message: 'success',
          tid: makeTid(),
          data: data ?? null, // 如果 data 是 undefined，给个 null 比较规范
        };
      }),
    );
  }
}
