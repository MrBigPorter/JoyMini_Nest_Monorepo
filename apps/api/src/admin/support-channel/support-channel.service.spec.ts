import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { SupportChannelService } from './support-channel.service';

const mockPrisma = {
  supportChannel: {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  user: {
    create: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('SupportChannelService', () => {
  let service: SupportChannelService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupportChannelService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SupportChannelService>(SupportChannelService);
  });

  afterEach(() => jest.clearAllMocks());

  it('lists channels with pagination payload', async () => {
    mockPrisma.supportChannel.count.mockResolvedValue(1);
    mockPrisma.supportChannel.findMany.mockResolvedValue([
      {
        id: 'official_platform_support_v1',
        name: 'Lucky Support',
        description: 'General',
        botUserId: 'bot_1',
        isActive: true,
        botUser: {
          id: 'bot_1',
          nickname: 'Lucky Support',
          avatar: null,
          isRobot: true,
        },
      },
    ]);

    const result = await service.list({ page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.list).toHaveLength(1);
    expect(mockPrisma.supportChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 20,
      }),
    );
  });

  it('creates channel and bot user in one transaction', async () => {
    mockPrisma.supportChannel.findUnique.mockResolvedValue(null);

    mockPrisma.$transaction.mockImplementation(
      (
        fn: (tx: {
          user: { create: jest.Mock };
          supportChannel: { create: jest.Mock };
        }) => unknown,
      ) => {
        const tx = {
          user: {
            create: jest.fn().mockResolvedValue({
              id: 'bot_1',
              nickname: 'Tech Support',
              avatar: 'https://img/1.png',
            }),
          },
          supportChannel: {
            create: jest.fn().mockResolvedValue({
              id: 'tech_support_v1',
              name: 'Tech Support',
              description: 'Technical',
              botUserId: 'bot_1',
              isActive: true,
              botUser: {
                id: 'bot_1',
                nickname: 'Tech Support',
                avatar: 'https://img/1.png',
                isRobot: true,
              },
            }),
          },
        };
        return fn(tx);
      },
    );

    const result = await service.create({
      id: 'tech_support_v1',
      name: 'Tech Support',
      description: 'Technical',
      avatar: 'https://img/1.png',
    });

    expect(result.id).toBe('tech_support_v1');
    expect(result.botUserId).toBe('bot_1');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('throws conflict when creating duplicated channel id', async () => {
    mockPrisma.supportChannel.findUnique.mockResolvedValue({
      id: 'official_platform_support_v1',
    });

    await expect(
      service.create({
        id: 'official_platform_support_v1',
        name: 'Lucky Support',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFound when toggling non-existing channel', async () => {
    mockPrisma.supportChannel.findUnique.mockResolvedValue(null);
    await expect(
      service.toggle('missing', { isActive: false }),
    ).rejects.toThrow(NotFoundException);
  });
});
