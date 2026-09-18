/**
 * Bounded-concurrency helpers for the scan scripts.
 *
 * A full-site scan runs two browser engines per page; doing that strictly
 * sequentially puts a 200-page property out of reach (~45-60s/page). These
 * helpers let the scripts run N pages at once while keeping results in input
 * order, so reports stay deterministic regardless of completion order.
 */

/** Clamp a user-supplied concurrency value to something sane. */
export function resolveConcurrency(value: string | number | undefined, max = 16): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(Math.floor(parsed), max);
}

/**
 * Map over `items` with at most `limit` tasks in flight.
 *
 * Results are returned in the order of `items`, not completion order. A worker
 * that throws rejects the whole run, so callers that want per-item resilience
 * should catch inside `fn` (which is what the scan scripts do — a page that
 * fails one engine still gets scanned by the other).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const effectiveLimit = Math.max(1, Math.min(Math.floor(limit), items.length));
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, () => worker()));
  return results;
}
