import { SocketListener } from './socket.listener';
import { EventsGateway } from '@api/common/events/events.gateway';
import { PrismaService } from '@api/common/prisma/prisma.service';
import {
  MessageCreatedEvent,
  SupportConversationStartedEvent,
} from '@api/common/chat/events/chat.events';
import { SocketEvents } from '@lucky/shared';

describe('SocketListener', () => {
  // 提取 mock 函数为独立变量，避免 @typescript-eslint/unbound-method
  const dispatchMock = jest.fn();
  const findManyMock = jest.fn();

  const eventsGateway = {
    dispatch: dispatchMock,
  } as unknown as EventsGateway;

  const prismaService = {
    adminUser: {
      findMany: findManyMock,
    },
  } as unknown as PrismaService;

  const listener = new SocketListener(eventsGateway, prismaService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('dispatches message to conversation room and member private rooms (except sender)', async () => {
    const memberIds = ['client_user_1', 'user_2', 'user_3'];

    const event = new MessageCreatedEvent(
      'msg_1',
      'conv_1',
      'hello',
      0,
      'client_user_1',
      'Client User',
      '',
      Date.now(),
      memberIds,
      1,
      null,
    );

    await listener.handleMessageCreated(event);

    expect(dispatchMock).toHaveBeenCalledWith(
      'conv_1',
      SocketEvents.CHAT_MESSAGE,
      expect.objectContaining({
        id: 'msg_1',
        conversationId: 'conv_1',
      }),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      'user_user_2',
      SocketEvents.CHAT_MESSAGE,
      expect.any(Object),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      'user_user_3',
      SocketEvents.CHAT_MESSAGE,
      expect.any(Object),
    );
  });

  it('skips member private-room fan-out when member count exceeds threshold', async () => {
    const largeMembers = Array.from({ length: 501 }, (_, i) => `u_${i + 1}`);
    largeMembers[0] = 'client_user_2';

    const event = new MessageCreatedEvent(
      'msg_2',
      'conv_2',
      'hello',
      0,
      'client_user_2',
      'Client User',
      '',
      Date.now(),
      largeMembers,
      2,
      null,
    );

    await listener.handleMessageCreated(event);

    expect(findManyMock).not.toHaveBeenCalled();
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      'conv_2',
      SocketEvents.CHAT_MESSAGE,
      expect.any(Object),
    );
  });

  it('dispatches support_new_conversation to all admin private rooms on SUPPORT_CONVERSATION_STARTED', async () => {
    findManyMock.mockResolvedValue([{ id: 'admin_1' }, { id: 'admin_2' }]);

    const event = new SupportConversationStartedEvent(
      'conv_support_1',
      'official_platform_support_v1',
      'client_user_99',
    );

    await listener.handleSupportConversationStarted(event);

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 1 }),
      }),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      'user_admin_1',
      'support_new_conversation',
      expect.objectContaining({
        conversationId: 'conv_support_1',
        businessId: 'official_platform_support_v1',
      }),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      'user_admin_2',
      'support_new_conversation',
      expect.objectContaining({ conversationId: 'conv_support_1' }),
    );
  });
});
