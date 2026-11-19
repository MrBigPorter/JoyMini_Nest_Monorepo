import { createKycTools } from './kyc-tools';
import { runWithContext } from '@api/common/logger/trace-context';

/**
 * KYC 工具身份边界：
 *   - 状态查询使用请求上下文身份，忽略模型传的 userId
 *   - 证件类型是公共配置，不依赖身份
 */
describe('kyc-tools 身份边界', () => {
  let kycService: { getMyKyc: jest.Mock; getIdTypes: jest.Mock };
  let tools: ReturnType<typeof createKycTools>;

  const getTool = (name: string) => {
    const found = tools.find((t) => t.tool.name === name);
    if (!found) throw new Error(`tool ${name} not found`);
    return found.tool;
  };

  beforeEach(() => {
    kycService = {
      getMyKyc: jest.fn().mockResolvedValue({ kycStatus: 2 }),
      getIdTypes: jest.fn().mockResolvedValue([]),
    };
    tools = createKycTools(kycService as any);
  });

  it('KYC 状态查询使用请求上下文身份，忽略模型伪造的 userId', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('getKycDetail').invoke({ userId: 'user-B' } as any),
    );

    expect(kycService.getMyKyc).toHaveBeenCalledWith('user-A');
  });

  it('没有请求上下文时 KYC 状态查询 fail-closed', async () => {
    const raw = await getTool('getKycDetail').invoke({} as any);

    expect(JSON.parse(raw as string)).toEqual({
      ok: false,
      error: 'Missing request user context',
    });
    expect(kycService.getMyKyc).not.toHaveBeenCalled();
  });

  it('证件类型列表不依赖请求身份', async () => {
    await getTool('getIdTypes').invoke({} as any);

    expect(kycService.getIdTypes).toHaveBeenCalled();
  });
});
