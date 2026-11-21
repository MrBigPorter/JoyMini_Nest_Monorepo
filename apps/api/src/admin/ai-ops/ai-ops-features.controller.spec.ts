import { Reflector } from '@nestjs/core';

const env = process.env as Record<string, string | undefined>;
import { Role } from '@lucky/shared';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AiOpsFeaturesController } from './ai-ops-features.controller';

describe('AiOpsFeaturesController', () => {
  const originalFeedback = process.env.AI_FEEDBACK_UI_ENABLED;
  const originalEval = process.env.AI_EVAL_ENABLED;
  const originalNodeEnv = env.NODE_ENV;

  afterEach(() => {
    if (originalFeedback === undefined) delete process.env.AI_FEEDBACK_UI_ENABLED;
    else process.env.AI_FEEDBACK_UI_ENABLED = originalFeedback;
    if (originalEval === undefined) delete process.env.AI_EVAL_ENABLED;
    else process.env.AI_EVAL_ENABLED = originalEval;
    if (originalNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = originalNodeEnv;
  });

  it('返回反馈与评测开关', () => {
    process.env.AI_FEEDBACK_UI_ENABLED = 'true';
    process.env.AI_EVAL_ENABLED = 'false';
    env.NODE_ENV = 'production';
    const controller = new AiOpsFeaturesController();

    expect(controller.features()).toEqual({
      feedbackUiEnabled: true,
      evalEnabled: false,
    });
  });

  it('开发环境视为评测启用', () => {
    process.env.AI_FEEDBACK_UI_ENABLED = 'false';
    delete process.env.AI_EVAL_ENABLED;
    env.NODE_ENV = 'development';
    const controller = new AiOpsFeaturesController();

    expect(controller.features()).toEqual({
      feedbackUiEnabled: false,
      evalEnabled: true,
    });
  });

  it('所有管理端角色都能读取开关', () => {
    const roles = new Reflector().get(
      ROLES_KEY,
      AiOpsFeaturesController.prototype.features,
    ) as Role[];

    expect(roles).toEqual(
      expect.arrayContaining([
        Role.SUPER_ADMIN,
        Role.ADMIN,
        Role.EDITOR,
        Role.VIEWER,
      ]),
    );
  });
});
