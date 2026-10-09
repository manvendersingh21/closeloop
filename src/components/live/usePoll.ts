"use client";

import { useEffect, useRef, useState } from "react";

export type PollState<T> = {
  data: T | null;
  /** HTTP status of the last response (0 = network error, null = not yet fetched). */
  httpStatus: number | null;
  /** True when the last attempt failed but earlier data is still shown. */
  stale: boolean;
  lastUpdated: number | null;
};

/**
 * Polls `url` every `intervalMs` until `shouldStop(data)` returns true or the
 * server answers 404. Requests never overlap (the next one is scheduled after
 * the previous finishes) and are aborted on unmount.
 */
export function usePoll<T>(
  url: string,
  intervalMs: number,
  shouldStop?: (data: T) => boolean,
): PollState<T> {
  const [state, setState] = useState<PollState<T>>({
    data: null,
    httpStatus: null,
    stale: false,
    lastUpdated: null,
  });
  const stopRef = useRef(shouldStop);
  useEffect(() => {
    stopRef.current = shouldStop;
  }, [shouldStop]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();

    const tick = async () => {
      let keepGoing = true;
      try {
        const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
        if (cancelled) return;
        if (res.status === 404) {
          keepGoing = false;
          setState({ data: null, httpStatus: 404, stale: false, lastUpdated: Date.now() });
        } else if (!res.ok) {
          setState((s) => ({ ...s, httpStatus: res.status, stale: s.data !== null }));
        } else {
          const data = (await res.json()) as T;
          if (cancelled) return;
          if (stopRef.current?.(data)) keepGoing = false;
          setState({ data, httpStatus: res.status, stale: false, lastUpdated: Date.now() });
        }
      } catch {
        if (cancelled) return;
        setState((s) => ({ ...s, httpStatus: 0, stale: s.data !== null }));
      }
      if (!cancelled && keepGoing) timer = setTimeout(tick, intervalMs);
    };

    void tick();
    return () => {
      cancelled = true;
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [url, intervalMs]);

  return state;
}
