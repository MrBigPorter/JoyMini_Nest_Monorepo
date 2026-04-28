import { formatInTimeZone } from "date-fns-tz";

/**
 * Format a date string/timestamp in UTC timezone.
 *
 * This ensures consistent rendering between server (UTC) and client (any timezone),
 * preventing React hydration errors caused by timezone mismatches.
 *
 * @param date - ISO date string, Unix timestamp (number), or Date object
 * @param formatStr - date-fns format string (same tokens as `format`)
 * @returns Formatted date string in UTC
 *
 * @example
 * formatUTC('2026-04-21T13:40:09.000Z', 'MM/dd HH:mm:ss')
 * // => '04/21 13:40:09' (always UTC, regardless of client timezone)
 */
export function formatUTC(
  date: string | number | Date,
  formatStr: string,
): string {
  return formatInTimeZone(date, "UTC", formatStr);
}
