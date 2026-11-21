import { walletPromptConfig } from './wallet-prompt';
import { couponPromptConfig } from './coupon-prompt';
import { luckyPromptConfig } from './lucky-prompt';
import { userPromptConfig } from './user-prompt';

/** 把 AgentPromptConfig 展开成可做静态断言的纯文本。 */
function promptText(config: Record<string, any>): string {
  return JSON.stringify(config, null, 2);
}

describe('写操作 Prompt 口径', () => {
  const wallet = promptText(walletPromptConfig);

  it('wallet prompt 不再声称「唯一可写 Agent / 唯一需要 OTP」', () => {
    expect(wallet).not.toContain('唯一一个"能写操作"');
    expect(wallet).not.toContain('唯一一个需要 OTP');
    expect(wallet).not.toContain('Only write agent');
    expect(wallet).not.toContain('only write agent');
  });

  it('wallet prompt 不再把聊天提现一律推回 App', () => {
    expect(wallet).not.toContain('ONLY used through the App');
    expect(wallet).not.toContain('Do NOT call');
    expect(wallet).not.toContain('Withdrawals are completed in the App');
    expect(wallet).not.toContain('never execute a withdrawal from chat');
  });

  it('wallet prompt 允许卡片 + OTP 的聊天提现', () => {
    expect(wallet).toContain('confirmation card');
    expect(wallet).toContain('SMS OTP');
    expect(wallet).toContain('applyWithdraw');
    expect(wallet).toContain('payout channel account');
  });

  it('wallet prompt 禁止收集卡号 / CVV / 密码 / 证件号', () => {
    expect(wallet).toMatch(/NEVER (ask for|collect)[^.]*card number/i);
    expect(wallet).toContain('CVV');
    expect(wallet).toContain('password');
    expect(wallet).toContain('government ID');
  });

  it('其余写动作 Agent 的指引与目录一致（确认卡片是执行前提）', () => {
    expect(promptText(couponPromptConfig)).toContain('confirmation card');
    expect(promptText(luckyPromptConfig)).toContain('confirmation card');
    expect(promptText(userPromptConfig)).toContain('two-phase');
  });
});
