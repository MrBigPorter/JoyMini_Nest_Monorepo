import { PaginationParams } from '@/api/types';
import {
  BalanceTypeValue,
  KycStatus,
  RelatedType,
  TransactionStatusValue,
  TransactionTypeValue,
  WithdrawStatus,
} from '@lucky/shared';

export type Language = 'en' | 'zh';
export type Theme = 'light' | 'dark';

export type UserRole = 'admin' | 'editor' | 'viewer';

export interface dateRange {
  from: string;
  to: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
}

export interface AdminUser {
  id: string;
  username: string;
  roleId: string;
  roleName: string;
  lastLoginAt: number;
  role: string;
  status: number;
  realName: string;
}

export type AdminCreateUser = Pick<AdminUser, 'username' | 'role'> & {
  realName?: AdminUser['realName'];
  password?: string;
};

export type AdminUpdateUser = Pick<AdminUser, 'role' | 'status'> & {
  password: string;
};

export type AdminUpdatePassword = { password: string };

export interface LoginResponse {
  tokens: Tokens;
  userInfo: AdminUser;
}

export interface User {
  id: string;
  nickname: string;
  avatar: string;
  phone: string;
  email?: string;
  vipLevel: number;
  realBalance: number;
  coinBalance: number;
  kycStatus: 0 | 1 | 2 | 4; // 0:None, 1:Pending, 2:Failed, 4:Verified
  kycImages?: { front: string; back: string; holding: string };
  joinDate: string;
  status: 'active' | 'banned';
  banReason?: string;
  inviterId?: string; // Who invited this user
}

// 1. 定义赠品配置的结构 (对应后端的 bonusConfig JSON)
export interface BonusConfig {
  bonusItemName: string;
  bonusItemImg?: string;
  winnerCount: number;
  allowRobot?: boolean;
}

// 2. 更新商品列表/详情返回类型
export interface Product {
  treasureId: string;
  treasureName: string;
  productName?: string; // 后端 DTO 里是可选的
  costAmount: number;
  unitAmount: number;

  marketAmount?: number; // 划线价/原价
  soloAmount?: number; // 单买价

  enableRobot?: boolean;
  robotDelay?: number;
  leaderBonusType?: number;

  // 库存相关
  seqShelvesQuantity: number;
  seqBuyQuantity: number;
  buyQuantityRate: number;

  treasureCoverImg: string;
  state: number;
  createdAt: number;
  updatedAt: number;
  desc: string;
  ruleContent?: string;

  categories: (Pick<Category, 'id' | 'name'> & {
    categoryId: number;
  })[];

  // --- [新增] 物流与拼团配置 (对应 TreasureResponseDto) ---
  shippingType?: number; // 1-实物 2-无需物流
  weight?: number; // 重量

  groupSize?: number; // 成团人数
  groupTimeLimit?: number; // 成团时效(秒)

  bonusConfig?: BonusConfig; // 赠品配置对象

  // --- [新增] 预售时间 ---
  salesStartAt?: number; // 时间戳
  salesEndAt?: number; // 时间戳
}

export type ProductListParams = PaginationParams & {
  treasureName?: string;
  categoryId?: number;
  filterType?: string;
};

// 3. 更新创建商品参数类型 (对应 CreateTreasureDto)
export interface CreateProduct {
  treasureName: string;
  costAmount: number;
  unitAmount: number;
  seqShelvesQuantity?: number;

  categoryIds: number[];
  treasureCoverImg: string;
  desc?: string;
  ruleContent?: string;

  // --- [新增] 必须加这些，否则前端表单的数据传不过去 ---
  shippingType?: number;
  weight?: number;
  marketAmount?: number;
  soloAmount?: number;
  enableRobot?: boolean;
  robotDelay?: number;
  leaderBonusType?: number;

  groupSize?: number;
  groupTimeLimit?: number;

  // 注意：后端接收的是 bonusConfig JSON 对象，而不是扁平的字段
  bonusConfig?: BonusConfig;

  // 时间传给后端通常是时间戳 (number) 或 ISO 字符串，看你后端 Transform
  // 根据之前的后端代码，我们没做特定转换，所以传 number (时间戳) 最稳
  salesStartAt?: number;
  salesEndAt?: number;
}
export interface ActSection {
  id: string; // "1"
  key: string; // "home_new_arrival"
  title: string; // "New Arrival"
  imgStyleType: number; // 1
  status: number; // 1
  sortOrder: number; // 0
  startAt: number; // 0 -> 时间戳（ms / s，看你的实现）
  endAt: number; // 0 -> 时间戳（ms / s）
  limit: number; // 10
}

export type createActSectionPayload = Omit<
  ActSection,
  'id' | 'sortOrder' | 'endAt' | 'startAt'
> & {
  startAt?: Date;
  endAt?: Date;
};

export interface ActSectionListParams extends PaginationParams {
  title?: string;
  key?: string;
  status?: number;
}

export interface actSectionWithProducts extends ActSection {
  items: Partial<Product>[];
  categories: Partial<Category>[];
}

export interface actSectionBindProducts {
  treasureIds: string[];
}

// 基础实体
export interface PaymentChannel {
  id: number;

  // 核心配置
  code: string; // "PH_GCASH", "PH_PAYMAYA"
  name: string; // "GCash"
  icon: string; // URL
  type: number; // 1=充值(Money In), 2=提现(Money Out)

  // 金额限制
  minAmount: number;
  maxAmount: number;

  // 充值专用：快捷金额卡片 (后端 JSON -> 前端 number[])
  fixedAmounts?: number[];

  // 提现专用：手续费
  feeFixed: number; // 固定手续费
  feeRate: number; // 费率 (0.02)

  // 控制开关
  isCustom: boolean; // 是否允许自定义输入
  sortOrder: number; // 排序
  status: number; // 1=启用 0=禁用 2=维护

  createdAt: number; // 时间戳
}

// 创建/更新参数
// Omit 掉系统自动生成的字段
export type CreatePaymentChannelPayload = Omit<
  PaymentChannel,
  'id' | 'createdAt'
> & {
  // 覆盖一下可选属性，表单提交时可能某些字段是可选的
  fixedAmounts?: number[];
};

// 列表查询参数
export interface PaymentChannelListParams extends PaginationParams {
  name?: string;
  type?: number; // 筛选充值或提现
  status?: number; // 筛选状态
}

// Banner 广告位
export interface Banner {
  /** 唯一 ID */
  id: string;

  /** 标题，如：Summer Sale */
  title: string;

  /** banner 图片地址 */
  bannerImgUrl: string;

  /** 文件类型：1 = 图片，2 = 视频（具体按你后端约定） */
  fileType: number;

  /** Banner 分类：比如 首页、活动页等（枚举值） */
  bannerCate: number;

  /** 跳转类型：1 = H5 链接，2 = 原生页 等 */
  jumpCate: number;

  /** 跳转链接或路由 */
  jumpUrl: string;

  /** 排序值，越小越靠前 */
  sortOrder: number;

  /** 状态：1 = 启用，0 = 禁用 等 */
  state: number;

  /** 活动开始时间，Unix 时间戳（秒） */
  activityAtStart: number;

  /** 活动结束时间，Unix 时间戳（秒） */
  activityAtEnd: number;

  /** 创建时间，Unix 时间戳（秒） */
  createdAt: number;

  /** 关联的标题 ID（如果有的话） */
  relatedTitleId?: string;
}

export type CreateBannerPayload = Omit<Banner, 'id' | 'createdAt' | 'state'>;

export type BannerListParams = PaginationParams & {
  title?: string;
  bannerCate?: number;
  state?: number;
};

export interface Category {
  id: number;
  name: string;
  nameEn: string;
  icon: string;
  sortOrder: number;
  state: number;
  productCount: number;
}

export interface Coupon {
  id: string;
  couponName: string;
  couponCode?: string;
  couponType: 1 | 2 | 3;
  discountType: 1 | 2;

  discountValue: string;
  maxDiscount?: string;
  minPurchase: string;

  issuedQuantity?: number;
  totalQuantity: number;
  status: number;
  validType: 1 | 2;
  issueType: 1 | 2 | 3 | 4;
  perUserLimit: number;
  validDays?: number;

  validStartAt: number;
  validEndAt: number;
  createdAt: number;
}

export type CouponListParams = PaginationParams & {
  keyword?: string;
  status?: number;
  couponType?: number;
};

export interface CreateCouponPayload extends Omit<
  Coupon,
  | 'discountValue'
  | 'minPurchase'
  | 'id'
  | 'status'
  | 'issuedQuantity'
  | 'createdAt'
  | 'validEndAt'
  | 'validStartAt'
  | 'maxDiscount'
> {
  discountValue: number;
  minPurchase: number;
  validStartAt?: Date;
  validEndAt?: Date;
  maxDiscount?: number;
}

export type UpdateCouponPayload = Partial<
  Pick<CreateCouponPayload, 'couponName' | 'validEndAt' | 'totalQuantity'>
>;

export type TransactionSearchForm = {
  userId: string;
  type: string;
  startDate: string;
  endDate: string;
  transactionNo: string;
};

export type TransactionsListParams = PaginationParams &
  Partial<TransactionSearchForm>;

export interface WalletTransaction {
  id: string;
  transactionNo: string; // 流水号
  userId: string;

  amount: string; // 金额 (后端转为 string 防止精度丢失)
  beforeBalance: string; // 变动前
  afterBalance: string; // 变动后

  balanceType: BalanceTypeValue;
  transactionType: TransactionTypeValue;
  status: TransactionStatusValue;

  relatedId?: string;
  relatedType?: RelatedType | string; // 关联业务类型

  description: string;
  remark?: string;

  createdAt: number; // 时间戳 (后端 @DateToTimestamp)
  updatedAt?: number;

  user?: Pick<User, 'nickname' | 'avatar' | 'phone'>;
}

export interface WithdrawOrder {
  withdrawId: string;
  withdrawNo: string;
  userId: string;

  // 金额相关
  withdrawAmount: string; // 申请金额
  feeAmount: string; // 手续费
  actualAmount: string; // 实际打款

  withdrawStatus: WithdrawStatus;

  // 渠道相关 (后端映射过的字段)
  withdrawMethod: number;
  bankName?: string;
  channelCode?: string;

  // 账户信息
  withdrawAccount: string;
  accountName: string; // 户名

  // 审核相关
  auditResult?: string;
  rejectReason?: string;
  auditorId?: string;

  // 三方信息
  thirdPartyOrderNo?: string;

  // 时间
  createdAt: number;
  appliedAt: number;
  completedAt?: number;

  // 用户信息
  user?: {
    nickname: string;
    phone: string;
    avatar?: string;
  };
}

export interface WithdrawSearchForm {
  keyword: string; // 搜索: 单号/手机/昵称/ID
  status: string;
  startDate: string;
  endDate: string;
  dateRange?: dateRange;
}

export interface WithdrawListParams
  extends PaginationParams, Partial<WithdrawSearchForm> {}

export interface ManualAdjustPayload {
  userId: string;
  actionType: number; // 1=加币, 2=扣币 (Direction Enum)
  balanceType: number; // 1=现金, 2=金币 (BalanceType Enum)
  amount: number; // 输入时通常是 number
  remark: string;
}

export interface AuditWithdrawPayload {
  withdrawId: string;
  status: WithdrawStatus; // 只能是 SUCCESS (2) 或 REJECTED (5)
  remark: string;
}

export interface ActivityZone {
  id: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  active: boolean;
}

export interface RechargePlan {
  id: string;
  amount: number;
  bonus: number;
  tag?: string;
}

export interface RechargeSearchForm {
  keyword: string; // 搜索: 单号/手机/昵称/ID
  status: string;
  startDate: string;
  endDate: string;
  dateRange?: dateRange;
}

export type RechargeListParams = PaginationParams & Partial<RechargeSearchForm>;

export interface RechargeOrder {
  rechargeId: string;
  rechargeNo: string;

  /** 充值金额 (字符串格式) */
  rechargeAmount: string;

  /** 充值状态: 1-Pending, 2-Processing, 3-Success, 4-Failed, 5-Canceled */
  rechargeStatus: number;

  /** 支付方式: 1-GCash, 2-PayMaya, 3-Bank, 4-Card */
  paymentMethod: number;

  /** 支付渠道 */
  paymentChannel: string;

  /** 第三方单号 (可选) */
  thirdPartyOrderNo?: string;

  /** 创建时间戳 (毫秒) */
  createdAt: number;

  paidAt?: number;

  /** 用户信息 */
  user: Pick<User, 'phone' | 'nickname'>;
}

export interface Withdrawal {
  id: string;
  user: { id: string; name: string; avatar: string };
  amount: number;
  fee: number;
  method: 'GCash' | 'PayMaya' | 'Bank';
  accountNo: string;
  status: 'pending' | 'approved' | 'rejected';
  date: string;
}

export interface Transaction {
  id: string;
  transactionNo: string;
  user: { id: string; name: string };
  type: 'deposit' | 'withdraw' | 'buy' | 'win' | 'refund' | 'bonus';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  date: string;
}

export interface FinanceStatistics {
  pendingWithdraw: string;
  totalDeposit: string;
  totalWithdraw: string;
  depositTrend: string;
  withdrawTrend: string;
}

export interface Order {
  orderId: string;
  orderNo: string;
  originalAmount: number;
  finalAmount: number;
  couponAmount: number;
  coinAmount: number;
  buyQuantity: number;
  unitPrice: number;
  orderStatus: number;
  paidAt: number;
  createdAt: number;
  user: OrderUser;
  treasure: OrderTreasure;
}

export interface OrderUser {
  id: string;
  nickname: string;
  phone: string;
}

export interface OrderTreasure {
  treasureId: string;
  treasureName: string;
  treasureCoverImg: string;
}

// output to API query parameters
export interface OrderListParams extends PaginationParams {
  keyword?: string;
  // 1=Pending; 2=Processing; 3=Paid; 4=Cancelled; 5=Refunded; 6=Wait Group; 7=Ready to Ship; 8=Shipped; 9=Completed
  orderStatus?: number;
}

// input to search form component
export type OrderSearchForm = {
  keyword: string;
  orderStatus: string;
};

export interface AddressResponse {
  addressId: string;
  userId: string;
  userNickname?: string;
  contactName: string;
  firstName: string;
  lastName: string;
  phone: string;
  province: string;
  city: string;
  barangay: string;
  fullAddress: string;
  isDefault: number;
  createdAt: number;

  provinceId?: number;
  cityId?: number;
  barangayId?: number;
}

export interface AddressSeahFormInput {
  keyword: string;
  userId: string;
  province: string;
}

export interface QueryListAddressParams
  extends PaginationParams, Partial<AddressSeahFormInput> {}

export interface UpdateAddress {
  firstName?: string;
  lastName?: string;
  phone?: string;
  fullAddress?: string;
  isDefault?: number;
  provinceId?: number;
  cityId?: number;
  barangayId?: number;
}

export interface Province {
  provinceId: number;
  provinceName: string;
}

export interface City {
  cityId: number;
  cityName: string;
  postalCode: string;
}

export interface Barangay {
  barangayId: number;
  barangayName: string;
}

// 新增：OCR 原始数据的类型定义
// 用于在审核界面做 "用户填写的 vs 机器识别的" 对比
export interface KycOcrData {
  name?: string; // OCR 识别的全名
  idNumber?: string; // OCR 识别的证件号
  birthday?: number | string; // OCR 识别的生日
  gender?: string; // OCR 识别的性别
  expiryDate?: string | null;

  // 还可以包含风控字段
  fraudScore?: number;
  isSuspicious?: boolean;
  faceMatched?: boolean;
}

export interface KycRecord {
  id: string;
  userId: string;

  // 关联用户信息
  user?: {
    nickname?: string;
    phone?: string;
    avatar?: string; // 可能会用到头像
  };

  kycStatus: KycStatus; // 0, 1, 2, 3, 4 ...

  // 证件信息
  idType: number; // 证件类型 ID
  idNumber?: string; // 用户填写的证件号
  realName?: string; // 用户填写的真实姓名

  // 补充字段 (用于 UI 展示)
  birthday?: string | number; // 用户填写的生日
  gender?: string; // 用户填写的性别
  countryCode?: string; // 国家代码

  // 证据图片 (注意：这里已经是签名后的 URL)
  idCardFront?: string;
  idCardBack?: string;
  faceImage?: string;

  // 活体检测
  livenessScore?: number; // 0-100 分数
  videoUrl?: string; // 活体视频地址

  ocrRawData?: KycOcrData;

  // 审核结果
  rejectReason?: string; // 拒绝主要原因
  auditResult?: string; // 审核员备注 (Remark)
  auditorId?: string; // 审核员 ID
  auditorName?: string; // 审核员名字 (可选)

  // 时间字段 (建议统一格式，通常 API 返回 ISO 字符串)
  submittedAt?: string;
  auditedAt?: string | number; // 兼容时间戳或字符串
  createdAt?: string | number;
  updatedAt?: string | number;
}

// ==========================================
// 1. 新增：管理员手动创建 KYC 的参数
// ==========================================
export interface AdminCreateKycParams {
  userId: string; // 必填
  realName: string; // 必填
  idNumber: string; // 必填
  idType?: number; // 选填 (默认1)
  idCardFront?: string; // 选填 (图片URL)
  idCardBack?: string; // 选填
  faceImage?: string; // 选填
  remark?: string; // 选填 (备注)
}

// ==========================================
// 2. 新增：管理员修改 KYC 的参数 (部分更新)
// ==========================================
// 使用 Partial 让所有字段变可选，但排除 remark 单独定义
export interface AdminUpdateKycParams extends Partial<
  Omit<AdminCreateKycParams, 'userId'>
> {
  remark?: string; // 修改原因
}

export interface KycRecordListParams {
  page?: number;
  pageSize?: number;
  userId?: string;
  kycStatus?: number;
  startDate?: string;
  endDate?: string;
  dateRange?: dateRange;
}

export interface AuditKycParams {
  action: 'APPROVE' | 'REJECT' | 'NEED_MORE';
  remark: string;
}

/** 钱包信息 */
export interface ClientUserWallet {
  realBalance: string; // 现金余额 (对应 @DecimalToString)
  coinBalance: string; // 金币余额 (对应 @DecimalToString)
}

/** 登录日志 */
export interface ClientUserLoginLog {
  loginTime: number; // 登录时间戳 (对应 @DateToTimestamp)
  loginIp: string;
  loginDevice: string;
  createdAt: number; // 创建时间戳
}

/** 设备信息 */
export interface ClientUserDevice {
  id: string; // 记录ID
  deviceId: string; // 硬件指纹
  deviceModel: string;
  lastActiveAt: number; // 最后活跃时间戳
  ipAddress: string;
  isBanned: boolean; // 是否拉黑
  banReason?: string;
}

/** 用户列表项 (ListItem) */
export interface ClientUserListItem {
  id: string;
  nickname: string;
  phone: string;
  avatar: string;
  vipLevel: number;
  kycStatus: number; // 0-未认证 1-审核中 4-已认证
  inviteCode: string;
  createdAt: number; // 注册时间戳
  lastLoginAt: number; // 最后登录时间戳
  status: number; // 0-冻结 1-正常
  wallet: ClientUserWallet;
}

/** 用户详情 (Detail) */
export interface ClientUserDetail extends ClientUserListItem {
  loginLogs: ClientUserLoginLog[];
  devices: ClientUserDevice[];
}

/** 查询用户列表参数 */
export interface QueryClientUserParams {
  page: number;
  pageSize: number;
  phone?: string;
  userId?: string;
  kycStatus?: number;
  status?: number;
  startTime?: string; // ISO 日期字符串 (对应 @IsDateString)
  endTime?: string; // ISO 日期字符串
  dateRange?: dateRange;
}

/** 更新用户状态请求 */
export interface UpdateUserStatusParams {
  status: 0 | 1; // 0-冻结, 1-正常
  remark?: string;
}

/** 拉黑设备请求 */
export interface BanDeviceParams {
  deviceId: string;
  reason: string;
}

export interface Banner {
  id: string;
  title: string;
  image: string;
  position: 'home' | 'activity';
  status: 'active' | 'inactive';
}

export interface DashboardStats {
  totalRevenue: number;
  activeUsers: number;
  newOrders: number;
  pendingIssues: number;
}

export interface TreasureGroup {
  id: string;
  product: { id: string; name: string; image: string };
  creator: { id: string; name: string; avatar: string };
  currentSize: number;
  targetSize: number;
  status: 'active' | 'completed' | 'failed';
  createdAt: string;
  expiresAt: string;
}

// ── Real API types for Group Buying Management ──────────────────────────────

export interface AdminGroupUser {
  id: string;
  nickname: string | null;
  avatar: string | null;
}

export interface AdminGroupMember {
  isOwner: number; // 1 = owner, 0 = member
  joinedAt: number; // ms timestamp
  user: AdminGroupUser;
}

export interface AdminGroupTreasurePreview {
  treasureId: string;
  treasureName: string;
  treasureCoverImg: string;
  unitAmount: number;
}

export interface AdminGroupItem {
  groupId: string;
  treasureId: string;
  treasure?: AdminGroupTreasurePreview;
  groupStatus: number; // 1=ACTIVE 2=SUCCESS 3=FAILED
  currentMembers: number;
  maxMembers: number;
  expireAt: number; // ms timestamp
  updatedAt: number; // ms timestamp
  creator: AdminGroupUser;
  members: AdminGroupMember[];
}

export interface AdminGroupDetail {
  groupId: string;
  groupStatus: number;
  currentMembers: number;
  maxMembers: number;
  expireAt: number;
  treasure: AdminGroupTreasurePreview;
  members: AdminGroupMember[];
}

export interface AdminGroupListParams {
  page?: number;
  pageSize?: number;
  treasureId?: string;
  status?: number;
  includeExpired?: boolean;
}

export interface SignInRule {
  id?: string;
  day: number;
  rewardType: 'coin' | 'coupon' | 'cash';
  amount: number;
  couponId?: string;
}

export interface GrowthRule {
  id: string;
  type: 'register' | 'invite' | 'join_group';
  rewardType: 'coin' | 'coupon' | 'cash';
  amount: number;
  couponId?: string;
  isActive: boolean;
}

// --- USER DETAIL EXTENSIONS ---

export interface BettingRecord {
  id: string;
  gameName: string;
  roundId: string;
  amount: number;
  status: 'win' | 'loss' | 'pending';
  payout: number;
  date: string;
}

export interface LoginLog {
  id: string;
  ip: string;
  device: string;
  location: string;
  date: string;
  status: 'success' | 'failed';
}

export interface ReferralUser {
  id: string;
  nickname: string;
  joinDate: string;
  totalContribution: number; // Commission earned from this user
}

// --- OPERATIONS TYPES ---

/** @deprecated Use LuckyDrawActivity instead */
export interface LotteryDraw {
  id: string;
  product: { id: string; name: string; image: string };
  totalShares: number;
  fillRate: number; // 0-100
  status: 'pending' | 'calculating' | 'completed';
  winner?: { id: string; name: string; code: string };
  hash?: string;
  drawTime?: string;
}

export interface VipTier {
  level: number;
  name: string;
  threshold: number; // Amount needed to reach this level
  benefits: string[];
  color: string;
}

export interface SystemNotification {
  id: string;
  title: string;
  message: string;
  target: 'all' | 'vip' | 'individual';
  sentCount: number;
  date: string;
  status: 'sent' | 'scheduled';
}

// --- ACTIVITY CONFIG TYPES ---

export interface ActivityPrize {
  id: string;
  type: 'product' | 'coupon' | 'coin' | 'balance' | 'empty';
  name: string;
  image: string;
  value?: string | number; // Product ID, Coupon ID, or Amount
  probability: number; // 0-100%
  stock: number;
  displayIndex: number;
  sortOrder: number;
}

export interface ActivityRule {
  costType: 'coin' | 'balance' | 'free';
  costAmount: number;
  dailyLimit: number; // 0 for unlimited
  totalLimit: number;
  minVipLevel: number;
}

/** @deprecated Use LuckyDrawActivity instead */
export interface LotteryActivity {
  id: string;
  name: string;
  coverImage: string;
  template: 'wheel' | 'box' | 'grid';
  startTime: string;
  endTime: string;
  status: 'active' | 'draft' | 'ended';
  prizes: ActivityPrize[];
  rules: ActivityRule;
  sortOrder: number;
}

// --- ADMIN SECURITY TYPES ---

export interface Role {
  id: string;
  name: string;
  permissions: string[]; // e.g. "user.read", "finance.write"
  description: string;
}

export interface AdminUser {
  id: string;
  username: string;
  roleId: string;
  roleName: string;
  status: number;
  lastLogin: string;
  lastLoginIp: string;
}

/** @deprecated 使用 AdminOperationLog 替代 */
export interface OperationLog {
  id: string;
  adminName: string;
  action: string; // e.g., "Updated User Balance"
  target: string; // e.g., "User: 1001"
  ip: string;
  date: string;
}

/**
 * 操作日志审计 — 对应 Prisma AdminOperationLog 模型
 */
export interface AdminOperationLog {
  id: string;
  createdAt: string;
  adminId: string | null;
  /** 操作时记录的管理员用户名（历史快照） */
  adminName: string;
  /** 模块名称，e.g. "users", "orders", "products" */
  module: string;
  /** 操作类型，e.g. "LOGIN", "CREATE", "UPDATE", "DELETE" */
  action: string;
  /** 操作详情 / 备注 */
  details: string | null;
  /** 请求 IP */
  requestIp: string | null;
  /** 关联的管理员用户（JOIN 查询） */
  admin?: {
    id: string;
    username: string;
    realName: string | null;
  };
}

/**
 * 操作日志列表查询参数
 */
export interface AdminOperationLogListParams {
  page?: number;
  pageSize?: number;
  /** 按管理员 ID 过滤 */
  adminId?: string;
  /** 按操作类型过滤，e.g. "CREATE"，传 "ALL" 或不传表示全部 */
  action?: string;
  /** 关键词搜索（匹配 adminName / details / module） */
  keyword?: string;
  /** 开始日期，ISO 字符串，e.g. "2026-01-01" */
  startDate?: string;
  /** 结束日期，ISO 字符串，e.g. "2026-12-31" */
  endDate?: string;
}

// --- CONTENT CMS TYPES ---

export interface Article {
  id: string;
  title: string;
  category: 'announcement' | 'guide' | 'news';
  status: 'published' | 'draft';
  author: string;
  publishDate: string;
  views: number;
}

export interface Faq {
  id: string;
  question: string;
  answer: string;
  category: string;
  sortOrder: number;
}

// --- DATA ANALYTICS TYPES ---

export interface FunnelData {
  stage: string;
  users: number;
  rate: number; // Conversion rate from previous step
  dropOff: number;
}

export interface ProductMetric {
  id: string;
  name: string;
  salesVolume: number; // X-axis
  profitMargin: number; // Y-axis
  revenue: number; // Bubble size
  category: string;
}

export interface CohortData {
  date: string; // e.g., "Jan 2024"
  users: number; // Initial users
  retention: number[]; // Array of percentages for month 0, 1, 2...
}

// --- SERVICE CENTER TYPES ---

export interface WorkOrder {
  id: string;
  ticketNo: string;
  user: { id: string; name: string; avatar: string };
  subject: string;
  message: string;
  status: 'open' | 'pending' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
  replies: { sender: 'user' | 'support'; message: string; time: string }[];
}

// --- STATS / ANALYTICS TYPES ---

/**
 * GET /v1/admin/stats/overview 返回结构
 */
export interface StatsOverview {
  users: {
    total: number;
    today: number;
    thisMonth: number;
  };
  orders: {
    total: number;
    today: number;
    paid: number;
  };
  revenue: {
    /** 累计订单收入（Decimal 字符串） */
    total: string;
    /** 今日订单收入 */
    today: string;
  };
  finance: {
    /** 累计充值成功金额 */
    totalDeposit: string;
    /** 待审核提现笔数 */
    pendingWithdrawCount: number;
    /** 待审核提现总金额 */
    pendingWithdrawAmount: string;
  };
}

/**
 * GET /v1/admin/stats/trend 返回结构
 */
export interface StatsTrend {
  orders: Array<{
    date: string; // "YYYY-MM-DD"
    count: number;
    revenue: string; // Decimal 字符串
  }>;
  users: Array<{
    date: string;
    count: number;
  }>;
}

/**
 * GET /v1/admin/user/roles-summary — 单个角色汇总
 */
export interface RoleSummaryItem {
  role: string;
  nameEn: string;
  nameZh: string;
  description: string;
  /** 活跃用户人数 */
  userCount: number;
  /** 权限字符串列表，e.g. ["user_management:view_user", ...] */
  permissions: string[];
  /** 权限按模块分组 { "用户管理": ["view_user", "ban_user"], ... } */
  permissionsByModule: Record<string, string[]>;
}

// ─── Notification / Push ─────────────────────────────────────────────────────

export interface AdminPushLog {
  id: string;
  createdAt: string;
  adminId: string;
  adminName: string;
  /** broadcast | targeted */
  type: 'broadcast' | 'targeted';
  targetUserId?: string;
  title: string;
  body: string;
  extraData?: Record<string, unknown>;
  /** sent | failed */
  status: 'sent' | 'failed';
  successCount: number;
  failureCount: number;
}

export interface DeviceStats {
  total: number;
  android: number;
  ios: number;
  web: number;
  activeInLast7Days: number;
}

export interface QueryPushLogParams {
  page?: number;
  pageSize?: number;
  type?: string;
  keyword?: string;
  startDate?: string;
  endDate?: string;
}

export interface SendBroadcastPayload {
  title: string;
  body: string;
  extraData?: Record<string, unknown>;
}

export interface SendTargetedPayload {
  targetUserId: string;
  title: string;
  body: string;
  extraData?: Record<string, unknown>;
}

// ─── IM / Chat Moderation ─────────────────────────────────────────────────────

export type ConversationType = 'GROUP' | 'DIRECT' | 'SUPPORT' | 'BUSINESS';

export interface ChatConversationMember {
  userId: string;
  nickname: string | null;
  avatar: string | null;
  role: string;
}

export interface ChatConversation {
  id: string;
  type: ConversationType;
  name: string | null;
  status: number; // 1=正常 2=已关闭
  lastMsgContent: string | null;
  lastMsgTime: number;
  lastMsgSeqId: number;
  memberCount: number;
  members: ChatConversationMember[];
}

export interface ChatMessage {
  id: string;
  seqId: number;
  content: string;
  type: number; // 0=text 1=image 2=audio 3=video 99=system
  isRecalled: boolean;
  createdAt: number;
  meta: Record<string, unknown> | null;
  senderId: string | null;
  sender: { id: string; nickname: string; avatar: string | null } | null;
  isSystem: boolean;
}

export interface QueryConversationsParams {
  page?: number;
  pageSize?: number;
  type?: ConversationType;
  keyword?: string;
  status?: number;
}

export interface QueryMessagesParams {
  cursor?: number;
  pageSize?: number;
}

export interface AdminReplyPayload {
  content: string;
  /** 0=TEXT, 1=IMAGE, 2=AUDIO, 3=VIDEO, 5=FILE, 6=LOCATION */
  type?: number;
  meta?: Record<string, unknown>;
  agentName?: string;
}

export interface AdminUploadTokenResult {
  url: string;
  key: string;
  cdnUrl: string | null;
  isPrivate: boolean;
}

export interface CloseConversationPayload {
  reason?: string;
}

export interface ChatMessagesResult {
  list: ChatMessage[];
  nextCursor: number | null;
  totalSeqId: number;
}

// ─── Support Channels ───────────────────────────────────────────────────────

export interface SupportChannelItem {
  id: string;
  name: string;
  description: string | null;
  botUserId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  botUser: {
    id: string;
    nickname: string | null;
    avatar: string | null;
    isRobot: boolean;
  };
}

export interface QuerySupportChannelsParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  isActive?: boolean;
}

export interface SupportChannelsResult {
  list: SupportChannelItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateSupportChannelPayload {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
}

export interface UpdateSupportChannelPayload {
  name?: string;
  description?: string;
  avatar?: string;
}

// ─── Advertisement ────────────────────────────────────────────────────────────

export interface Advertisement {
  id: string;
  title: string | null;
  fileType: number; // 1=image 2=video
  img: string | null;
  videoUrl: string | null;
  adPosition: number; // 1=home-top 2=home-mid 3=category 4=detail
  sortOrder: number;
  jumpUrl: string | null;
  relatedId: string | null;
  jumpCate: number | null;
  startTime: number | null;
  endTime: number | null;
  status: number; // 0=disabled 1=enabled
  viewCount: number;
  clickCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface QueryAdsParams {
  page?: number;
  pageSize?: number;
  status?: number;
  adPosition?: number;
}

export interface CreateAdPayload {
  title?: string;
  fileType: number;
  img?: string;
  videoUrl?: string;
  adPosition: number;
  sortOrder?: number;
  jumpUrl?: string;
  relatedId?: string;
  jumpCate?: number;
  startTime?: string;
  endTime?: string;
  status?: number;
}

export type UpdateAdPayload = Partial<CreateAdPayload>;

// ─── Flash Sale ───────────────────────────────────────────────────────────────

export interface FlashSaleSession {
  id: string;
  title: string;
  startTime: number;
  endTime: number;
  status: number; // 1=active 0=inactive
  productCount: number;
}

export interface FlashSaleProduct {
  id: string;
  treasureId: string;
  flashStock: number;
  flashPrice: string;
  sortOrder: number;
  product: {
    treasureId: string;
    treasureName: string;
    unitAmount: string;
    treasureCoverImg: string | null;
  } | null;
}

export interface CreateFlashSaleSessionPayload {
  title: string;
  startTime: string;
  endTime: string;
  status?: number;
}

export type UpdateFlashSaleSessionPayload =
  Partial<CreateFlashSaleSessionPayload>;

export interface BindFlashSaleProductPayload {
  treasureId: string;
  flashPrice: string;
  flashStock?: number;
  sortOrder?: number;
}

export interface UpdateFlashSaleProductPayload {
  flashPrice?: string;
  flashStock?: number;
  sortOrder?: number;
}

// ─── System Config ────────────────────────────────────────────────────────────

export interface SystemConfigItem {
  key: string;
  value: string;
}

// ─── User Login Log ───────────────────────────────────────────────────────────

export interface UserLoginLog {
  id: string;
  userId: string;
  userNickname: string | null;
  userAvatar: string | null;
  loginTime: number;
  loginType: number; // 1=password 2=sms 3=third-party
  loginMethod: string | null; // password/google/facebook
  loginIp: string | null;
  loginDevice: string | null;
  countryCode: string | null;
  city: string | null;
  loginStatus: number; // 1=success 0=fail
  failReason: string | null;
  tokenIssued: number;
}

export interface QueryLoginLogParams {
  page?: number;
  pageSize?: number;
  userId?: string;
  loginIp?: string;
  loginMethod?: string;
  loginStatus?: number;
  startDate?: string;
  endDate?: string;
}

// ─── Admin Register Application ───────────────────────────────────────────────

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

export interface AdminApplication {
  id: string;
  username: string;
  realName: string;
  email: string;
  applyReason?: string;
  applyIp?: string;
  status: ApplicationStatus;
  reviewedBy?: string;
  reviewNote?: string;
  reviewedAt?: number | null;
  createdAt: number;
}

export interface CreateApplicationPayload {
  username: string;
  password: string;
  realName: string;
  email: string;
  applyReason?: string;
  recaptchaToken: string;
}

export interface ApplicationListParams {
  page?: number;
  pageSize?: number;
  status?: ApplicationStatus | 'all';
  username?: string;
}

// ─── Lucky Draw ───────────────────────────────────────────────────────────────

/** 奖品类型：1=优惠券 2=金币 3=余额 4=谢谢参与 */
export type LuckyDrawPrizeType = 1 | 2 | 3 | 4;

export interface LuckyDrawPrize {
  id: string;
  activityId: string;
  prizeType: LuckyDrawPrizeType;
  prizeName: string;
  couponId: string | null;
  couponName: string | null;
  prizeValue: number | null;
  probability: number;
  stock: number;
  sortOrder: number;
}

export interface LuckyDrawActivity {
  id: string;
  createdAt: number;
  title: string;
  description: string | null;
  treasureId: string | null;
  treasureName: string | null;
  /** 0=禁用 1=启用 */
  status: number;
  startAt: number | null;
  endAt: number | null;
  prizes?: LuckyDrawPrize[];
  prizesCount?: number;
  ticketsCount?: number;
}

export interface LuckyDrawResult {
  id: string;
  createdAt: number;
  userId: string;
  userNickname: string | null;
  userAvatar: string | null;
  prizeId: string;
  prizeName: string;
  prizeType: LuckyDrawPrizeType;
  activityId: string;
  activityTitle: string | null;
  orderId: string;
  couponName?: string | null;
  treasureName?: string | null;
  prizeSnapshot: unknown;
}

export interface CreateLuckyDrawActivityPayload {
  title: string;
  description?: string;
  treasureId?: string;
  status?: number;
  startAt?: string;
  endAt?: string;
}

export interface UpdateLuckyDrawActivityPayload {
  title?: string;
  description?: string;
  treasureId?: string;
  status?: number;
  startAt?: string;
  endAt?: string;
}

export interface CreateLuckyDrawPrizePayload {
  activityId: string;
  prizeType: LuckyDrawPrizeType;
  prizeName: string;
  couponId?: string;
  prizeValue?: number;
  probability: number;
  stock?: number;
  sortOrder?: number;
}

export interface UpdateLuckyDrawPrizePayload {
  prizeType?: LuckyDrawPrizeType;
  prizeName?: string;
  couponId?: string;
  prizeValue?: number;
  probability?: number;
  stock?: number;
  sortOrder?: number;
}

export interface QueryLuckyDrawResultsParams {
  page?: number;
  pageSize?: number;
  activityId?: string;
  userId?: string;
}
