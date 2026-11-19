import { createUserTools } from './user-tools';
import { runWithContext } from '@api/common/logger/trace-context';

/**
 * 锁住用户 / 地址工具的身份边界：
 *   - 模型传的 userId 一律忽略
 *   - 读/写地址都使用请求上下文身份
 *   - 无上下文时 fail-closed
 */
describe('user-tools 身份边界', () => {
  let authService: { profile: jest.Mock };
  let addressService: {
    list: jest.Mock;
    detail: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    resolveGeoIds: jest.Mock;
  };
  let tools: ReturnType<typeof createUserTools>;

  const getTool = (name: string) => {
    const found = tools.find((t) => t.tool.name === name);
    if (!found) throw new Error(`tool ${name} not found`);
    return found.tool;
  };

  beforeEach(() => {
    authService = {
      profile: jest.fn().mockResolvedValue({ nickname: 'A' }),
    };
    addressService = {
      list: jest.fn().mockResolvedValue({
        list: [],
        total: 0,
        page: 1,
        pageSize: 10,
      }),
      detail: jest.fn().mockResolvedValue({ addressId: 'addr-1' }),
      create: jest.fn().mockResolvedValue({ addressId: 'addr-1' }),
      update: jest.fn().mockResolvedValue({ addressId: 'addr-1' }),
      delete: jest.fn().mockResolvedValue(undefined),
      resolveGeoIds: jest.fn().mockResolvedValue({
        provinceId: 1,
        cityId: 2,
        barangayId: 3,
      }),
    };
    tools = createUserTools(authService as any, addressService as any);
  });

  it('个人资料使用请求上下文身份，忽略模型伪造的 userId', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('getUserProfile').invoke({ userId: 'user-B' } as any),
    );

    expect(authService.profile).toHaveBeenCalledWith('user-A');
  });

  it('地址列表与详情使用请求上下文身份', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('listAddresses').invoke({
        page: 1,
        pageSize: 10,
        userId: 'user-B',
      } as any),
    );
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('getAddressDetail').invoke({
        addressId: 'addr-1',
        userId: 'user-B',
      } as any),
    );

    expect(addressService.list).toHaveBeenCalledWith('user-A', {
      page: 1,
      pageSize: 10,
    });
    expect(addressService.detail).toHaveBeenCalledWith('user-A', 'addr-1');
  });

  it('新增地址使用请求上下文身份，忽略模型伪造的 userId', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('createAddress').invoke({
        contactName: 'A',
        phone: '0917',
        province: 'Metro Manila',
        city: 'Makati',
        barangay: 'Bel-Air',
        fullAddress: 'Street 1',
        userId: 'user-B',
      } as any),
    );

    expect(addressService.create).toHaveBeenCalledWith(
      'user-A',
      expect.objectContaining({
        contactName: 'A',
        provinceId: 1,
        cityId: 2,
        barangayId: 3,
      }),
    );
  });

  it('修改与删除地址使用请求上下文身份', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('updateAddress').invoke({
        addressId: 'addr-1',
        contactName: 'B',
        userId: 'user-B',
      } as any),
    );
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('deleteAddress').invoke({
        addressId: 'addr-1',
        userId: 'user-B',
      } as any),
    );

    expect(addressService.update).toHaveBeenCalledWith(
      'user-A',
      'addr-1',
      expect.objectContaining({ contactName: 'B' }),
    );
    expect(addressService.delete).toHaveBeenCalledWith('user-A', 'addr-1');
  });

  it('没有请求上下文时全部 fail-closed，且不调用业务服务', async () => {
    const results = await Promise.all([
      getTool('getUserProfile').invoke({} as any),
      getTool('listAddresses').invoke({} as any),
      getTool('getAddressDetail').invoke({ addressId: 'addr-1' } as any),
      getTool('createAddress').invoke({
        contactName: 'A',
        phone: '0917',
        province: 'P',
        city: 'C',
        barangay: 'B',
        fullAddress: 'F',
      } as any),
      getTool('updateAddress').invoke({ addressId: 'addr-1' } as any),
      getTool('deleteAddress').invoke({ addressId: 'addr-1' } as any),
    ]);

    for (const raw of results) {
      expect(JSON.parse(raw as string)).toEqual({
        ok: false,
        error: 'Missing request user context',
      });
    }
    expect(authService.profile).not.toHaveBeenCalled();
    expect(addressService.list).not.toHaveBeenCalled();
    expect(addressService.detail).not.toHaveBeenCalled();
    expect(addressService.create).not.toHaveBeenCalled();
    expect(addressService.update).not.toHaveBeenCalled();
    expect(addressService.delete).not.toHaveBeenCalled();
    expect(addressService.resolveGeoIds).not.toHaveBeenCalled();
  });

  it('归属校验：地址不属于当前用户时结构化拒绝（2.6）', async () => {
    addressService.detail.mockRejectedValue(new Error('not found'));

    const result: any = await runWithContext({ userId: 'user-A' }, () =>
      getTool('updateAddress').invoke({ addressId: 'addr-of-user-B' } as any),
    );

    expect(JSON.parse(String(result)).error).toContain('FORBIDDEN');
    expect(addressService.update).not.toHaveBeenCalled();
  });
});
