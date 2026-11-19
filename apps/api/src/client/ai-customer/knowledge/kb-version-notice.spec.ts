import {
  buildKbVersionNotice,
  kbUserEpochKey,
  takeKbVersionNotice,
} from './kb-version-notice';

/**
 * Task 8：同一个人跨版本续话时要被告知。
 *
 * 上一轮回答用的是旧版政策，下一轮检索到新版——模型看到的上下文里
 * 还带着自己说的旧数字，容易自我一致地继续说旧的。显式告知能打断这个惯性。
 */
describe('buildKbVersionNotice（Task 8）', () => {
  it('版本变了：返回告知语（对用户不暴露内部时间戳）', () => {
    const notice = buildKbVersionNotice('1000', '2000');

    expect(notice).toContain('知识库内容已更新');
    expect(notice).toContain('以最新内容为准');
    expect(notice).not.toContain('1000');
    expect(notice).not.toContain('2000');
  });

  it('版本没变：不打扰用户', () => {
    expect(buildKbVersionNotice('2000', '2000')).toBeNull();
  });

  it('第一次对话（没有历史记录）：不告知', () => {
    expect(buildKbVersionNotice(null, '2000')).toBeNull();
    expect(buildKbVersionNotice('', '2000')).toBeNull();
  });

  it('当前版本读不到（Redis 故障）：不告知，也不能报错', () => {
    expect(buildKbVersionNotice('1000', null)).toBeNull();
  });

  it('用户维度的 key 稳定且带前缀', () => {
    expect(kbUserEpochKey('u1')).toBe('kb:user:u1:epoch');
  });
});

describe('takeKbVersionNotice（Task 8 接线）', () => {
  const makeRedis = (store: Record<string, string>) => ({
    get: jest.fn(async (k: string) => store[k] ?? null),
    set: jest.fn(async () => 'OK'),
  });

  it('首次对话：不告知，但记录当前纪元', async () => {
    const redis = makeRedis({ 'kb:version:epoch': '2000' });

    const notice = await takeKbVersionNotice(redis as any, 'u1');

    expect(notice).toBeNull();
    expect(redis.set).toHaveBeenCalledWith(
      'kb:user:u1:epoch',
      '2000',
      expect.any(Number),
    );
  });

  it('版本变过：返回告知语并更新纪元', async () => {
    const redis = makeRedis({
      'kb:version:epoch': '2000',
      'kb:user:u1:epoch': '1000',
    });

    const notice = await takeKbVersionNotice(redis as any, 'u1');

    expect(notice).toContain('知识库内容已更新');
    expect(redis.set).toHaveBeenCalledWith(
      'kb:user:u1:epoch',
      '2000',
      expect.any(Number),
    );
  });

  it('Redis 故障：返回 null，不影响回答', async () => {
    const redis = {
      get: jest.fn().mockRejectedValue(new Error('redis down')),
      set: jest.fn(),
    };

    await expect(takeKbVersionNotice(redis as any, 'u1')).resolves.toBeNull();
  });
});
