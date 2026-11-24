import { BadRequestException } from '@nestjs/common';
import { RejectRagContentGuard } from './reject-rag-content.guard';

function contextWithBody(body: unknown) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ body }),
    }),
  } as any;
}

describe('RejectRagContentGuard', () => {
  const guard = new RejectRagContentGuard();

  it('rejects PATCH bodies carrying content with an actionable message', () => {
    expect(() =>
      guard.canActivate(contextWithBody({ title: 't', content: '# new' })),
    ).toThrow(BadRequestException);

    try {
      guard.canActivate(contextWithBody({ content: '# new' }));
    } catch (error) {
      const message = (error as BadRequestException).message;
      expect(message).toContain('/v1/admin/rag/documents/:id/content');
    }
  });

  it('rejects content: null instead of treating it as absent', () => {
    expect(() => guard.canActivate(contextWithBody({ content: null }))).toThrow(
      BadRequestException,
    );
  });

  it('allows metadata-only bodies and requests without a body', () => {
    expect(guard.canActivate(contextWithBody({ title: 't' }))).toBe(true);
    expect(guard.canActivate(contextWithBody(undefined))).toBe(true);
  });
});
