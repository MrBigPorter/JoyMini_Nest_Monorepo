// Constants for time calculations
const MILLISECONDS_PER_DAY = 1000 * 60 * 60 * 24;
const DAYS_IN_WEEK = 7;

// Cache for formatted time strings (key: timestamp + locale)
const timeFormatCache = new Map<string, string>();
const MAX_CACHE_SIZE = 1000;

/**
 * Clear cache when it exceeds maximum size
 */
function clearCacheIfNeeded(): void {
  if (timeFormatCache.size > MAX_CACHE_SIZE) {
    const keysToDelete = Array.from(timeFormatCache.keys()).slice(0, 200);
    keysToDelete.forEach((key) => timeFormatCache.delete(key));
  }
}

/**
 * Parse timestamp to Date object
 * @param timestamp - ISO string, Date object, or Unix timestamp (ms)
 * @returns Date object
 */
function parseTimestamp(timestamp: string | Date | number): Date {
  if (typeof timestamp === 'number') {
    return new Date(timestamp);
  } else if (typeof timestamp === 'string') {
    return new Date(timestamp);
  }
  return timestamp;
}

/**
 * Calculate days difference from now
 * @param date - Date to compare
 * @returns Number of days difference
 */
function getDaysDiff(date: Date): number {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return Math.floor(diffMs / MILLISECONDS_PER_DAY);
}

/**
 * Format message timestamp for display
 * @param timestamp - ISO string, Date object, or Unix timestamp (ms)
 * @returns Formatted time string (e.g., "10:30 AM" or "Yesterday 10:30 AM")
 */
export function formatMsgTime(timestamp: string | Date | number): string {
  const date = parseTimestamp(timestamp);
  const cacheKey = `msg_${date.getTime()}`;

  // Check cache first
  const cached = timeFormatCache.get(cacheKey);
  if (cached) return cached;

  const diffDays = getDaysDiff(date);
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  let result: string;
  if (diffDays === 0) {
    result = timeStr;
  } else if (diffDays === 1) {
    result = `Yesterday ${timeStr}`;
  } else if (diffDays < DAYS_IN_WEEK) {
    result = `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${timeStr}`;
  } else {
    result = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  // Cache the result
  clearCacheIfNeeded();
  timeFormatCache.set(cacheKey, result);

  return result;
}

/**
 * Format conversation timestamp for display
 * @param timestamp - ISO string, Date object, or Unix timestamp (ms)
 * @returns Formatted time string (e.g., "10:30 AM", "Yesterday", "Mon", "Jan 5")
 */
export function formatTime(timestamp: string | Date | number): string {
  const date = parseTimestamp(timestamp);
  const cacheKey = `conv_${date.getTime()}`;

  // Check cache first
  const cached = timeFormatCache.get(cacheKey);
  if (cached) return cached;

  const diffDays = getDaysDiff(date);
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  let result: string;
  if (diffDays === 0) {
    result = timeStr;
  } else if (diffDays === 1) {
    result = 'Yesterday';
  } else if (diffDays < DAYS_IN_WEEK) {
    result = date.toLocaleDateString('en-US', { weekday: 'short' });
  } else {
    result = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  // Cache the result
  clearCacheIfNeeded();
  timeFormatCache.set(cacheKey, result);

  return result;
}

// Cache for initials
const initialsCache = new Map<string, string>();

/**
 * Get initials from a name
 * @param name - Full name string
 * @returns Initials (e.g., "John Doe" -> "JD")
 */
export function getInitials(name: string): string {
  if (!name) return '';

  // Check cache first
  const cached = initialsCache.get(name);
  if (cached) return cached;

  const parts = name.trim().split(/\s+/);
  let result: string;

  if (parts.length === 1) {
    result = parts[0].charAt(0).toUpperCase();
  } else {
    result = parts
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('');
  }

  // Cache the result
  initialsCache.set(name, result);

  return result;
}

/**
 * Clear all caches (useful for testing or memory management)
 */
export function clearFormatCaches(): void {
  timeFormatCache.clear();
  initialsCache.clear();
}

/**
 * Get relative time string (e.g., "2 hours ago", "3 days ago")
 * @param timestamp - ISO string, Date object, or Unix timestamp (ms)
 * @returns Relative time string
 */
export function getRelativeTime(timestamp: string | Date | number): string {
  const date = parseTimestamp(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (seconds < 60) {
    return 'just now';
  } else if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  } else if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  } else if (days < 7) {
    return `${days} day${days === 1 ? '' : 's'} ago`;
  } else if (weeks < 4) {
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  } else if (months < 12) {
    return `${months} month${months === 1 ? '' : 's'} ago`;
  } else {
    return `${years} year${years === 1 ? '' : 's'} ago`;
  }
}

/**
 * Validate if a timestamp is valid
 * @param timestamp - Timestamp to validate
 * @returns True if valid, false otherwise
 */
export function isValidTimestamp(timestamp: string | Date | number): boolean {
  try {
    const date = parseTimestamp(timestamp);
    return !isNaN(date.getTime());
  } catch {
    return false;
  }
}
