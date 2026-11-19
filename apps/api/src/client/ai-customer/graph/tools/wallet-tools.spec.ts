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
  let prisma: { user: { findUnique: jest.Mock } };
  let tools: ReturnType<typeof createWalletTools>;

  const BOUND_PHONE = '09171234567';

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
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ phone: BOUND_PHONE }),
      },
    };

    tools = createWalletTools(
      walletService as any,
      clientWalletService as any,
      kycService as any,
      paymentChannelService as any,
      otpService as any,
      prisma as any,
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

  it('OTP 目标号码来自服务端绑定号码，模型伪造的 phone 被忽略', async () => {
    const requestRaw = await runWithContext({ userId: 'user-A' }, () =>
      getTool('requestWithdrawOtp').invoke({
        phone: '09999999999',
        userId: 'user-B',
      } as any),
    );
    const verifyRaw = await runWithContext({ userId: 'user-A' }, () =>
      getTool('verifyWithdrawOtp').invoke({
        phone: '09999999999',
        code: '123456',
        userId: 'user-B',
      } as any),
    );

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-A' },
      select: { phone: true },
    });
    expect(otpService.request).toHaveBeenCalledWith({
      phone: BOUND_PHONE,
      codeType: CODE_TYPE.WITHDRAW,
    });
    expect(otpService.verify).toHaveBeenCalledWith({
      phone: BOUND_PHONE,
      code: '123456',
      codeType: CODE_TYPE.WITHDRAW,
    });

    // 响应只回显后 4 位，绝不回显完整号码
    for (const raw of [requestRaw, verifyRaw]) {
      expect(raw).not.toContain(BOUND_PHONE);
      expect(raw).toContain('4567');
    }
  });

  it('无绑定手机号时 OTP 工具 fail-closed', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const requestRes = JSON.parse(
      (await runWithContext({ userId: 'user-A' }, () =>
        getTool('requestWithdrawOtp').invoke({} as any),
      )) as string,
    );
    const verifyRes = JSON.parse(
      (await runWithContext({ userId: 'user-A' }, () =>
        getTool('verifyWithdrawOtp').invoke({ code: '123456' } as any),
      )) as string,
    );

    expect(requestRes.ok).toBe(false);
    expect(verifyRes.ok).toBe(false);
    expect(otpService.request).not.toHaveBeenCalled();
    expect(otpService.verify).not.toHaveBeenCalled();
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
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(otpService.request).not.toHaveBeenCalled();
    expect(otpService.verify).not.toHaveBeenCalled();
    expect(clientWalletService.applyWithdraw).not.toHaveBeenCalled();
  });
});
