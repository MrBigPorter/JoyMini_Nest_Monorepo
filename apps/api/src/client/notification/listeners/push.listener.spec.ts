import { MessageCreatedEvent } from '@api/common/chat/events/chat.events';
import { PushListener } from './push.listener';

function makeListener() {
  const notification: any = {
    sendPrivateMessage: jest.fn().mockResolvedValue(undefined),
  };
  const listener = new PushListener(notification);
  jest
    .spyOn((listener as any).logger, 'debug')
    .mockImplementation(() => undefined);
  return { listener, notification };
}

function aiReplyEvent(pushMemberIds: string[] = ['u2']) {
  return new MessageCreatedEvent(
    'msg-ai',
    'conv-1',
    'Your order has shipped.',
    0,
    'ai-bot',
    'AI Assistant',
    '',
    Date.now(),
    ['u1', 'u2'],
    7,
    null,
    'SUPPORT',
    undefined,
    pushMemberIds,
    true,
  );
}

describe('PushListener · AI 回复离线推送', () => {
  it('AI 消息命中 pushMemberIds，并且不会推给发送者自己', async () => {
    const { listener, notification } = makeListener();

    await listener.handleFcmPush(aiReplyEvent());

    expect(notification.sendPrivateMessage).toHaveBeenCalledTimes(1);
    expect(notification.sendPrivateMessage).toHaveBeenCalledWith(
      'u2',
      'AI Assistant',
      'Your order has shipped.',
      expect.objectContaining({ type: 'chat', id: 'conv-1' }),
    );
  });

  it('pushMemberIds 为空（全员免打扰/大群熔断）→ 不推送', async () => {
    const { listener, notification } = makeListener();

    await listener.handleFcmPush(aiReplyEvent([]));

    expect(notification.sendPrivateMessage).not.toHaveBeenCalled();
  });
});
