import dayjs, { OpUnitType, QUnitType, Dayjs } from "dayjs";
import "./dayjs-setup";

// 环境检测（用 globalThis 避免在 lib 不含 DOM 的 TypeScript 项目中报 TS2304）
const IS_SERVER =
  typeof (globalThis as Record<string, unknown>)["window"] === "undefined";

// 格式常量池
export const DATE_FORMATS = {
  DATETIME: "YYYY-MM-DD HH:mm:ss",
  DATE: "YYYY-MM-DD",
  TIME: "HH:mm:ss",
  MONTH: "YYYY-MM",
  NO_YEAR: "MM-DD HH:mm",
  FILE_SAFE: "YYYYMMDD_HHmmss",
  TRANSACTION: "YYYYMMDDHHmmssSSS",
  PATH_DATE: "YYYY/MM/DD",
};

export type TimeRangeType =
  | "today"
  | "yesterday"
  | "week"
  | "lastWeek"
  | "last7days"
  | "last30days"
  | "month"
  | "lastMonth"
  | "quarter"
  | "year";

export class TimeHelper {
  // ==========================================
  //  国际化控制 (Client Only)
  // ==========================================

  static setLocale(lang: string) {
    if (IS_SERVER) return;
    dayjs.locale(lang);
  }

  // ==========================================
  // A. [展示类] 格式化 (String)
  // ==========================================

  static formatDateTime(val: any, placeholder = "-"): string {
    return this._format(val, DATE_FORMATS.DATETIME, placeholder);
  }

  static formatDate(val: any, placeholder = "-"): string {
    return this._format(val, DATE_FORMATS.DATE, placeholder);
  }

  static formatShort(val: any): string {
    return this._format(val, DATE_FORMATS.NO_YEAR);
  }

  static formatRelative(val: any, lang?: string): string {
    const d = this._toDayjs(val);
    if (!d) return "-";
    if (lang) return d.locale(lang).fromNow();
    if (IS_SERVER) return d.locale("en").fromNow();
    return d.fromNow();
  }

  static formatDuration(seconds: number): string {
    if (!seconds || seconds < 0) return "00:00:00";
    const d = dayjs.duration(seconds, "seconds");
    const H = Math.floor(d.asHours()).toString().padStart(2, "0");
    const m = d.minutes().toString().padStart(2, "0");
    const s = d.seconds().toString().padStart(2, "0");
    return `${H}:${m}:${s}`;
  }

  static formatForTransaction(): string {
    return dayjs().format(DATE_FORMATS.TRANSACTION);
  }

  // ==========================================
  // B. [安全与限流] 支付/后端核心逻辑
  // ==========================================

  /**
   * 判定目标时间是否早于当前时间的一定偏移量
   */
  static isOlderThan(val: any, amount: number, unit: OpUnitType): boolean {
    const d = this._toDayjs(val);
    if (!d) return false;
    // 使用 as any 解决 TypeScript 对 unit 类型的重载匹配问题
    return d.isBefore(dayjs().subtract(amount, unit as any));
  }

  /**
   * 判定是否处于冷却期
   */
  static isInCooldown(
    lastTime: any,
    amount: number,
    unit: OpUnitType = "second",
  ): boolean {
    const last = this._toDayjs(lastTime);
    if (!last) return false;
    // 同理，对 unit 进行类型断言
    return dayjs().isBefore(last.add(amount, unit as any));
  }

  /**
   * 获取剩余秒数 (用于 Redis TTL 或 支付倒计时)
   */
  static getRemainingSeconds(expireTime: any): number {
    const end = this._toDayjs(expireTime);
    if (!end) return 0;
    const diff = end.diff(dayjs(), "second");
    return diff > 0 ? diff : 0;
  }

  // ==========================================
  // C. [财务与报表] 对账与区间判定
  // ==========================================

  /**
   * 严格区间判定 (含边界)
   * 需要 dayjs-setup 中加载 isBetween 插件
   */
  static isWithinRange(target: any, start: any, end: any): boolean {
    const t = this._toDayjs(target);
    const s = this._toDayjs(start);
    const e = this._toDayjs(end);
    if (!t || !s || !e) return false;
    // @ts-ignore
    return t.isBetween(s, e, null, "[]");
  }

  /**
   * 生成日期序列
   */
  static generateDateSequence(start: any, end: any): string[] {
    let curr = this._toDayjs(start);
    const last = this._toDayjs(end);
    const dates: string[] = [];
    if (!curr || !last) return dates;
    while (curr.isBefore(last) || curr.isSame(last, "day")) {
      dates.push(curr.format(DATE_FORMATS.DATE));
      curr = curr.add(1, "day");
    }
    return dates;
  }

  /**
   * 判定两个时间段是否有重叠 (预约/排课校验)
   */
  static isOverlapping(
    r1: { s: any; e: any },
    r2: { s: any; e: any },
  ): boolean {
    const s1 = this._toDayjs(r1.s),
      e1 = this._toDayjs(r1.e);
    const s2 = this._toDayjs(r2.s),
      e2 = this._toDayjs(r2.e);
    if (!s1 || !e1 || !s2 || !e2) return false;
    return s1.isBefore(e2) && s2.isBefore(e1);
  }

  // ==========================================
  // D. [数据类] Prisma/Database 适配
  // ==========================================

  static toDate(val: any): Date | undefined {
    return this._toDayjs(val)?.toDate();
  }

  static getStartOfDay(val?: any): Date {
    return (this._toDayjs(val) || dayjs()).startOf("day").toDate();
  }

  static getEndOfDay(val?: any): Date {
    return (this._toDayjs(val) || dayjs()).endOf("day").toDate();
  }

  static getStartOf(unit: OpUnitType | QUnitType, val?: any): Date {
    return (this._toDayjs(val) || dayjs()).startOf(unit).toDate();
  }

  static getEndOf(unit: OpUnitType | QUnitType, val?: any): Date {
    return (this._toDayjs(val) || dayjs()).endOf(unit).toDate();
  }

  /**
   * 获取“过去多少时间”的时间点 (Date对象)
   * 用于 Prisma 查询，例如: createdAt: { gte: TimeHelper.getTimeAgo(3, 'second') }
   */
  static getTimeAgo(amount: number, unit: OpUnitType): Date {
    // 这里的 unit 需要断言一下类型，因为 dayjs 的类型定义有时候比较严格
    return dayjs()
      .subtract(amount, unit as any)
      .toDate();
  }

  // ==========================================
  // E. [业务逻辑] 日历/签到
  // ==========================================

  static getDaysInMonth(val: any): number {
    return (this._toDayjs(val) || dayjs()).daysInMonth();
  }

  static getFirstWeekDay(val: any): number {
    return (this._toDayjs(val) || dayjs()).startOf("month").day();
  }

  static isToday(val: any): boolean {
    const d = this._toDayjs(val);
    return d ? d.isSame(dayjs(), "day") : false;
  }

  static isYesterday(val: any): boolean {
    const d = this._toDayjs(val);
    return d ? d.isSame(dayjs().subtract(1, "day"), "day") : false;
  }

  static diffDays(from: any, to: any = new Date()): number {
    const d1 = this._toDayjs(from);
    const d2 = this._toDayjs(to);
    if (!d1 || !d2) return 0;
    return d2.startOf("day").diff(d1.startOf("day"), "day");
  }

  // ==========================================
  // F. [后台快捷查询]
  // ==========================================

  static getRange(type: TimeRangeType) {
    const now = dayjs();
    let start, end;
    switch (type) {
      case "today":
        start = now.startOf("day");
        end = now.endOf("day");
        break;
      case "yesterday":
        start = now.subtract(1, "day").startOf("day");
        end = now.subtract(1, "day").endOf("day");
        break;
      case "week":
        start = now.startOf("isoWeek");
        end = now.endOf("isoWeek");
        break;
      case "lastWeek":
        start = now.subtract(1, "week").startOf("isoWeek");
        end = now.subtract(1, "week").endOf("isoWeek");
        break;
      case "last7days":
        start = now.subtract(6, "day").startOf("day");
        end = now.endOf("day");
        break;
      case "last30days":
        start = now.subtract(29, "day").startOf("day");
        end = now.endOf("day");
        break;
      case "month":
        start = now.startOf("month");
        end = now.endOf("month");
        break;
      case "lastMonth":
        start = now.subtract(1, "month").startOf("month");
        end = now.subtract(1, "month").endOf("month");
        break;
      case "quarter":
        start = now.startOf("quarter");
        end = now.endOf("quarter");
        break;
      case "year":
        start = now.startOf("year");
        end = now.endOf("year");
        break;
      default:
        start = now.startOf("day");
        end = now.endOf("day");
    }
    return { gte: start.toDate(), lte: end.toDate() };
  }

  // ==========================================
  // G. 核心引擎 (iOS Safety Valve)
  // ==========================================

  private static _toDayjs(val: any): Dayjs | null {
    if (val === null || val === undefined || val === "") return null;
    if (typeof val === "string" && val.includes("-") && !val.includes("T")) {
      const d = dayjs(val);
      if (d.isValid()) return d;
      return dayjs(val.replace(/-/g, "/"));
    }
    const d = dayjs(val);
    return d.isValid() ? d : null;
  }

  private static _format(
    val: any,
    template: string,
    placeholder = "-",
  ): string {
    const d = this._toDayjs(val);
    if (!d) return placeholder;
    return d.format(template);
  }
}
