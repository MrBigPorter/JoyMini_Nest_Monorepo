/**
 * Merge a fresh newest-page poll into the already loaded history.
 * Keeps older pages the operator loaded, updates changed messages by id,
 * and sorts by seqId when available.
 */
export function mergeChatMessages<
  T extends { id: string; seqId?: number | null },
>(previous: T[], incoming: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of previous) byId.set(item.id, item);
  for (const item of incoming) {
    byId.set(item.id, { ...(byId.get(item.id) ?? {}), ...item } as T);
  }
  return [...byId.values()].sort((a, b) => (a.seqId ?? 0) - (b.seqId ?? 0));
}
