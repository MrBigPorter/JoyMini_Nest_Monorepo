import { BadRequestException } from '@nestjs/common';
import { AddressService } from './address.service';

/**
 * 锁住「删除地址」的错误边界：
 *   - 记录不存在 / 不属于当前用户 → 400 业务错误，不是 500；
 *   - where 必须同时带 userId，不能只按 addressId 删；
 *   - P2025 判定只认错误码（跨 Prisma runtime 的 instanceof 会失效）。
 */
describe('AddressService.delete', () => {
  let prisma: {
    $transaction: jest.Mock;
    userAddress: {
      deleteMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let region: { validateAndGetGeoInfo: jest.Mock };
  let service: AddressService;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (cb: (ctx: typeof prisma) => unknown) =>
        cb(prisma),
      ),
      userAddress: {
        deleteMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    region = {
      validateAndGetGeoInfo: jest.fn().mockResolvedValue({
        province: 'P',
        city: 'C',
        barangay: 'B',
        postalCode: '1000',
      }),
    };
    service = new AddressService(prisma as any, region as any);
  });

  it('删到记录时返回 true，where 带 userId 做归属过滤', async () => {
    prisma.userAddress.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.delete('user-A', 'addr-1')).resolves.toBe(true);
    expect(prisma.userAddress.deleteMany).toHaveBeenCalledWith({
      where: { addressId: 'addr-1', userId: 'user-A' },
    });
  });

  it('记录不存在或属于别人时抛 400，而不是把异常漏成 500', async () => {
    prisma.userAddress.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.delete('user-A', 'user-B-id')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('update 的 P2025 只按错误码识别（不依赖 instanceof）', async () => {
    // Prisma 真实抛出的实例与 import 的错误类可能来自不同 runtime，
    // 这里用一个普通对象模拟「码对、类不对」的情况。
    prisma.userAddress.update.mockRejectedValue({ code: 'P2025' });

    await expect(
      service.update('user-A', 'addr-1', {
        contactName: 'A',
        phone: '0917',
        provinceId: 1,
        cityId: 2,
        barangayId: 3,
        fullAddress: 'F',
      } as any),
    ).rejects.toThrow(BadRequestException);
  });
});
