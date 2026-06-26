import { TimeHelper } from "../date/TimeHelper";
/**
 * 业务前缀枚举
 * 统一管理所有单据的前缀，拒绝硬编码
 */
export enum BizPrefix {
  ORDER = "ORD", // 主订单
  PAYMENT = "PAY", // 支付流水
  REFUND = "REF", // 退款单
  DEPOSIT = "DEP", // 充值
  WITHDRAW = "WTD", // 提现
  ADJUST = "ADJ", // 调账
  TRANSFER = "TRF", // 转账
  TRANSACTION = "TXN", // 余额变动流水
  SNAPSHOT = "SNP", // 财务日结快照
}

export class OrderNoHelper {
  /**
   * 生成标准业务单号
   * 结构: PREFIX (3) + TIME (17) + RANDOM (6) = 26位
   * @param prefix 业务前缀
   * @param randomLen 随机数长度 (默认6位，足以应对大部分并发)
   */
  static generate(prefix: BizPrefix, randomLen = 6): string {
    // 1. 获取毫秒级时间串: 20251214143005123
    const timeStr = TimeHelper.formatForTransaction();

    // 2. 生成随机数
    // 修复潜在bug: 必须保证生成的长度绝对等于 randomLen
    const randomStr = this._generateRandomString(randomLen);

    return `${prefix}${timeStr}${randomStr}`;
  }

  /**
   * 生成带用户特征的单号 (用于分库分表路由)
   * 结构: PREFIX (3) + TIME (17) + RANDOM (4) + USER_SUFFIX (4) = 28位
   */
  static generateWithUser(prefix: BizPrefix, userId: string): string {
    const timeStr = TimeHelper.formatForTransaction();
    const randomStr = this._generateRandomString(4); // 随机数缩短一点

    // 截取用户ID后4位 (不足补0)
    // 假设 userId 是 UUID 或 长数字
    //  推荐改：用 hash 取 4 位数字，分布更均匀、不可预测，但仍可路由
    const userSuffix = this._hashToDigits(userId, 4);

    return `${prefix}${timeStr}${randomStr}${userSuffix}`;
  }

  // ==========================================
  // Private Helpers
  // ==========================================

  /**
   * 把 userId 映射成固定长度数字串（用于分库路由）
   * 使用 DJB2 字符串哈希（非加密），兼容 Node.js 和浏览器环境
   * 注意：此 hash 仅用于路由/分表，非安全用途
   */
  private static _hashToDigits(input: string, len: number): string {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 33) ^ input.charCodeAt(i);
    }
    const n = Math.abs(hash) % 10 ** len;
    return n.toString().padStart(len, "0");
  }

  /**
   * 生成指定长度的纯数字随机串
   */
  private static _generateRandomString(len: number): string {
    // Math.random() 生成 0.123456...
    // 截取小数点后的数字，并补齐长度
    let str = "";
    while (str.length < len) {
      str += Math.random().toString().slice(2);
    }
    return str.slice(0, len);
  }
}
