import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ClientFlashSaleService } from './flash-sale.service';
import { PrismaService } from '@api/common/prisma/prisma.service';

describe('ClientFlashSaleService', () => {
  let service: ClientFlashSaleService;

  const mockPrisma = {
    flashSaleSession: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    flashSaleProduct: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientFlashSaleService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<ClientFlashSaleService>(ClientFlashSaleService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getActiveSessions', () => {
    it('returns active sessions ordered payload with timestamps and remainingMs', async () => {
      const now = new Date('2026-03-18T10:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);

      mockPrisma.flashSaleSession.findMany.mockResolvedValue([
        {
          id: 'session-1',
          title: 'Lunch Drop',
          startTime: new Date('2026-03-18T09:30:00.000Z'),
          endTime: new Date('2026-03-18T11:00:00.000Z'),
          status: 1,
          _count: { products: 3 },
        },
      ]);

      const result = await service.getActiveSessions();

      expect(mockPrisma.flashSaleSession.findMany).toHaveBeenCalledWith({
        where: {
          status: 1,
          startTime: { lte: now },
          endTime: { gte: now },
        },
        orderBy: [{ startTime: 'asc' }, { endTime: 'asc' }],
        include: {
          _count: {
            select: { products: true },
          },
        },
      });
      expect(result).toEqual({
        list: [
          {
            id: 'session-1',
            title: 'Lunch Drop',
            startTime: new Date('2026-03-18T09:30:00.000Z').getTime(),
            endTime: new Date('2026-03-18T11:00:00.000Z').getTime(),
            status: 1,
            productCount: 3,
            remainingMs: 3_600_000,
          },
        ],
      });

      jest.useRealTimers();
    });
  });

  describe('getSessionProducts', () => {
    it('throws when the session is missing or inactive', async () => {
      mockPrisma.flashSaleSession.findFirst.mockResolvedValue(null);

      await expect(service.getSessionProducts('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns mapped product list with sold-out state', async () => {
      const now = new Date('2026-03-18T10:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);

      mockPrisma.flashSaleSession.findFirst.mockResolvedValue({
        id: 'session-1',
        title: 'Lunch Drop',
        startTime: new Date('2026-03-18T09:00:00.000Z'),
        endTime: new Date('2026-03-18T12:00:00.000Z'),
        status: 1,
        _count: { products: 2 },
      });
      mockPrisma.flashSaleProduct.findMany.mockResolvedValue([
        {
          id: 'fsp-1',
          sessionId: 'session-1',
          treasureId: 'treasure-1',
          flashStock: 0,
          flashPrice: { toString: () => '88.00' },
          sortOrder: 1,
          treasure: {
            treasureId: 'treasure-1',
            treasureName: 'Gaming Mouse',
            productName: 'Wireless Gaming Mouse',
            treasureCoverImg: 'https://img.example.com/mouse-cover.jpg',
            unitAmount: { toString: () => '120.00' },
            marketAmount: { toString: () => '159.00' },
          },
        },
      ]);

      const result = await service.getSessionProducts('session-1');

      expect(result).toEqual({
        session: {
          id: 'session-1',
          title: 'Lunch Drop',
          startTime: new Date('2026-03-18T09:00:00.000Z').getTime(),
          endTime: new Date('2026-03-18T12:00:00.000Z').getTime(),
          status: 1,
          productCount: 2,
          remainingMs: 7_200_000,
        },
        list: [
          {
            id: 'fsp-1',
            sessionId: 'session-1',
            treasureId: 'treasure-1',
            flashStock: 0,
            flashPrice: '88.00',
            sortOrder: 1,
            isSoldOut: true,
            product: {
              treasureId: 'treasure-1',
              treasureName: 'Gaming Mouse',
              productName: 'Wireless Gaming Mouse',
              treasureCoverImg: 'https://img.example.com/mouse-cover.jpg',
              unitAmount: '120.00',
              marketAmount: '159.00',
            },
          },
        ],
      });

      jest.useRealTimers();
    });
  });

  describe('getProductDetail', () => {
    it('throws when the product is missing or inactive', async () => {
      mockPrisma.flashSaleProduct.findFirst.mockResolvedValue(null);

      await expect(service.getProductDetail('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns detail payload and normalizes mainImageList', async () => {
      const now = new Date('2026-03-18T10:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);

      mockPrisma.flashSaleProduct.findFirst.mockResolvedValue({
        id: 'fsp-9',
        sessionId: 'session-9',
        treasureId: 'treasure-9',
        flashStock: 6,
        flashPrice: { toString: () => '299.00' },
        sortOrder: 5,
        session: {
          id: 'session-9',
          title: 'Prime Time',
          startTime: new Date('2026-03-18T09:00:00.000Z'),
          endTime: new Date('2026-03-18T13:00:00.000Z'),
          status: 1,
          _count: { products: 4 },
        },
        treasure: {
          treasureId: 'treasure-9',
          treasureSeq: 'JM-999',
          treasureName: 'Compact Air Fryer',
          productName: '4L Touch Panel Air Fryer',
          treasureCoverImg: 'https://img.example.com/fryer-cover.jpg',
          mainImageList: [
            'https://img.example.com/fryer-1.jpg',
            '',
            'https://img.example.com/fryer-2.jpg',
          ],
          unitAmount: { toString: () => '399.00' },
          marketAmount: { toString: () => '499.00' },
          desc: '<p>Healthy cooking with less oil.</p>',
          ruleContent: '<p>Flash sale rules.</p>',
          shippingType: 1,
          groupSize: 3,
          state: 1,
          salesStartAt: new Date('2026-03-18T08:00:00.000Z'),
          salesEndAt: new Date('2026-03-19T08:00:00.000Z'),
        },
      });

      const result = await service.getProductDetail('fsp-9');

      expect(result).toEqual({
        id: 'fsp-9',
        sessionId: 'session-9',
        treasureId: 'treasure-9',
        flashStock: 6,
        flashPrice: '299.00',
        sortOrder: 5,
        isSoldOut: false,
        session: {
          id: 'session-9',
          title: 'Prime Time',
          startTime: new Date('2026-03-18T09:00:00.000Z').getTime(),
          endTime: new Date('2026-03-18T13:00:00.000Z').getTime(),
          status: 1,
          productCount: 4,
          remainingMs: 10_800_000,
        },
        product: {
          treasureId: 'treasure-9',
          treasureSeq: 'JM-999',
          treasureName: 'Compact Air Fryer',
          productName: '4L Touch Panel Air Fryer',
          treasureCoverImg: 'https://img.example.com/fryer-cover.jpg',
          mainImageList: [
            'https://img.example.com/fryer-1.jpg',
            'https://img.example.com/fryer-2.jpg',
          ],
          unitAmount: '399.00',
          marketAmount: '499.00',
          desc: '<p>Healthy cooking with less oil.</p>',
          ruleContent: '<p>Flash sale rules.</p>',
          shippingType: 1,
          groupSize: 3,
          state: 1,
          salesStartAt: new Date('2026-03-18T08:00:00.000Z').getTime(),
          salesEndAt: new Date('2026-03-19T08:00:00.000Z').getTime(),
        },
      });

      jest.useRealTimers();
    });
  });
});
