import { UnauthorizedException } from '@nestjs/common';
import { MetricsController } from './metrics.controller';

describe('MetricsController', () => {
  const makeRes = () => {
    const res = {
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    return res;
  };

  afterEach(() => {
    delete process.env.METRICS_TOKEN;
  });

  it('返回 text/plain，绕过 JSON 包装', () => {
    const res = makeRes();
    new MetricsController().get(res as any);

    expect(res.type).toHaveBeenCalledWith(
      'text/plain; version=0.0.4; charset=utf-8',
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining('ai_chat_requests_total'),
    );
  });

  it('设置 METRICS_TOKEN 后要求 Bearer token', () => {
    process.env.METRICS_TOKEN = 'secret';
    const res = makeRes();

    expect(() =>
      new MetricsController().get(res as any, 'Bearer wrong'),
    ).toThrow(UnauthorizedException);
    expect(() =>
      new MetricsController().get(res as any, 'Bearer secret'),
    ).not.toThrow();
  });
});
