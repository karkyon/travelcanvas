/**
 * [Gate HomePlace] 自宅の場所を画面の間で共有する(1度だけ聞き、保存・削除したら全部の画面に伝える)。
 * enabled が false の間は聞かない(自宅を使わない日・画面では通信しない)。
 */
import { useEffect, useState } from 'react';
import { getHomePlace, type HomePlace } from '@/services/api/homePlace';

let cache: HomePlace | null = null;
let pending: Promise<HomePlace | null> | null = null;
const subs = new Set<(v: HomePlace | null) => void>();

export function setHomePlaceCache(v: HomePlace | null): void {
  cache = v;
  subs.forEach((f) => f(v));
}

export function loadHomePlace(force = false): Promise<HomePlace | null> {
  if (cache && !force) return Promise.resolve(cache);
  if (!pending || force) {
    pending = getHomePlace()
      .then((v) => { setHomePlaceCache(v); return v; })
      .catch(() => null)
      .finally(() => { pending = null; });
  }
  return pending;
}

export function resetHomePlaceForTests(): void {
  cache = null; pending = null; subs.clear();
}

export function useHomePlace(enabled = true): { home: HomePlace | null; loaded: boolean } {
  const [home, setHome] = useState<HomePlace | null>(cache);
  const [loaded, setLoaded] = useState<boolean>(cache !== null);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const f = (v: HomePlace | null) => { if (alive) { setHome(v); setLoaded(true); } };
    subs.add(f);
    void loadHomePlace().then((v) => { if (alive) { setHome(v); setLoaded(true); } });
    return () => { alive = false; subs.delete(f); };
  }, [enabled]);
  return { home: enabled ? home : null, loaded };
}
