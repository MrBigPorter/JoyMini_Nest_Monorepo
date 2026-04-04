'use client';

/**
 * ClientDate — 时区安全的日期渲染组件
 *
 * 问题：date-fns `format()` 使用本地时区。
 *   - 服务端（UTC）与浏览器（UTC+8 等）时区不同，导致 Hydration 不一致。
 *   - Next.js 官方文档明确将"用户本地时区的日期格式化"列为 hydration
 *     mismatch 的正常原因之一。
 *
 * 解决：mount 前（SSR）渲染 placeholder `—`，
 *       mount 后（Client）以浏览器本地时区格式化日期显示。
 *       `suppressHydrationWarning` 告知 React 忽略该节点的不一致警告。
 *
 * 使用示例：
 *   // Unix timestamp（秒）
 *   <ClientDate value={order.createdAt} unit="s" pattern="MM-dd HH:mm" />
 *
 *   // Unix timestamp（毫秒）
 *   <ClientDate value={Date.now()} unit="ms" pattern="MMMM d, yyyy" />
 *
 *   // ISO 字符串 / Date 对象
 *   <ClientDate value={new Date()} pattern="MM/dd HH:mm" />
 *
 *   // 当前日期（不传 value）
 *   <ClientDate pattern="MMMM d, yyyy" />
 */
import { useEffect, useState } from 'react';
import { format } from 'date-fns';

interface ClientDateProps {
  /** 日期值：Unix timestamp（秒/毫秒）、ISO 字符串、Date 对象。不传则取当前时间。 */
  value?: number | string | Date;
  /** value 为 Unix timestamp 时的单位，默认 'ms' */
  unit?: 's' | 'ms';
  /** date-fns 格式化模式，默认 'MM-dd HH:mm' */
  pattern?: string;
  /** mount 前显示的占位符，默认 '—' */
  placeholder?: string;
  className?: string;
}

export function ClientDate({
  value,
  unit = 'ms',
  pattern = 'MM-dd HH:mm',
  placeholder = '—',
  className,
}: ClientDateProps) {
  const [text, setText] = useState<string>(placeholder);

  useEffect(() => {
    let date: Date;
    if (value === undefined || value === null) {
      date = new Date();
    } else if (value instanceof Date) {
      date = value;
    } else if (typeof value === 'number') {
      date = new Date(unit === 's' ? value * 1000 : value);
    } else {
      date = new Date(value);
    }
    setText(isNaN(date.getTime()) ? placeholder : format(date, pattern));
  }, [value, unit, pattern, placeholder]);

  return (
    <span className={className} suppressHydrationWarning>
      {text}
    </span>
  );
}
