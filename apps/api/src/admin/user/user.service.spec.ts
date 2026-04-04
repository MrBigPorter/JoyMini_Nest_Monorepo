import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PasswordService } from '@api/common/service/password.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { Role } from '@lucky/shared';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;

  const mockPrisma = {
    adminUser: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockPasswordService = {
    hash: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PasswordService, useValue: mockPasswordService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('update()', () => {
    it('blocks updating self role/status', async () => {
      await expect(
        service.update('admin_1', { role: Role.SUPER_ADMIN }, 'admin_1'),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.adminUser.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.adminUser.update).not.toHaveBeenCalled();
    });

    it('blocks non-super-admin from assigning SUPER_ADMIN', async () => {
      mockPrisma.adminUser.findUnique.mockResolvedValue({ role: Role.ADMIN });

      await expect(
        service.update('target_1', { role: Role.SUPER_ADMIN }, 'operator_1'),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.adminUser.update).not.toHaveBeenCalled();
    });

    it('throws when operator does not exist', async () => {
      mockPrisma.adminUser.findUnique.mockResolvedValue(null);

      await expect(
        service.update(
          'target_1',
          { role: Role.SUPER_ADMIN },
          'missing_operator',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.adminUser.update).not.toHaveBeenCalled();
    });

    it('allows SUPER_ADMIN to assign SUPER_ADMIN', async () => {
      mockPrisma.adminUser.findUnique.mockResolvedValue({
        role: Role.SUPER_ADMIN,
      });
      mockPrisma.adminUser.update.mockResolvedValue({
        id: 'target_1',
        username: 'target',
        realName: 'Target User',
        role: Role.SUPER_ADMIN,
        status: 1,
      });

      const result = await service.update(
        'target_1',
        { role: Role.SUPER_ADMIN },
        'operator_1',
      );

      expect(mockPrisma.adminUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'target_1' },
          data: { role: Role.SUPER_ADMIN },
        }),
      );
      expect(result.role).toBe(Role.SUPER_ADMIN);
    });
  });
});
