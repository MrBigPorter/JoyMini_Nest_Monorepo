import { AppController } from './app.controller';

describe('AppController.health', () => {
  const ORIGINAL = {
    APP_VERSION: process.env.APP_VERSION,
    GIT_SHA: process.env.GIT_SHA,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(ORIGINAL)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('返回部署注入的 commitSha', () => {
    process.env.APP_VERSION = 'abc123';
    delete process.env.GIT_SHA;
    const controller = new AppController({} as any);

    expect(controller.health()).toEqual({ ok: true, commitSha: 'abc123' });
  });

  it('部署变量缺失时回退 GIT_SHA', () => {
    delete process.env.APP_VERSION;
    process.env.GIT_SHA = 'def456';
    const controller = new AppController({} as any);

    expect(controller.health()).toEqual({ ok: true, commitSha: 'def456' });
  });

  it('都缺失时返回 unknown', () => {
    delete process.env.APP_VERSION;
    delete process.env.GIT_SHA;
    const controller = new AppController({} as any);

    expect(controller.health()).toEqual({ ok: true, commitSha: 'unknown' });
  });
});
