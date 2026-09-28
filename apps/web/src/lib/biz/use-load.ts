'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data for a screen and exposes reload() for after edits. The effect only sets state in a
 * promise callback (react-hooks/set-state-in-effect), and ignores results after unmount.
 */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let alive = true;
    void loadRef.current().then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass the load inputs as deps
  }, deps);

  const reload = useCallback(async () => {
    setData(await loadRef.current());
  }, []);

  return { data, reload };
}
