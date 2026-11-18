import { createWalletTools } from './wallet-tools';
import { runWithContext } from '@api/common/logger/trace-context';
import { CODE_TYPE, KYC_STATUS } from '@lucky/shared';
import { ApplyWithdrawDto } from '@api/client/wallet/dto/apply-withdraw.dto';

/**
 * 锁住钱包工具的身份边界：
 *   - 查询 / 提现一律使用请求上下文身份，忽略模型传的 userId
 *   - OTP 工具在无上下文时 fail-closed
 *   - 公共渠道配置不依赖身份
 */
describe('wallet-tools 身份边界', () => {
  let walletService: { balance: jest.Mock };
  let clientWalletService: {
    getRechargeHistory: jest.Mock;
    getWithdrawalHistory: jest.Mock;
    applyWithdraw: jest.Mock;
  };
  let kycService: { getMyKyc: jest.Mock };
  let paymentChannelService: { getClientConfig: jest.Mock };
  let otpService: { request: jest.Mock; verify: jest.Mock };
  let tools: ReturnType<typeof createWalletTools>;

  const getTool = (name: string) => {
    const found = tools.find((t) => t.tool.name === name);
    if (!found) throw new Error(`tool ${name} not found`);
    return found.tool;
  };

  beforeEach(() => {
    walletService = {
      balance: jest.fn().mockResolvedValue({
        realBalance: '1000',
        coinBalance: '0',
        frozenBalance: '0',
        totalRecharge: '0',
        totalWithdraw: '0',
      }),
    };
    clientWalletService = {
      getRechargeHistory: jest.fn().mockResolvedValue({ list: [], total: 0 }),
      getWithdrawalHistory: jest.fn().mockResolvedValue({ list: [], total: 0 }),
      applyWithdraw: jest.fn().mockResolvedValue({
        withdrawId: 'w-1',
        withdrawNo: 'WD-1',
        withdrawAmount: '100',
        withdrawStatus: 3,
      }),
    };
    kycService = {
      getMyKyc: jest.fn().mockResolvedValue({
        kycStatus: KYC_STATUS.APPROVED,
      }),
    };
    paymentChannelService = {
      getClientConfig: jest.fn().mockResolvedValue([]),
    };
    otpService = {
      request: jest.fn().mockResolvedValue(undefined),
      verify: jest.fn().mockResolvedValue(true),
    };

    tools = createWalletTools(
      walletService as any,
      clientWalletService as any,
      kycService as any,
      paymentChannelService as any,
      otpService as any,
    );
  });

  it('余额查询使用请求上下文身份，忽略模型伪造的 userId', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('getWalletBalance').invoke({ userId: 'user-B' } as any),
    );

    expect(walletService.balance).toHaveBeenCalledWith('user-A');
  });

  it('交易记录使用请求上下文身份，忽略模型伪造的 userId', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('getWalletTransactions').invoke({
        type: 'recharge',
        userId: 'user-B',
      } as any),
    );

    expect(clientWalletService.getRechargeHistory).toHaveBeenCalledWith(
      'user-A',
      { page: 1, pageSize: 10 },
    );
  });

  it('KYC 查询使用请求上下文身份，忽略模型伪造的 userId', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('getKycStatus').invoke({ userId: 'user-B' } as any),
    );

    expect(kycService.getMyKyc).toHaveBeenCalledWith('user-A');
  });

  it('提现申请使用请求上下文身份，忽略模型伪造的 userId', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('applyWithdraw').invoke({
        amount: 100,
        channelId: 1,
        account: 'gcash-A',
        accountName: 'A',
        userId: 'user-B',
      } as any),
    );

    expect(kycService.getMyKyc).toHaveBeenCalledWith('user-A');
    expect(walletService.balance).toHaveBeenCalledWith('user-A');
    expect(clientWalletService.applyWithdraw).toHaveBeenCalledWith(
      'user-A',
      expect.any(ApplyWithdrawDto),
    );
  });

  it('OTP 工具使用请求上下文身份，但仍校验用户提交的 phone/code', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('requestWithdrawOtp').invoke({
        phone: '09170000000',
        userId: 'user-B',
      } as any),
    );
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('verifyWithdrawOtp').invoke({
        phone: '09170000000',
        code: '123456',
        userId: 'user-B',
      } as any),
    );

    expect(otpService.request).toHaveBeenCalledWith({
      phone: '09170000000',
      codeType: CODE_TYPE.WITHDRAW,
    });
    expect(otpService.verify).toHaveBeenCalledWith({
      phone: '09170000000',
      code: '123456',
      codeType: CODE_TYPE.WITHDRAW,
    });
  });

  it('公共提现渠道不依赖请求身份', async () => {
    await getTool('getPaymentChannels').invoke({ amount: 100 } as any);

    expect(paymentChannelService.getClientConfig).toHaveBeenCalledWith(2);
  });

  it('没有请求上下文时钱包/KYC/提现/OTP 工具都 fail-closed', async () => {
    const calls = [
      getTool('getWalletBalance').invoke({} as any),
      getTool('getWalletTransactions').invoke({ type: 'all' } as any),
      getTool('getKycStatus').invoke({} as any),
      getTool('requestWithdrawOtp').invoke({ phone: '0917' } as any),
      getTool('verifyWithdrawOtp').invoke({
        phone: '0917',
        code: '123456',
      } as any),
      getTool('applyWithdraw').invoke({
        amount: 100,
        channelId: 1,
        account: 'gcash-A',
        accountName: 'A',
      } as any),
    ];

    const results = await Promise.all(calls);
    for (const raw of results) {
      expect(JSON.parse(raw as string)).toEqual({
        ok: false,
        error: 'Missing request user context',
      });
    }
    expect(walletService.balance).not.toHaveBeenCalled();
    expect(kycService.getMyKyc).not.toHaveBeenCalled();
    expect(otpService.request).not.toHaveBeenCalled();
    expect(otpService.verify).not.toHaveBeenCalled();
    expect(clientWalletService.applyWithdraw).not.toHaveBeenCalled();
  });
});
