import { ForbiddenException } from '@nestjs/common';
import { AiFeedbackController } from './ai-feedback.controller';

function createController() {
  const service = {
    recordExplicit: jest.fn().mockResolvedValue({ id: 'fb-1' }),
    list: jest.fn().mockResolvedValue({
      list: [{ id: 'fb-1', input: '用户问题', answer: 'AI 回答' }],
      total: 1,
    }),
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

  it('默认关闭：列表仍可读取，只关闭写入', async () => {
    delete process.env.AI_FEEDBACK_UI_ENABLED;
    const { controller, service } = createController();

    await controller.list({} as any, null);
    expect(service.list).toHaveBeenCalledWith({});
  });

  it('VIEWER 读取时原始问答置空', async () => {
    const { controller } = createController();

    const result: any = await controller.list({} as any, 'VIEWER');

    expect(result.list[0]).toEqual({
      id: 'fb-1',
      input: null,
      answer: null,
    });
  });

  it('ADMIN 读取时保留原始问答', async () => {
    const { controller } = createController();

    const result: any = await controller.list({} as any, 'ADMIN');

    expect(result.list[0]).toEqual({
      id: 'fb-1',
      input: '用户问题',
      answer: 'AI 回答',
    });
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
