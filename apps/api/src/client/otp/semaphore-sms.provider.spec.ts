import { Logger } from '@nestjs/common';
import { SemaphoreSmsProvider } from './semaphore-sms.provider';

const makeProvider = () =>
  new SemaphoreSmsProvider({
    apiKey: 'test-key',
    senderName: 'JOYMINI',
    messageTemplate: 'Your code is {otp}',
  });

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

describe('SemaphoreSmsProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('发送成功：表单字段正确，返回 messageId/status', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse(200, [
          { message_id: 12345, status: 'Pending', recipient: '639171234567' },
        ]),
      );

    const result = await makeProvider().send('09171234567', '123456');

    expect(result).toEqual({
      provider: 'semaphore',
      messageId: '12345',
      status: 'Pending',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.semaphore.co/api/v4/otp');
    expect(init?.method).toBe('POST');
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('apikey')).toBe('test-key');
    expect(body.get('number')).toBe('639171234567');
    expect(body.get('code')).toBe('123456');
    expect(body.get('message')).toBe('Your code is 123456');
    expect(body.get('sendername')).toBe('JOYMINI');
  });

  it('401/403：认证失败', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(401, {}));
    await expect(makeProvider().send('09171234567', '123456')).rejects.toThrow(
      /authentication failed/,
    );
  });

  it('429：限流', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(429, {}));
    await expect(makeProvider().send('09171234567', '123456')).rejects.toThrow(
      /rate limited/,
    );
  });

  it('5xx：供应商不可用', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(503, {}));
    await expect(makeProvider().send('09171234567', '123456')).rejects.toThrow(
      /unavailable/,
    );
  });

  it('status=Failed：按失败处理', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, [{ message_id: 1, status: 'Failed' }]));
    await expect(makeProvider().send('09171234567', '123456')).rejects.toThrow(
      /could not deliver/,
    );
  });

  it('超时：按供应商不可用处理', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    jest.spyOn(global, 'fetch').mockRejectedValue(abort);
    await expect(makeProvider().send('09171234567', '123456')).rejects.toThrow(
      /unavailable/,
    );
  });

  it('非法手机号：不发请求', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(makeProvider().send('12345', '123456')).rejects.toThrow(
      /Invalid Philippines phone/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('日志不包含验证码与完整手机号', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, [{ message_id: 1, status: 'Pending' }]));

    await makeProvider().send('09171234567', '654321');

    const text = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(text).not.toContain('654321');
    expect(text).not.toContain('639171234567');
    expect(text).toContain('***4567');
  });
});
