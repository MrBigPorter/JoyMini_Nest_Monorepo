import { ForbiddenException } from '@nestjs/common';
import { AiFeedbackController } from './ai-feedback.controller';

function createController() {
  const service = {
    recordExplicit: jest.fn().mockResolvedValue({ id: 'fb-1' }),
    list: jest.fn().mockResolvedValue({ list: [], total: 0 }),
  };
  return {
    service,
    controller: new AiFeedbackController(service as any),
  };
}

describe('AiFeedbackController 开关（5.3）', () => {
  const original = process.env.AI_FEEDBACK_UI_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.AI_FEEDBACK_UI_ENABLED;
    else process.env.AI_FEEDBACK_UI_ENABLED = original;
  });

  it('默认关闭：写接口拒绝且不落库', async () => {
    delete process.env.AI_FEEDBACK_UI_ENABLED;
    const { controller, service } = createController();

    await expect(
      controller.create(
        { conversationId: 'c1', verdict: 'correct' } as any,
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.recordExplicit).not.toHaveBeenCalled();
  });

  it('默认关闭：列表接口也拒绝', async () => {
    delete process.env.AI_FEEDBACK_UI_ENABLED;
    const { controller } = createController();

    await expect(controller.list({} as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('开关打开后正常写入', async () => {
    process.env.AI_FEEDBACK_UI_ENABLED = 'true';
    const { controller, service } = createController();

    await controller.create(
      {
        conversationId: 'c1',
        verdict: 'incorrect',
        errorType: 'outdated',
      } as any,
      'admin-1',
    );

    expect(service.recordExplicit).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c1', adminId: 'admin-1' }),
    );
  });
});
