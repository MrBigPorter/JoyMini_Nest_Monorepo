import { Test, TestingModule } from '@nestjs/testing';
import { OperationLogService } from './operation-log.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { QueryOperationLogDto } from './dto/query-operation-log.dto';
import { TimeHelper } from '@lucky/shared';

describe('OperationLogService', () => {
  let service: OperationLogService;

  const mockPrismaService = {
    adminOperationLog: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OperationLogService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<OperationLogService>(OperationLogService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getList', () => {
    it('should return paginated operation logs with default params', async () => {
      const mockLogs = [
        {
          id: '1',
          adminId: 'admin-1',
          adminName: 'testadmin',
          module: 'auth',
          action: 'LOGIN',
          details: 'Admin login',
          requestIp: '127.0.0.1',
          createdAt: new Date(),
          admin: {
            id: 'admin-1',
            username: 'testadmin',
            realName: 'Test Admin',
          },
        },
      ];

      mockPrismaService.adminOperationLog.findMany.mockResolvedValue(mockLogs);
      mockPrismaService.adminOperationLog.count.mockResolvedValue(1);

      const query: QueryOperationLogDto = { page: 1, pageSize: 10 };
      const result = await service.getList(query);

      expect(result).toEqual({
        list: mockLogs,
        total: 1,
        page: 1,
        pageSize: 10,
      });

      expect(mockPrismaService.adminOperationLog.findMany).toHaveBeenCalledWith(
        {
          where: {},
          skip: 0,
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            admin: {
              select: {
                id: true,
                username: true,
                realName: true,
              },
            },
          },
        },
      );
    });

    it('should filter by adminId', async () => {
      mockPrismaService.adminOperationLog.findMany.mockResolvedValue([]);
      mockPrismaService.adminOperationLog.count.mockResolvedValue(0);

      const query: QueryOperationLogDto = {
        page: 1,
        pageSize: 10,
        adminId: 'admin-123',
      };

      await service.getList(query);

      expect(mockPrismaService.adminOperationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { adminId: 'admin-123' },
        }),
      );
    });

    it('should filter by action', async () => {
      mockPrismaService.adminOperationLog.findMany.mockResolvedValue([]);
      mockPrismaService.adminOperationLog.count.mockResolvedValue(0);

      const query: QueryOperationLogDto = {
        page: 1,
        pageSize: 10,
        action: 'AUDIT',
      };

      await service.getList(query);

      expect(mockPrismaService.adminOperationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            action: { contains: 'audit', mode: 'insensitive' },
          },
        }),
      );
    });

    it('should ignore action filter when value is ALL', async () => {
      mockPrismaService.adminOperationLog.findMany.mockResolvedValue([]);
      mockPrismaService.adminOperationLog.count.mockResolvedValue(0);

      const query: QueryOperationLogDto = {
        page: 1,
        pageSize: 10,
        action: 'ALL',
      };

      await service.getList(query);

      expect(mockPrismaService.adminOperationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('should filter by keyword (adminName, details, module, action)', async () => {
      mockPrismaService.adminOperationLog.findMany.mockResolvedValue([]);
      mockPrismaService.adminOperationLog.count.mockResolvedValue(0);

      const query: QueryOperationLogDto = {
        page: 1,
        pageSize: 10,
        keyword: 'test',
      };

      await service.getList(query);

      expect(mockPrismaService.adminOperationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              {
                adminName: { contains: 'test', mode: 'insensitive' },
              },
              {
                details: { contains: 'test', mode: 'insensitive' },
              },
              {
                module: { contains: 'test', mode: 'insensitive' },
              },
              {
                action: { contains: 'test', mode: 'insensitive' },
              },
            ],
          },
        }),
      );
    });

    it('should filter by date range', async () => {
      mockPrismaService.adminOperationLog.findMany.mockResolvedValue([]);
      mockPrismaService.adminOperationLog.count.mockResolvedValue(0);

      const startDate = '2026-03-01';
      const endDate = '2026-03-16';

      await service.getList({
        page: 1,
        pageSize: 10,
        startDate,
        endDate,
      });

      expect(mockPrismaService.adminOperationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            createdAt: {
              gte: TimeHelper.getStartOfDay(startDate),
              lte: TimeHelper.getEndOfDay(endDate),
            },
          },
        }),
      );
    });

    it('should handle pagination correctly', async () => {
      mockPrismaService.adminOperationLog.findMany.mockResolvedValue([]);
      mockPrismaService.adminOperationLog.count.mockResolvedValue(0);

      await service.getList({ page: 3, pageSize: 20 });

      expect(mockPrismaService.adminOperationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 40, // (3 - 1) * 20
          take: 20,
        }),
      );
    });

    it('should combine multiple filters', async () => {
      mockPrismaService.adminOperationLog.findMany.mockResolvedValue([]);
      mockPrismaService.adminOperationLog.count.mockResolvedValue(0);

      const query: QueryOperationLogDto = {
        page: 1,
        pageSize: 10,
        adminId: 'admin-123',
        action: 'UPDATE',
        keyword: 'product',
        startDate: '2026-03-01',
        endDate: '2026-03-16',
      };

      await service.getList(query);

      expect(mockPrismaService.adminOperationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            adminId: 'admin-123',
            action: { contains: 'update', mode: 'insensitive' },
            OR: [
              {
                adminName: { contains: 'product', mode: 'insensitive' },
              },
              {
                details: { contains: 'product', mode: 'insensitive' },
              },
              {
                module: { contains: 'product', mode: 'insensitive' },
              },
              {
                action: { contains: 'product', mode: 'insensitive' },
              },
            ],
            createdAt: {
              gte: TimeHelper.getStartOfDay('2026-03-01'),
              lte: TimeHelper.getEndOfDay('2026-03-16'),
            },
          },
        }),
      );
    });
  });
});
