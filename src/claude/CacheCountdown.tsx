import { useEffect, useState } from "react";

import { cacheCountdown, cacheTick, type CacheState } from "./cache";

/** On an idle Claude tab: how long the prompt cache stays warm, then "cold". */
export function CacheCountdown({ cache }: { cache: CacheState }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setTimeout(() => setNow(Date.now()), cacheTick(cache, now));
    return () => window.clearTimeout(timer);
  }, [cache, now]);
  const countdown = cacheCountdown(cache, now);
  if (!countdown) return null;
  return (
    <span
      className={`tab-cache${countdown.cold ? " cold" : ""}`}
      role="timer"
      title={countdown.title}
      aria-label={countdown.cold ? "Claude's prompt cache is cold" : `Claude's prompt cache stays warm for ${countdown.text}`}
    >
      {countdown.cold ? "cold" : `⏱${countdown.text}`}
    </span>
  );
}
