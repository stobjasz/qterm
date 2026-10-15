// Claude Code's prompt cache, from its status line: while it is warm, the next
// message re-reads the conversation cheaply; once it goes cold, the whole context is
// sent again at full price. Idle Claude tabs count down to that moment.

export interface CacheState {
  warm: boolean;
  /** Unix seconds when the cached prefix goes cold. */
  expiresAt: number | null;
}

export interface CacheCountdown {
  /** "4m", "42s" or "cold". */
  text: string;
  cold: boolean;
  /** The tooltip, saying why it matters. */
  title: string;
}

/** What an idle tab shows for its session's cache at `nowMs`; undefined when unknown. */
export function cacheCountdown(cache: CacheState | undefined, nowMs: number): CacheCountdown | undefined {
  if (!cache) return undefined;
  const left = cache.expiresAt === null ? undefined : Math.floor(cache.expiresAt - nowMs / 1000);
  if (!cache.warm || (left !== undefined && left <= 0)) {
    return {
      text: "cold",
      cold: true,
      title: "Claude's prompt cache has expired: the next message sends the whole conversation again, which costs more and uses more of your plan.",
    };
  }
  if (left === undefined) return undefined;
  const text = left >= 60 ? `${Math.ceil(left / 60)}m` : `${left}s`;
  const when = left >= 60 ? `${Math.ceil(left / 60)} min` : `${left} s`;
  return {
    text,
    cold: false,
    title: `Claude's prompt cache stays warm for ${when}: replying before then is cheaper than after.`,
  };
}

/** How often a countdown needs redrawing: every second in the last minute, else every 15 s. */
export function cacheTick(cache: CacheState, nowMs: number): number {
  const left = (cache.expiresAt ?? 0) - nowMs / 1000;
  return left > 0 && left <= 60 ? 1000 : 15_000;
}
