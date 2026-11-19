import { createProductTools } from './product-tools';
import { runWithContext } from '@api/common/logger/trace-context';

/**
 * 商品工具的身份边界：
 *   - 公共查询（搜索/详情/状态/分类）不需要身份
 *   - 热门商品按请求上下文身份个性化
 *   - 模型传的 userId 一律忽略
 */
describe('product-tools 身份边界', () => {
  let treasureService: {
    list: jest.Mock;
    detail: jest.Mock;
    getStatus: jest.Mock;
    getHotGroups: jest.Mock;
  };
  let categoryService: { list: jest.Mock };
  let tools: ReturnType<typeof createProductTools>;

  const getTool = (name: string) => {
    const found = tools.find((t) => t.tool.name === name);
    if (!found) throw new Error(`tool ${name} not found`);
    return found.tool;
  };

  beforeEach(() => {
    treasureService = {
      list: jest.fn().mockResolvedValue({
        list: [],
        total: 0,
        page: 1,
        pageSize: 10,
      }),
      detail: jest.fn().mockResolvedValue({ id: 'product-1' }),
      getStatus: jest.fn().mockResolvedValue({ id: 'product-1' }),
      getHotGroups: jest.fn().mockResolvedValue([]),
    };
    categoryService = {
      list: jest.fn().mockResolvedValue([]),
    };
    tools = createProductTools(treasureService as any, categoryService as any);
  });

  it('公共查询在没有请求上下文时也能正常工作', async () => {
    await getTool('searchProducts').invoke({ q: 'bag' } as any);
    await getTool('getProductDetail').invoke({
      productId: 'product-1',
    } as any);
    await getTool('getProductStatus').invoke({
      productId: 'product-1',
    } as any);
    await getTool('getProductCategories').invoke({} as any);

    expect(treasureService.list).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'bag', page: 1, pageSize: 10 }),
    );
    expect(treasureService.detail).toHaveBeenCalledWith('product-1');
    expect(treasureService.getStatus).toHaveBeenCalledWith('product-1');
    expect(categoryService.list).toHaveBeenCalledWith({ state: 1 });
  });

  it('公共查询忽略模型多传的 userId', async () => {
    await getTool('searchProducts').invoke({
      q: 'bag',
      userId: 'user-B',
    } as any);

    expect(treasureService.list).toHaveBeenCalledWith(
      expect.not.objectContaining({ userId: expect.anything() }),
    );
  });

  it('热门商品使用请求上下文身份，忽略模型伪造的 userId', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('getHotProducts').invoke({
        limit: 10,
        userId: 'user-B',
      } as any),
    );

    expect(treasureService.getHotGroups).toHaveBeenCalledWith(10, 'user-A');
  });

  it('热门商品在没有请求上下文时 fail-closed', async () => {
    const raw = await getTool('getHotProducts').invoke({ limit: 10 } as any);

    expect(JSON.parse(raw as string)).toEqual({
      ok: false,
      error: 'Missing request user context',
    });
    expect(treasureService.getHotGroups).not.toHaveBeenCalled();
  });
});
