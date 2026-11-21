import { policyFallback } from './policy-fallback';

describe('policyFallback', () => {
  it('KYC 时长给 SLA 和草稿下一步', () => {
    expect(policyFallback('重新认证要多久？')).toContain('1–3 个工作日');
    expect(policyFallback('审核需要多长时间')).toContain('草稿');
  });

  it('配送范围/时效给省级时效', () => {
    expect(policyFallback('能送到宿务吗？大概几天？')).toContain('5–8 个工作日');
    expect(policyFallback('配送要多久')).toContain('Metro Manila');
  });

  it('券过期说明无券则无过期时间', () => {
    expect(policyFallback('我的券什么时候过期？')).toContain('没有过期时间');
  });

  it('积分/闲聊/上下文兜底不转人工', () => {
    expect(policyFallback('还有多少可用积分？')).toContain('积分');
    expect(policyFallback('今天天气不错')).toContain('我在的');
    expect(policyFallback('上次那个呢')).toContain('没跟上');
  });

  it('余额失败给重试/App 路径', () => {
    expect(policyFallback('我的钱包余额是多少？')).toContain('余额查询暂时失败');
  });

  it('无关问题不兜底', () => {
    expect(policyFallback('帮我查订单')).toBeNull();
  });
});
