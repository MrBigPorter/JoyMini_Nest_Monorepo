export const REVIEW_STATUS_VALUES = ['PENDING', 'REVIEWED', 'IGNORED'] as const;
export type FeedbackReviewStatus = (typeof REVIEW_STATUS_VALUES)[number];

export const FAILURE_KIND_VALUES = [
  'MODEL_ERROR',
  'SERVICE_ERROR',
  'EXPECTED_TRANSFER',
  'UNEXPECTED_TRANSFER',
  'USER_ABANDONED',
  'REPEATED_QUESTION',
  'KNOWLEDGE_GAP',
  'ROUTING',
  'PROMPT',
  'PRODUCT_GAP',
  'LANGUAGE',
  'UNKNOWN',
] as const;
export type FeedbackFailureKind = (typeof FAILURE_KIND_VALUES)[number];

export const RESOLUTION_VALUES = [
  'OPEN',
  'CONFIRMED',
  'EXCLUDED',
  'ADDED_TO_EVAL',
  'FIXED_PENDING_VERIFY',
  'CLOSED',
  'NO_ISSUE',
] as const;
export type FeedbackResolution = (typeof RESOLUTION_VALUES)[number];

export const SIGNAL_VALUES = [
  'transferred',
  'repeated_question',
  'abandoned',
] as const;
export type FeedbackSignal = (typeof SIGNAL_VALUES)[number];

export const QUEUE_VALUES = ['TODO', 'SIGNAL'] as const;
export type FeedbackQueue = (typeof QUEUE_VALUES)[number];

export interface FeedbackFilters {
  reviewStatus: '' | FeedbackReviewStatus;
  failureKind: '' | FeedbackFailureKind;
  resolution: '' | FeedbackResolution;
  signal: '' | FeedbackSignal;
  queue: '' | FeedbackQueue;
  from: string;
  to: string;
}

export const EMPTY_FEEDBACK_FILTERS: FeedbackFilters = {
  reviewStatus: '',
  failureKind: '',
  resolution: '',
  signal: '',
  queue: '',
  from: '',
  to: '',
};

function parseDate(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : '';
}

function pick<T extends readonly string[]>(
  values: T,
  raw: string | null,
): '' | T[number] {
  if (!raw) return '';
  return (values as readonly string[]).includes(raw) ? (raw as T[number]) : '';
}

/** 解析 URL 参数；非法值静默忽略，避免脏链接让页面报错。 */
export function parseFeedbackFilters(search: string): FeedbackFilters {
  const params = new URLSearchParams(search);
  return {
    reviewStatus: pick(
      REVIEW_STATUS_VALUES,
      params.get('reviewStatus'),
    ) as FeedbackFilters['reviewStatus'],
    failureKind: pick(
      FAILURE_KIND_VALUES,
      params.get('failureKind'),
    ) as FeedbackFilters['failureKind'],
    resolution: pick(
      RESOLUTION_VALUES,
      params.get('resolution'),
    ) as FeedbackFilters['resolution'],
    signal: pick(
      SIGNAL_VALUES,
      params.get('signal'),
    ) as FeedbackFilters['signal'],
    queue: pick(QUEUE_VALUES, params.get('queue')) as FeedbackFilters['queue'],
    from: parseDate(params.get('from')),
    to: parseDate(params.get('to')),
  };
}

/** 在现有参数上应用筛选；空值删除 key，保留无关参数。 */
export function applyFeedbackFilters(
  current: URLSearchParams,
  patch: Partial<FeedbackFilters>,
): URLSearchParams {
  const next = new URLSearchParams(current.toString());
  for (const key of [
    'reviewStatus',
    'failureKind',
    'resolution',
    'signal',
    'queue',
    'from',
    'to',
  ] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}

/** 单参数下钻链接：清空其他筛选，保证卡片数 = 列表数。 */
export function buildQualityHref(filters: Partial<FeedbackFilters>): string {
  const params = new URLSearchParams();
  for (const key of [
    'reviewStatus',
    'failureKind',
    'resolution',
    'signal',
    'queue',
    'from',
    'to',
  ] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/ai-ops/quality?${query}` : '/ai-ops/quality';
}

export function hasFeedbackFilters(filters: FeedbackFilters): boolean {
  return Boolean(
    filters.reviewStatus ||
    filters.failureKind ||
    filters.resolution ||
    filters.signal ||
    filters.queue ||
    filters.from ||
    filters.to,
  );
}
