jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));
jest.mock('mime', () => ({
  getExtension: jest.fn(() => 'bin'),
  getType: jest.fn(() => 'application/octet-stream'),
}));

import { ChatService } from './chat.service';

describe('ChatService.addMemberToBusinessGroup · trafficSource', () => {
  it('新建 SUPPORT 会话时写入 aiMetadata.trafficSource=渠道 ID', async () => {
    const prisma: any = {
      supportChannel: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'simulation_support_v1',
          name: 'Simulation Support',
          isActive: true,
          botUser: { id: 'bot-1', nickname: 'Sim', avatar: null },
        }),
      },
      conversation: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'conv-1',
          members: [{ conversationId: 'conv-1', userId: 'u1' }],
        }),
      },
      $transaction: jest.fn(async (cb: (tx: any) => any) => cb(prisma)),
      conversation2: {},
    };
    const service = new ChatService(
      prisma,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.addMemberToBusinessGroup(
      'simulation_support_v1',
      'u1',
    );

    expect(prisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'SUPPORT',
          aiMetadata: { trafficSource: 'simulation_support_v1' },
        }),
      }),
    );
  });
});
