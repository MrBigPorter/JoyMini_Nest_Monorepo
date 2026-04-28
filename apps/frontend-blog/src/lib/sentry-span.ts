import * as Sentry from '@sentry/nextjs';
import { SENTRY_SPAN_OP } from '@/lib/sentry-span-constants';

type SpanAttrValue = string | number | boolean | null | undefined;

export interface AppSpanOptions {
  name: string;
  op: string;
  attributes?: Record<string, SpanAttrValue>;
}

function cleanAttributes(
  attributes?: Record<string, SpanAttrValue>,
): Record<string, string | number | boolean> | undefined {
  if (!attributes) return undefined;

  const cleaned = Object.fromEntries(
    Object.entries(attributes).filter(
      ([, value]) => value !== undefined && value !== null,
    ),
  ) as Record<string, string | number | boolean>;

  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

export async function withAppSpan<T>(
  options: AppSpanOptions,
  fn: () => Promise<T>,
): Promise<T> {
  return Sentry.startSpan(
    {
      name: options.name,
      op: options.op,
      attributes: cleanAttributes(options.attributes),
    },
    fn,
  );
}

export async function withSsrSpan<T>(
  name: string,
  attributes: AppSpanOptions['attributes'],
  fn: () => Promise<T>,
): Promise<T> {
  return withAppSpan({ name, op: SENTRY_SPAN_OP.HTTP_SERVER, attributes }, fn);
}

export async function withUiActionSpan<T>(
  name: string,
  attributes: AppSpanOptions['attributes'],
  fn: () => Promise<T>,
): Promise<T> {
  return withAppSpan({ name, op: SENTRY_SPAN_OP.UI_ACTION, attributes }, fn);
}

export async function withHttpClientSpan<T>(
  name: string,
  attributes: AppSpanOptions['attributes'],
  fn: () => Promise<T>,
): Promise<T> {
  return withAppSpan({ name, op: SENTRY_SPAN_OP.HTTP_CLIENT, attributes }, fn);
}
