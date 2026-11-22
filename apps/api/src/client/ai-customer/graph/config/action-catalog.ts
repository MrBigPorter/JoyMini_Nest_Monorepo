/**
 * ACTION_CATALOG — AI 写操作动作目录（唯一事实源）
 *
 * ── 为什么需要它？ ──
 * 改造前动作映射、卡片摘要、确认分支、启动自检各维护一份名单，
 * 新增写工具时只改其中一处就会「有工具、没卡片」或「有卡片、没执行分支」。
 *
 * 现在所有与动作相关的信息只在这里定义：
 *   - toolName      : LangChain 写工具名（与 ToolRegistry 的 capability=write 对齐）
 *   - action        : 客户端/生命周期使用的动作标识
 *   - title         : 卡片标题
 *   - needsOtp      : 确认后是否还需要短信验证码
 *   - buildSummary  : 向后兼容的 summary（旧客户端仍读这个字段）
 *   - buildFields   : 服务端渲染的展示字段（新客户端只读 label/value）
 *   - buildParams   : 服务端保存的执行参数（客户端展示字段绝不参与执行）
 *   - execute       : 服务端确认分支（确认后唯一的执行入口）
 *
 * 启动自检（ToolRegistry.auditCapabilities）会校验：
 *   写工具 ⊆ 目录、目录 action 都有 execute 分支、副作用工具必须声明能力。
 */

import { CONFIRM_TOKEN_TTL_SEC } from '../../ai-action.constants';

/** 卡片展示的一行键值 */
export interface ActionField {
  label: string;
  value: string;
}

/** 确认执行时由 AiCustomerService 注入的业务依赖（结构类型，避免目录反向依赖服务类） */
export interface ActionExecutionServices {
  claimCoupon(userId: string, couponId: string): Promise<unknown>;
  redeemCouponCode(userId: string, code: string): Promise<unknown>;
  draw(userId: string, ticketId: string): Promise<unknown>;
  createAddress(userId: string, params: Record<string, any>): Promise<unknown>;
  updateAddress(
    userId: string,
    addressId: string,
    params: Record<string, any>,
  ): Promise<unknown>;
  deleteAddress(userId: string, addressId: string): Promise<unknown>;
  startWithdrawOtp(
    userId: string,
    params: Record<string, any>,
    summary: Record<string, any>,
    requestId?: string,
    conversationId?: string,
  ): Promise<unknown>;
}

export interface ActionExecuteContext {
  userId: string;
  params: Record<string, any>;
  summary: Record<string, any>;
  requestId?: string;
  /** 动作所属会话；提现 OTP 结果要回投到它。 */
  conversationId?: string;
  services: ActionExecutionServices;
}

export interface ActionCatalogEntry {
  action: string;
  toolName: string;
  title: string;
  /** 执行成功时发给客户端的用户可读消息 */
  successMessage: string;
  needsOtp: boolean;
  ttlSec: number;
  buildSummary(args: Record<string, any>): Record<string, any>;
  buildFields(args: Record<string, any>): ActionField[];
  buildParams(args: Record<string, any>): Record<string, any>;
  execute(ctx: ActionExecuteContext): Promise<unknown>;
}

function maskPhone(phone: unknown): string {
  const digits = typeof phone === 'string' ? phone.trim() : '';
  if (digits.length <= 4) return '****';
  return `****${digits.slice(-4)}`;
}

/** 收款账号只展示尾号，完整值仅保存在服务端执行参数里 */
function maskAccount(account: unknown): string {
  const value = typeof account === 'string' ? account.trim() : '';
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

function field(fields: ActionField[], label: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  fields.push({ label, value: String(value) });
}

function isDefaultLabel(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return value === true || value === 1 || value === '1' ? '是' : '否';
}

/** 只挑指定字段，过滤 undefined —— 保证服务端执行参数与工具声明一致 */
function pick(args: Record<string, any>, keys: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of keys) {
    if (args[key] !== undefined) out[key] = args[key];
  }
  return out;
}

const ADDRESS_PARAM_KEYS = [
  'contactName',
  'phone',
  'province',
  'city',
  'barangay',
  'fullAddress',
  'label',
  'isDefault',
];

function addressSummary(args: Record<string, any>): Record<string, any> {
  return {
    action: '',
    contactName: args.contactName ?? undefined,
    phone: args.phone === undefined ? undefined : maskPhone(args.phone),
    province: args.province ?? undefined,
    city: args.city ?? undefined,
    barangay: args.barangay ?? undefined,
    fullAddress: args.fullAddress ?? undefined,
    label: args.label ?? undefined,
    isDefault: args.isDefault ?? undefined,
  };
}

function addressFields(args: Record<string, any>): ActionField[] {
  const fields: ActionField[] = [];
  field(fields, '联系人', args.contactName);
  if (args.phone !== undefined) {
    field(fields, '电话', maskPhone(args.phone));
  }
  field(fields, '省/区', args.province);
  field(fields, '市', args.city);
  field(fields, '区/村', args.barangay);
  field(fields, '详细地址', args.fullAddress);
  field(fields, '标签', args.label);
  field(fields, '默认地址', isDefaultLabel(args.isDefault));
  return fields;
}

export const ACTION_CATALOG: readonly ActionCatalogEntry[] = [
  {
    action: 'withdraw',
    toolName: 'applyWithdraw',
    title: '提现确认',
    successMessage: '提现申请已提交，预计 1-3 个工作日到账',
    needsOtp: true,
    ttlSec: CONFIRM_TOKEN_TTL_SEC,
    buildSummary(args) {
      return {
        action: 'withdraw',
        amount: args.amount,
        channelId: args.channelId,
        ...(args.channelName ? { channelName: args.channelName } : {}),
        account: maskAccount(args.account),
        accountName: args.accountName,
        ...(args.fee !== undefined ? { fee: args.fee } : {}),
        ...(args.netAmount !== undefined ? { netAmount: args.netAmount } : {}),
      };
    },
    buildFields(args) {
      const fields: ActionField[] = [];
      field(
        fields,
        '金额',
        args.amount === undefined ? undefined : `₱${args.amount}`,
      );
      field(
        fields,
        '渠道',
        args.channelName ??
          (args.channelId === undefined ? undefined : `渠道 #${args.channelId}`),
      );
      field(
        fields,
        '手续费',
        args.fee === undefined ? undefined : `₱${args.fee}`,
      );
      field(
        fields,
        '实际到账',
        args.netAmount === undefined ? undefined : `₱${args.netAmount}`,
      );
      field(
        fields,
        '收款账号',
        args.account === undefined ? undefined : maskAccount(args.account),
      );
      field(fields, '户名', args.accountName);
      return fields;
    },
    buildParams(args) {
      return pick(args, ['amount', 'channelId', 'account', 'accountName']);
    },
    async execute(ctx) {
      // 提现是两段式：确认后先发 OTP + 暂存任务，验码成功才真正执行。
      return ctx.services.startWithdrawOtp(
        ctx.userId,
        ctx.params,
        ctx.summary,
        ctx.requestId,
        ctx.conversationId,
      );
    },
  },
  {
    action: 'claim_coupon',
    toolName: 'claimCoupon',
    title: '领券确认',
    successMessage: '优惠券已领取',
    needsOtp: false,
    ttlSec: CONFIRM_TOKEN_TTL_SEC,
    buildSummary(args) {
      return {
        action: 'claim_coupon',
        couponId: args.couponId,
        ...(args.couponName ? { couponName: args.couponName } : {}),
      };
    },
    buildFields(args) {
      const fields: ActionField[] = [];
      field(fields, '优惠券', args.couponName ?? args.couponId);
      return fields;
    },
    buildParams(args) {
      return pick(args, ['couponId']);
    },
    async execute(ctx) {
      return ctx.services.claimCoupon(ctx.userId, ctx.params.couponId);
    },
  },
  {
    action: 'redeem_code',
    toolName: 'redeemCouponCode',
    title: '兑换码确认',
    successMessage: '兑换码已兑换',
    needsOtp: false,
    ttlSec: CONFIRM_TOKEN_TTL_SEC,
    buildSummary(args) {
      return { action: 'redeem_code', code: args.code };
    },
    buildFields(args) {
      const fields: ActionField[] = [];
      field(fields, '兑换码', args.code);
      return fields;
    },
    buildParams(args) {
      return pick(args, ['code']);
    },
    async execute(ctx) {
      return ctx.services.redeemCouponCode(ctx.userId, ctx.params.code);
    },
  },
  {
    action: 'draw',
    toolName: 'draw',
    title: '抽奖确认',
    successMessage: '抽奖已完成',
    needsOtp: false,
    ttlSec: CONFIRM_TOKEN_TTL_SEC,
    buildSummary(args) {
      return { action: 'draw', ticketId: args.ticketId };
    },
    buildFields(args) {
      const fields: ActionField[] = [];
      field(fields, '抽奖券', args.ticketId);
      return fields;
    },
    buildParams(args) {
      return pick(args, ['ticketId']);
    },
    async execute(ctx) {
      return ctx.services.draw(ctx.userId, ctx.params.ticketId);
    },
  },
  {
    action: 'create_address',
    toolName: 'createAddress',
    title: '新增地址确认',
    successMessage: '收货地址已新增',
    needsOtp: false,
    ttlSec: CONFIRM_TOKEN_TTL_SEC,
    buildSummary(args) {
      return { ...addressSummary(args), action: 'create_address' };
    },
    buildFields: addressFields,
    buildParams(args) {
      return pick(args, ADDRESS_PARAM_KEYS);
    },
    async execute(ctx) {
      return ctx.services.createAddress(ctx.userId, ctx.params);
    },
  },
  {
    action: 'update_address',
    toolName: 'updateAddress',
    title: '修改地址确认',
    successMessage: '收货地址已修改',
    needsOtp: false,
    ttlSec: CONFIRM_TOKEN_TTL_SEC,
    buildSummary(args) {
      return {
        ...addressSummary(args),
        action: 'update_address',
        addressId: args.addressId,
      };
    },
    buildFields(args) {
      const fields: ActionField[] = [];
      field(fields, '地址ID', args.addressId);
      return fields.concat(addressFields(args));
    },
    buildParams(args) {
      return pick(args, ['addressId', ...ADDRESS_PARAM_KEYS]);
    },
    async execute(ctx) {
      return ctx.services.updateAddress(
        ctx.userId,
        ctx.params.addressId,
        ctx.params,
      );
    },
  },
  {
    action: 'delete_address',
    toolName: 'deleteAddress',
    title: '删除地址确认',
    successMessage: '收货地址已删除',
    needsOtp: false,
    ttlSec: CONFIRM_TOKEN_TTL_SEC,
    buildSummary(args) {
      return { action: 'delete_address', addressId: args.addressId };
    },
    buildFields(args) {
      const fields: ActionField[] = [];
      field(fields, '地址ID', args.addressId);
      return fields;
    },
    buildParams(args) {
      return pick(args, ['addressId']);
    },
    async execute(ctx) {
      return ctx.services.deleteAddress(ctx.userId, ctx.params.addressId);
    },
  },
];

/** tool name → 目录项 */
export function getCatalogEntryByTool(
  toolName: string,
): ActionCatalogEntry | undefined {
  return ACTION_CATALOG.find((entry) => entry.toolName === toolName);
}

/** action → 目录项 */
export function getCatalogEntryByAction(
  action: string,
): ActionCatalogEntry | undefined {
  return ACTION_CATALOG.find((entry) => entry.action === action);
}

/** 目录中声明的全部 action（启动自检用） */
export function getCatalogActions(): string[] {
  return ACTION_CATALOG.map((entry) => entry.action);
}

/** 目录中声明的全部写工具名（启动自检用） */
export function getCatalogToolNames(): string[] {
  return ACTION_CATALOG.map((entry) => entry.toolName);
}
