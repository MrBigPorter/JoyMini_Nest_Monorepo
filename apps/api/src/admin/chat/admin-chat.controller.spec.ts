// AdminChatService imports the upload service, which pulls an ESM-only uuid
// build that Jest cannot parse. The controller test only needs the class token.
jest.mock('./admin-chat.service', () => ({ AdminChatService: class {} }));

import { AdminChatController } from './admin-chat.controller';

function createController() {
  const service = {
    getConversations: jest.fn().mockResolvedValue({
      list: [
        {
          id: 'conv-1',
          lastMsgContent: '用户最后一条消息',
          lastMsgTime: 1,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    }),
    getMessages: jest.fn().mockResolvedValue({
      list: [
        {
          id: 'msg-1',
          content: '消息正文',
          meta: { extra: true },
          type: 'text',
        },
      ],
      nextCursor: 1,
    }),
  };
  const supportSlaService = {
    waitingQueue: jest.fn().mockResolvedValue({
      thresholdMinutes: 5,
      items: [
        {
          conversationId: 'conv-1',
          lastMessage: '等待中的最后一条',
          transferReason: 'ai_error',
        },
      ],
    }),
  };
  return {
    service,
    supportSlaService,
    controller: new AdminChatController(
      service as any,
      supportSlaService as any,
    ),
  };
}

describe('AdminChatController VIEWER 脱敏', () => {
  it('会话列表：VIEWER 不返回最后一条消息', async () => {
    const { controller } = createController();

    const result: any = await controller.getConversations(
      {} as any,
      'admin-1',
      'VIEWER',
    );

    expect(result.list[0].lastMsgContent).toBeNull();
    expect(result.list[0].id).toBe('conv-1');
  });

  it('会话列表：ADMIN 保留最后一条消息', async () => {
    const { controller } = createController();

    const result: any = await controller.getConversations(
      {} as any,
      'admin-1',
      'ADMIN',
    );

    expect(result.list[0].lastMsgContent).toBe('用户最后一条消息');
  });

  it('消息历史：VIEWER 不返回 content/meta', async () => {
    const { controller } = createController();

    const result: any = await controller.getMessages('conv-1', {} as any, 'VIEWER');

    expect(result.list[0]).toEqual({
      id: 'msg-1',
      content: null,
      meta: null,
      type: 'text',
    });
  });

  it('消息历史：ADMIN 保留原文', async () => {
    const { controller } = createController();

    const result: any = await controller.getMessages('conv-1', {} as any, 'ADMIN');

    expect(result.list[0].content).toBe('消息正文');
    expect(result.list[0].meta).toEqual({ extra: true });
  });

  it('SLA 队列：VIEWER 不返回最后消息，保留原因', async () => {
    const { controller } = createController();

    const result: any = await controller.getSlaQueue('VIEWER');

    expect(result.items[0]).toEqual({
      conversationId: 'conv-1',
      lastMessage: null,
      transferReason: 'ai_error',
    });
  });

  it('SLA 队列：ADMIN 保留最后消息', async () => {
    const { controller } = createController();

    const result: any = await controller.getSlaQueue('ADMIN');

    expect(result.items[0].lastMessage).toBe('等待中的最后一条');
  });
});
