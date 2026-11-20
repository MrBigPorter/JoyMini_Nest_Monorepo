import { Role } from '@lucky/shared';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AiEvalController } from './ai-eval.controller';

describe('AiEvalController 角色边界', () => {
  it('judge 不允许 VIEWER / EDITOR 调用', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      AiEvalController.prototype.judge,
    ) as Role[];

    expect(roles).toEqual(
      expect.arrayContaining([Role.SUPER_ADMIN, Role.ADMIN]),
    );
    expect(roles).not.toContain(Role.VIEWER);
    expect(roles).not.toContain(Role.EDITOR);
  });

  it('评测读取仍允许 VIEWER', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      AiEvalController.prototype.getRun,
    ) as Role[];

    expect(roles).toContain(Role.VIEWER);
  });
});
