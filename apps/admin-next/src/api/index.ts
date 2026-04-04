/**
 * API 接口定义示例
 * 使用方法：根据后端接口定义具体的 API 方法
 */

import http from './http';
import type { PaginatedResponse, PaginationParams } from './types';
import type { RequestConfig } from './types';
import {
  Product,
  Category,
  User,
  TreasureGroup,
  LoginResponse,
  AdminUser,
  AdminCreateUser,
  AdminUpdateUser,
  CreateProduct,
  actSectionWithProducts,
  actSectionBindProducts,
  createActSectionPayload,
  Banner,
  BannerListParams,
  CreateBannerPayload,
  OrderListParams,
  Order,
  Coupon,
  CreateCouponPayload,
  CouponListParams,
  TransactionsListParams,
  WalletTransaction,
  WithdrawListParams,
  ManualAdjustPayload,
  AuditWithdrawPayload,
  WithdrawOrder,
  RechargeOrder,
  RechargeListParams,
  FinanceStatistics,
  QueryListAddressParams,
  AddressResponse,
  UpdateAddress,
  Province,
  City,
  Barangay,
  KycRecordListParams,
  AuditKycParams,
  ProductListParams,
  QueryClientUserParams,
  ClientUserListItem,
  ClientUserDevice,
  ClientUserDetail,
  BanDeviceParams,
  UpdateUserStatusParams,
  PaymentChannelListParams,
  PaymentChannel,
  CreatePaymentChannelPayload,
  AdminCreateKycParams,
  AdminUpdateKycParams,
  LuckyDrawActivity,
  LuckyDrawPrize,
  LuckyDrawResult,
  CreateLuckyDrawActivityPayload,
  UpdateLuckyDrawActivityPayload,
  CreateLuckyDrawPrizePayload,
  UpdateLuckyDrawPrizePayload,
  QueryLuckyDrawResultsParams,
} from '@/type/types';

/**
 * 用户相关 API
 */
export const userApi = {
  // 获取用户列表
  getUsers: (params?: PaginationParams) =>
    http.get<PaginatedResponse<AdminUser>>('/v1/admin/user/list', params),

  // 获取用户详情
  getUserById: (id: string) => http.get<User>(`/v1/admin/user/${id}`),

  // 创建用户
  createUser: (data: AdminCreateUser) =>
    http.post<User>('/v1/admin/user/create', data),

  // 更新用户
  updateUser: (id: string, data: Partial<AdminUpdateUser>) =>
    http.patch<AdminUser>(`/v1/admin/user/${id}`, data),

  // 删除用户
  deleteUser: (id: string) => http.delete(`/v1/admin/user/${id}`),
};

/**
 * 客户端用户相关 API
 */
export const clientUserApi = {
  // 获取用户列表
  getUsers: (params?: QueryClientUserParams) =>
    http.get<PaginatedResponse<ClientUserListItem>>(
      '/v1/admin/client-user/list',
      params,
    ),

  // 获取用户设备列表
  getDevices: (userId: string) =>
    http.get<PaginatedResponse<ClientUserDevice>>(
      `/v1/admin/client-user/${userId}/devices`,
    ),

  // 获取用户详情
  getUserById: (id: string) =>
    http.get<ClientUserDetail>(`/v1/admin/client-user/${id}`),

  // 封禁设备
  banDevice: (data: BanDeviceParams) =>
    http.post<User>('/v1/admin/client-user/device/ban', data),

  // 更新用户
  updateUser: (id: string, data: Partial<UpdateUserStatusParams>) =>
    http.patch<AdminUser>(`/v1/admin/client-user/${id}/status`, data),

  // 解封设备
  unbanDevice: (id: string) =>
    http.delete(`/v1/admin/client-user/device/unban/${id}`),
};

/**
 * 商品相关 API
 */
export const productApi = {
  // 获取商品列表
  getProducts: (params?: ProductListParams) =>
    http.get<PaginatedResponse<Product>>('/v1/admin/treasure/list', params),

  // 获取商品详情
  getProductById: (id: string) => http.get<Product>(`/v1/admin/treasure/${id}`),

  // 创建商品
  createProduct: (data: CreateProduct) =>
    http.post<Product>('/v1/admin/treasure/create', data),

  // 更新商品
  updateProduct: (id: string, data: Partial<CreateProduct>) =>
    http.patch<Product>(`/v1/admin/treasure/${id}`, data),

  // 删除商品
  deleteProduct: (id: string) => http.delete(`v1/admin/treasure/${id}`),

  // 更新商品状态
  updateProductState: (id: string, state: number) =>
    http.patch<Product>(`/v1/admin/treasure/${id}/state`, { state }),

  // 更新商品排序
  updateProductOrder: (id: string, sortOrder: number) =>
    http.patch<Product>(`/products/${id}/order`, { sortOrder }),

  pureHomeCache: () => http.post('v1/admin/treasure/purge-home-cache'),
};

/**
 * banner API
 */
export const bannerApi = {
  // 获取 banner 列表
  getList: (params?: BannerListParams) =>
    http.get<PaginatedResponse<Banner>>('/v1/admin/banners/list', params),

  //获取 banner 详情
  getBannerById: (id: string) => http.get<Banner>(`/v1/admin/banners/${id}`),

  // 创建banner
  create: (data: CreateBannerPayload) =>
    http.post<Banner>('/v1/admin/banners/create', data),

  // 更新banner信息
  update: (id: string, data: Partial<CreateBannerPayload>) =>
    http.patch<Banner>(`/v1/admin/banners/${id}`, data),

  // 更新banner状态
  updateState: (id: string, state: number) =>
    http.patch<Banner>(`/v1/admin/banners/${id}/state`, { state }),

  // 删除banner
  delete: (id: string) => http.delete<Banner>(`/v1/admin/banners/${id}`),
};

/**
 * 订单相关 API
 */
export const orderApi = {
  // 获取订单列表
  getList: (params?: OrderListParams) =>
    http.get<PaginatedResponse<Order>>('/v1/admin/order/list', params),

  // 获取订单详情
  getOrderDetailById: (id: string) => http.get<Order>(`/v1/admin/order/${id}`),

  // 更新订单状态
  updateState: (id: string, state: number) =>
    http.patch<Order>(`/v1/admin/order/${id}/status`, {
      status: state,
    }),

  // 删除order
  delete: (id: string) => http.delete<Order>(`/v1/admin/order/${id}`),
};

/**
 * 分类相关 API
 */
export const categoryApi = {
  // 获取分类列表
  getCategories: () => http.get<Category[]>('/v1/admin/category/list'),

  // 获取分类详情
  getCategoryById: (id: string) => http.get<Category>(`/category/${id}`),

  // 创建分类
  createCategory: (data: Partial<Omit<Category, 'productCount'>>) =>
    http.post<Category>('/v1/admin/category/create', data),

  // 更新分类
  updateCategory: (id: string, data: Partial<Category>) =>
    http.patch<Category>(`/v1/admin/category/${id}`, data),

  // 删除分类
  deleteCategory: (id: string) => http.delete(`/v1/admin/category/${id}`),

  // 禁用，启用分类
  toggleCategoryStatus: (id: string) =>
    http.patch<Category>(`/v1/admin/category/${id}/state`),
};

/**
 * 拼团管理 API (Admin)
 */
export const groupApi = {
  // 获取拼团列表
  getList: (params?: import('@/type/types').AdminGroupListParams) =>
    http.get<PaginatedResponse<import('@/type/types').AdminGroupItem>>(
      '/v1/admin/groups/list',
      params,
    ),

  // 获取拼团详情
  getDetail: (groupId: string) =>
    http.get<import('@/type/types').AdminGroupDetail>(
      `/v1/admin/groups/${groupId}`,
    ),
};

/**
 * 夺宝组相关 API
 */
export const treasureApi = {
  // 获取夺宝组列表
  getTreasureGroups: (params?: PaginationParams) =>
    http.get<PaginatedResponse<TreasureGroup>>('/treasure-groups', params),

  // 获取夺宝组详情
  getTreasureGroupById: (id: string) =>
    http.get<TreasureGroup>(`/treasure-groups/${id}`),

  // 创建夺宝组
  createTreasureGroup: (data: Partial<TreasureGroup>) =>
    http.post<TreasureGroup>('/treasure-groups', data),

  // 更新夺宝组
  updateTreasureGroup: (id: string, data: Partial<TreasureGroup>) =>
    http.put<TreasureGroup>(`/treasure-groups/${id}`, data),

  // 删除夺宝组
  deleteTreasureGroup: (id: string) => http.delete(`/treasure-groups/${id}`),

  // 开始/暂停夺宝
  toggleTreasureStatus: (id: string) =>
    http.post(`/treasure-groups/${id}/toggle`),
};

/**
 * 活动专区管理列表页 API
 */
export const actSectionApi = {
  // 获取列表
  getList: (params: PaginationParams) => {
    console.log('Fetching act section list with params:', params);
    return http.get<PaginatedResponse<actSectionWithProducts>>(
      '/v1/admin/act-sections/list',
      params,
    );
  },

  // 获取详情
  getDetail: (id: string) => {
    return http.get<actSectionWithProducts>(`/v1/admin/act-sections/${id}`);
  },

  // 创建
  create: (data: createActSectionPayload) => {
    return http.post('/v1/admin/act-sections/create', data);
  },

  // 更新
  update: (id: string, data: Partial<createActSectionPayload>) => {
    return http.patch(`/v1/admin/act-sections/${id}`, data);
  },

  // 删除
  delete: (id: string) => {
    return http.delete(`/v1/admin/act-sections/${id}`);
  },

  // 绑定商品到活动区域
  bindProduct: (id: string, data: actSectionBindProducts) => {
    return http.post(`/v1/admin/act-sections/${id}/bind`, data);
  },

  // 解绑定商品
  unbindProduct: (id: string, treasureId: string) => {
    return http.delete(`/v1/admin/act-sections/${id}/unbind/${treasureId}`);
  },

  // 更新排序
  /* updateSortOrder: (data: UpdateSortOrderDto) => {
    return request.post('/admin/act-section/sort-order', data);
  },*/
};

/**
 * 支付渠道管理列表页 API
 */
export const paymentChannelApi = {
  // 获取列表
  getList: (params: PaymentChannelListParams) => {
    console.log('Fetching act section list with params:', params);
    return http.get<PaginatedResponse<PaymentChannel>>(
      '/v1/admin/payment/channels/list',
      params,
    );
  },

  // 创建
  create: (data: CreatePaymentChannelPayload) => {
    return http.post('/v1/admin/payment/channels/create', data);
  },

  // 更新
  update: (id: number, data: Partial<CreatePaymentChannelPayload>) => {
    return http.patch(`/v1/admin/payment/channels/${id}`, data);
  },

  // 删除
  delete: (id: number, status: number) => {
    return http.delete(`/v1/admin/payment/channels/${id}/${status}`);
  },
};

/**
 * 优惠券专区 管理列表页 API
 */
export const couponApi = {
  // 获取列表
  getList: (params: CouponListParams) => {
    return http.get<PaginatedResponse<Coupon>>(
      '/v1/admin/coupons/list',
      params,
    );
  },

  // 获取详情
  getDetail: (id: string) => {
    return http.get<Coupon>(`/v1/admin/coupons/${id}`);
  },

  // 创建
  create: (data: CreateCouponPayload) => {
    return http.post('/v1/admin/coupons/create', data);
  },

  // 更新
  update: (id: string, data: Partial<CreateCouponPayload>) => {
    return http.patch(`v1/admin/coupons/${id}`, data);
  },

  // 删除
  delete: (id: string) => {
    return http.delete(`/v1/admin/coupons/${id}`);
  },
};

/**
 * 财务专区 API
 */
export const financeApi = {
  // 获取交易记录列表
  getTransactions: (params: TransactionsListParams) => {
    return http.get<PaginatedResponse<WalletTransaction>>(
      '/v1/admin/finance/transactions',
      params,
    );
  },

  // 获取提现记录列表
  getWithdrawals: (params: WithdrawListParams) => {
    return http.get<PaginatedResponse<WithdrawOrder>>(
      `/v1/admin/finance/withdrawals`,
      params,
    );
  },

  // 提现审核
  withdrawalsAudit: (data: AuditWithdrawPayload) => {
    return http.post('/v1/admin/finance/withdrawals/audit', data);
  },

  // 余额调整
  adjust: (data: Partial<ManualAdjustPayload>) => {
    return http.post(`/v1/admin/finance/adjust`, data);
  },

  // 存款记录列表
  getDeposits: (params: RechargeListParams) => {
    return http.get<PaginatedResponse<RechargeOrder>>(
      '/v1/admin/finance/recharges',
      params,
    );
  },

  // 获取统计数据
  getStatistics: () => {
    return http.get<FinanceStatistics>('/v1/admin/finance/statistics');
  },

  // 同步充值状态
  syncRecharge: (id: string) => {
    return http.post(`/v1/admin/finance/recharge/sync/${id}`);
  },
};

/**
 * 地址管理 API
 */
export const addressApi = {
  // 获取地址列表
  list: (params: QueryListAddressParams) => {
    return http.get<PaginatedResponse<AddressResponse>>(
      '/v1/admin/address/list',
      params,
    );
  },

  // 获取地址详情
  getAddress: (id: string) => {
    return http.get<AddressResponse>(`/v1/admin/address/${id}`);
  },

  // 更新地址
  updateAddress: (id: string, data: UpdateAddress) => {
    return http.post<AddressResponse>(`/v1/admin/address/update/${id}`, data);
  },

  // 删除地址
  deleteAddress: (id: string) => {
    return http.delete(`/v1/admin/address/delete/${id}`);
  },
};

/**
 * region API
 */
export const regionApi = {
  // 获取省份列表
  provinces: () => {
    return http.get<Province[]>('/v1/admin/region/provinces');
  },

  // 获取城市列表
  cities: (provinceId: number) => {
    return http.get<City[]>(`/v1/admin/region/cities/${provinceId}`);
  },

  // 获取区/镇列表
  barangays: (cityId: number) => {
    return http.get<Barangay[]>(`/v1/admin/region/barangays/${cityId}`);
  },
};

/**
 * kyc API
 */
export const kycApi = {
  // ==================== 原有接口 ====================

  // 获取 KYC 列表
  getRecords: (params: KycRecordListParams) => {
    return http.get('/v1/admin/kyc/records', params);
  },

  // 获取详情
  getDetail: (id: string) => {
    return http.get(`/v1/admin/kyc/records/${id}`);
  },

  // 审核 (Pass / Reject)
  // 注意：这里 id 通常是 kycId
  audit: (id: string, data: AuditKycParams) => {
    return http.post(`/v1/admin/kyc/${id}/audit`, data);
  },

  // ==================== 新增接口 ====================

  /**
   * [增] 管理员手动创建 (直接通过)
   * 场景：线下审核、人工录入
   */
  create: (data: AdminCreateKycParams) => {
    return http.post('/v1/admin/kyc/create', data);
  },

  /**
   * [改] 修正 KYC 信息
   * @param userId 注意这里传的是 userId
   * @param data 修改的数据
   */
  updateInfo: (userId: string, data: AdminUpdateKycParams) => {
    return http.put(`/v1/admin/kyc/update/${userId}`, data);
  },

  /**
   * [撤] 撤销/作废认证 (变回 Rejected)
   * @param userId 目标用户ID
   * @param reason 撤销原因
   */
  revoke: (userId: string, reason: string) => {
    return http.post(`/v1/admin/kyc/revoke/${userId}`, { reason });
  },

  /**
   * [删] 物理删除记录 (重置为 Not Verified)
   * @param userId 目标用户ID
   */
  delete: (userId: string) => {
    return http.delete(`/v1/admin/kyc/delete/${userId}`);
  },
};

/**
 * 认证相关 API
 */
export const authApi = {
  // 登录
  // x-skip-auth-refresh: '1' 告知拦截器跳过 token refresh 逻辑
  // 避免登录失败（凭证错误）时被误当作 token 过期，走 refresh → handleUnauthorized → window.location.href = '/login'
  login: (data: { username: string; password: string }) =>
    http.post<LoginResponse>('/v1/auth/admin/login', data, {
      headers: { 'x-skip-auth-refresh': '1' },
    }),

  // 登出
  logout: () => http.post('/v1/auth/admin/logout'),

  // 设置 HTTP-only Cookie（登录成功后调用，由后端写 httpOnly cookie）
  setCookie: (token: string) =>
    http.post<{ ok: boolean }>(
      '/v1/auth/admin/set-cookie',
      { token },
      { withCredentials: true, headers: { 'x-skip-auth-refresh': '1' } },
    ),

  // 清除 HTTP-only Cookie（登出时调用）
  clearCookie: () =>
    http.post<{ ok: boolean }>(
      '/v1/auth/admin/clear-cookie',
      {},
      { withCredentials: true, headers: { 'x-skip-auth-refresh': '1' } },
    ),

  // 刷新 token
  refreshToken: (refreshToken: string) =>
    http.post<{ tokens: { accessToken: string; refreshToken: string } }>(
      '/v1/auth/admin/refresh',
      { refreshToken },
    ),

  // 修改密码
  changePassword: (data: { oldPassword: string; newPassword: string }) =>
    http.post('/auth/change-password', data),

  // 获取当前登录管理员信息（page refresh 后恢复 userInfo）
  getMe: () => http.get<AdminUser>('/v1/auth/admin/me'),
};

/**
 * 文件上传 API
 */
export const uploadApi = {
  // 上传文件
  uploadMedia: (file: File, onProgress?: (percent: number) => void) =>
    http.upload<{ url: string }>('/v1/admin/upload/image', file, onProgress),

  // 批量上传
  uploadMultiple: (files: File[]) => {
    const formData = new FormData();
    files.forEach((file, index) => {
      formData.append(`files[${index}]`, file);
    });
    return http.upload<{ urls: string[] }>('/upload/multiple', formData);
  },
};

/**
 * 数据分析统计 API
 */
export const statsApi = {
  /**
   * GET /v1/admin/stats/overview
   * 返回用户、订单、收入、财务汇总数据
   */
  getOverview: () =>
    http.get<import('@/type/types').StatsOverview>('/v1/admin/stats/overview'),

  /**
   * GET /v1/admin/stats/trend?days=30
   * 返回最近 N 天的订单量 + 用户注册趋势
   */
  getTrend: (days = 30) =>
    http.get<import('@/type/types').StatsTrend>('/v1/admin/stats/trend', {
      days,
    }),
};

/**
 * 操作日志审计 API
 */
export const adminOperationLogApi = {
  // 获取操作日志列表
  getList: (params: import('@/type/types').AdminOperationLogListParams) =>
    http.get<PaginatedResponse<import('@/type/types').AdminOperationLog>>(
      '/v1/admin/operation-logs/list',
      params,
    ),
};

/**
 * RBAC 角色权限 API
 */
export const rolesApi = {
  /**
   * GET /v1/admin/user/roles-summary
   * 返回所有角色的描述、权限列表、活跃用户人数
   */
  getSummary: () =>
    http.get<import('@/type/types').RoleSummaryItem[]>(
      '/v1/admin/user/roles-summary',
    ),
};

/**
 * 通知/推送管理 API
 */
export const notificationApi = {
  /** GET /v1/admin/notifications/logs — 推送历史（分页） */
  getLogs: (params: import('@/type/types').QueryPushLogParams) =>
    http.get<PaginatedResponse<import('@/type/types').AdminPushLog>>(
      '/v1/admin/notifications/logs',
      params,
    ),

  /** GET /v1/admin/notifications/devices/stats — 设备统计 */
  getDeviceStats: () =>
    http.get<import('@/type/types').DeviceStats>(
      '/v1/admin/notifications/devices/stats',
    ),

  /** POST /v1/admin/notifications/broadcast — 全员广播 */
  sendBroadcast: (data: import('@/type/types').SendBroadcastPayload) =>
    http.post<import('@/type/types').AdminPushLog>(
      '/v1/admin/notifications/broadcast',
      data,
    ),

  /** POST /v1/admin/notifications/targeted — 定向推送 */
  sendTargeted: (data: import('@/type/types').SendTargetedPayload) =>
    http.post<import('@/type/types').AdminPushLog>(
      '/v1/admin/notifications/targeted',
      data,
    ),
};

/**
 * 客服 / IM 聊天管理 API
 */
export const chatApi = {
  /** GET /v1/admin/chat/conversations — 会话列表 */
  getConversations: (
    params: import('@/type/types').QueryConversationsParams,
    config?: RequestConfig,
  ) =>
    http.get<PaginatedResponse<import('@/type/types').ChatConversation>>(
      '/v1/admin/chat/conversations',
      params,
      config,
    ),

  /** GET /v1/admin/chat/conversations/:id/messages — 消息历史 */
  getMessages: (
    conversationId: string,
    params: import('@/type/types').QueryMessagesParams,
    config?: RequestConfig,
  ) =>
    http.get<import('@/type/types').ChatMessagesResult>(
      `/v1/admin/chat/conversations/${conversationId}/messages`,
      params,
      config,
    ),

  /** POST /v1/admin/chat/conversations/:id/reply — 客服回复 */
  reply: (
    conversationId: string,
    data: import('@/type/types').AdminReplyPayload,
  ) =>
    http.post<import('@/type/types').ChatMessage>(
      `/v1/admin/chat/conversations/${conversationId}/reply`,
      data,
    ),

  /** POST /v1/admin/chat/messages/:id/force-recall — 强制撤回 */
  forceRecall: (messageId: string) =>
    http.post<{ success: boolean; messageId: string }>(
      `/v1/admin/chat/messages/${messageId}/force-recall`,
      {},
    ),

  /** PATCH /v1/admin/chat/conversations/:id/close — 关闭会话 */
  closeConversation: (
    conversationId: string,
    data: import('@/type/types').CloseConversationPayload,
  ) =>
    http.patch<{ success: boolean; conversationId: string }>(
      `/v1/admin/chat/conversations/${conversationId}/close`,
      data,
    ),

  /** POST /v1/admin/chat/upload-token — 获取媒体上传签名 URL */
  getUploadToken: (fileName: string, fileType: string) =>
    http.post<import('@/type/types').AdminUploadTokenResult>(
      '/v1/admin/chat/upload-token',
      { fileName, fileType },
    ),
};

/**
 * 客服渠道管理 API
 */
export const supportChannelApi = {
  getList: (params: import('@/type/types').QuerySupportChannelsParams) =>
    http.get<import('@/type/types').SupportChannelsResult>(
      '/v1/admin/support-channels',
      params,
    ),

  create: (data: import('@/type/types').CreateSupportChannelPayload) =>
    http.post<import('@/type/types').SupportChannelItem>(
      '/v1/admin/support-channels',
      data,
    ),

  update: (
    id: string,
    data: import('@/type/types').UpdateSupportChannelPayload,
  ) =>
    http.patch<import('@/type/types').SupportChannelItem>(
      `/v1/admin/support-channels/${id}`,
      data,
    ),

  toggle: (id: string, isActive: boolean) =>
    http.patch<import('@/type/types').SupportChannelItem>(
      `/v1/admin/support-channels/${id}/toggle`,
      { isActive },
    ),
};

/**
 * 广告管理 API
 */
export const adsApi = {
  getList: (params: import('@/type/types').QueryAdsParams) =>
    http.get<PaginatedResponse<import('@/type/types').Advertisement>>(
      '/v1/admin/ads',
      params,
    ),
  create: (data: import('@/type/types').CreateAdPayload) =>
    http.post<import('@/type/types').Advertisement>('/v1/admin/ads', data),
  update: (id: string, data: import('@/type/types').UpdateAdPayload) =>
    http.patch<import('@/type/types').Advertisement>(
      `/v1/admin/ads/${id}`,
      data,
    ),
  toggleStatus: (id: string) =>
    http.patch<import('@/type/types').Advertisement>(
      `/v1/admin/ads/${id}/toggle-status`,
      {},
    ),
  remove: (id: string) =>
    http.delete<{ success: boolean }>(`/v1/admin/ads/${id}`),
};

/**
 * 秒杀活动管理 API
 */
export const flashSaleApi = {
  getSessions: () =>
    http.get<{ list: import('@/type/types').FlashSaleSession[] }>(
      '/v1/admin/flash-sale/sessions',
    ),
  createSession: (data: import('@/type/types').CreateFlashSaleSessionPayload) =>
    http.post<import('@/type/types').FlashSaleSession>(
      '/v1/admin/flash-sale/sessions',
      data,
    ),
  updateSession: (
    id: string,
    data: import('@/type/types').UpdateFlashSaleSessionPayload,
  ) =>
    http.patch<import('@/type/types').FlashSaleSession>(
      `/v1/admin/flash-sale/sessions/${id}`,
      data,
    ),
  deleteSession: (id: string) =>
    http.delete<{ success: boolean }>(`/v1/admin/flash-sale/sessions/${id}`),
  getSessionProducts: (sessionId: string) =>
    http.get<{ list: import('@/type/types').FlashSaleProduct[] }>(
      `/v1/admin/flash-sale/sessions/${sessionId}/products`,
    ),
  bindProduct: (
    sessionId: string,
    data: import('@/type/types').BindFlashSaleProductPayload,
  ) =>
    http.post<import('@/type/types').FlashSaleProduct>(
      `/v1/admin/flash-sale/sessions/${sessionId}/products`,
      data,
    ),
  updateProduct: (
    productId: string,
    data: import('@/type/types').UpdateFlashSaleProductPayload,
  ) =>
    http.patch<import('@/type/types').FlashSaleProduct>(
      `/v1/admin/flash-sale/products/${productId}`,
      data,
    ),
  removeProduct: (productId: string) =>
    http.delete<{ success: boolean }>(
      `/v1/admin/flash-sale/products/${productId}`,
    ),
};

/**
 * 系统配置管理 API
 */
export const systemConfigApi = {
  getAll: () =>
    http.get<{ list: import('@/type/types').SystemConfigItem[] }>(
      '/v1/admin/system-config',
    ),
  create: (data: { key: string; value: string }) =>
    http.post<import('@/type/types').SystemConfigItem>(
      '/v1/admin/system-config',
      data,
    ),
  update: (key: string, value: string) =>
    http.patch<import('@/type/types').SystemConfigItem>(
      `/v1/admin/system-config/${key}`,
      { value },
    ),
  delete: (key: string) =>
    http.delete<{ success: boolean }>(`/v1/admin/system-config/${key}`),
};

/**
 * 用户登录日志 API
 */
export const loginLogApi = {
  getList: (params: import('@/type/types').QueryLoginLogParams) =>
    http.get<PaginatedResponse<import('@/type/types').UserLoginLog>>(
      '/v1/admin/login-logs/list',
      params,
    ),
};

/**
 * 管理员注册申请 API
 */
export const applicationApi = {
  /** 公开提交申请（无需 token） */
  submit: (data: import('@/type/types').CreateApplicationPayload) =>
    http.post<{ message: string; id: string }>('/v1/auth/admin/apply', data),

  /** 申请列表（SUPER_ADMIN）*/
  getList: (params: import('@/type/types').ApplicationListParams) =>
    http.get<PaginatedResponse<import('@/type/types').AdminApplication>>(
      '/v1/admin/applications',
      params,
    ),

  /** 待审批数量（侧边栏红点）*/
  pendingCount: () =>
    http.get<{ count: number }>(
      '/v1/admin/applications/pending-count',
      undefined,
      {
        trace: false,
        showError: false, // 轮询请求，403（非 SUPER_ADMIN）静默处理，不弹 toast
      },
    ),

  /** 审批通过 */
  approve: (id: string) =>
    http.patch<{ message: string }>(`/v1/admin/applications/${id}/approve`),

  /** 审批拒绝 */
  reject: (id: string, reviewNote?: string) =>
    http.patch<{ message: string }>(`/v1/admin/applications/${id}/reject`, {
      reviewNote,
    }),
};

/**
 * 福利抽奖管理 API
 */

type LuckyDrawPrizeResponse = Omit<
  LuckyDrawPrize,
  'probability' | 'prizeValue'
> & {
  probability: number | string;
  prizeValue: number | string | null;
};

type LuckyDrawActivityResponse = {
  id: string;
  createdAt: number | string;
  title: string;
  description: string | null;
  treasureId: string | null;
  treasureName?: string | null;
  status: number;
  startAt: number | string | null;
  endAt: number | string | null;
  prizes?: LuckyDrawPrizeResponse[];
  prizesCount?: number;
  ticketsCount?: number;
};

type LuckyDrawResultResponse = {
  id: string;
  createdAt: number | string;
  userId: string;
  userNickname: string | null;
  userAvatar: string | null;
  prizeId: string;
  prizeName: string;
  prizeType: number;
  activityId: string;
  activityTitle: string | null;
  orderId: string;
  couponName?: string | null;
  treasureName?: string | null;
  prizeSnapshot: unknown;
};

const toTimestamp = (
  value: number | string | null | undefined,
): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
};

const toLuckyDrawNumber = (
  value: number | string | null | undefined,
): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const normalizeLuckyDrawPrize = (
  prize: LuckyDrawPrizeResponse,
): LuckyDrawPrize => ({
  ...prize,
  probability: toLuckyDrawNumber(prize.probability) ?? 0,
  prizeValue: toLuckyDrawNumber(prize.prizeValue),
});

const normalizeLuckyDrawActivity = (
  activity: LuckyDrawActivityResponse,
): LuckyDrawActivity => ({
  id: activity.id,
  createdAt: toTimestamp(activity.createdAt) ?? Date.now(),
  title: activity.title,
  description: activity.description,
  treasureId: activity.treasureId,
  treasureName: activity.treasureName ?? null,
  status: activity.status,
  startAt: toTimestamp(activity.startAt),
  endAt: toTimestamp(activity.endAt),
  prizes: activity.prizes?.map(normalizeLuckyDrawPrize),
  prizesCount: activity.prizesCount ?? activity.prizes?.length ?? 0,
  ticketsCount: activity.ticketsCount ?? 0,
});

const normalizeLuckyDrawResult = (
  result: LuckyDrawResultResponse,
): LuckyDrawResult => ({
  ...result,
  createdAt: toTimestamp(result.createdAt) ?? Date.now(),
  prizeType: result.prizeType as LuckyDrawResult['prizeType'],
});

export const luckyDrawApi = {
  // ── 活动 ──────────────────────────────────────────────────────
  listActivities: async (params?: PaginationParams) => {
    const data = await http.get<{
      list: LuckyDrawActivityResponse[];
      total: number;
      page?: number;
      pageSize?: number;
    }>('/v1/admin/lucky-draw/activities', params);

    const page = params?.page ?? data.page ?? 1;
    const pageSize =
      (params?.pageSize ?? data.pageSize ?? data.list.length) || 20;

    return {
      list: data.list.map(normalizeLuckyDrawActivity),
      total: data.total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(data.total / Math.max(pageSize, 1))),
    };
  },

  getActivity: async (id: string) => {
    const data = await http.get<LuckyDrawActivityResponse>(
      `/v1/admin/lucky-draw/activities/${id}`,
    );

    return normalizeLuckyDrawActivity(data);
  },

  createActivity: (data: CreateLuckyDrawActivityPayload) =>
    http.post<{ id: string }>('/v1/admin/lucky-draw/activities', data),

  updateActivity: (id: string, data: UpdateLuckyDrawActivityPayload) =>
    http.patch<{ success: boolean }>(
      `/v1/admin/lucky-draw/activities/${id}`,
      data,
    ),

  deleteActivity: (id: string) =>
    http.delete<{ success: boolean }>(`/v1/admin/lucky-draw/activities/${id}`),

  // ── 奖品 ──────────────────────────────────────────────────────
  listPrizes: async (activityId: string) => {
    const data = await http.get<LuckyDrawPrizeResponse[]>(
      `/v1/admin/lucky-draw/activities/${activityId}/prizes`,
    );

    const list = data.map(normalizeLuckyDrawPrize);

    return {
      list,
      total: list.length,
      page: 1,
      pageSize: list.length || 1,
      totalPages: 1,
    };
  },

  createPrize: (data: CreateLuckyDrawPrizePayload) =>
    http.post<{ id: string }>('/v1/admin/lucky-draw/prizes', data),

  updatePrize: (id: string, data: UpdateLuckyDrawPrizePayload) =>
    http.patch<{ success: boolean }>(`/v1/admin/lucky-draw/prizes/${id}`, data),

  deletePrize: (id: string) =>
    http.delete<{ success: boolean }>(`/v1/admin/lucky-draw/prizes/${id}`),

  // ── 抽奖结果 ──────────────────────────────────────────────────
  listResults: async (params: QueryLuckyDrawResultsParams) => {
    if (!params.activityId) {
      return {
        list: [],
        total: 0,
        page: params.page ?? 1,
        pageSize: params.pageSize ?? 20,
        totalPages: 1,
      } as PaginatedResponse<LuckyDrawResult>;
    }

    const data = await http.get<{
      list: LuckyDrawResultResponse[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/v1/admin/lucky-draw/activities/${params.activityId}/results`, {
      page: params.page,
      pageSize: params.pageSize,
    });

    return {
      list: data.list.map(normalizeLuckyDrawResult),
      total: data.total,
      page: data.page,
      pageSize: data.pageSize,
      totalPages: Math.max(
        1,
        Math.ceil(data.total / Math.max(data.pageSize, 1)),
      ),
    };
  },
};
