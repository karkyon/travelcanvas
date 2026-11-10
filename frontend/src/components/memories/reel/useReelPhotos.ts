/**
 * [Gate MemoryReel] リールの写真を、今のコマと次のコマの分だけ読む(全部を一度に読まない)。
 * 読んだ写真は旅行を切り替えるか画面を閉じるまで覚え、その時に一時 URL を消す。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getMemoryMedia } from '@/services/api';

export type PhotoState = string | 'loading' | 'failed';

export function useReelPhotos(planId: string, ids: (string | null)[], index: number): (id: string | null) => PhotoState | null {
  const cache = useRef(new Map<string, string>());
  const failed = useRef(new Set<string>());
  const pending = useRef(new Set<string>());
  const current = useRef(planId);
  const [, setVersion] = useState(0);

  // 旅行を切り替えた・閉じた時に、読んだ写真の一時 URL を消す
  useEffect(() => {
    current.current = planId;
    const urls = cache.current;
    const bad = failed.current;
    const wait = pending.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
      bad.clear();
      wait.clear();
    };
  }, [planId]);

  const key = ids.join(',');
  useEffect(() => {
    if (ids.length === 0) return;
    const want = [ids[index], ids[(index + 1) % ids.length]].filter((v): v is string => Boolean(v));
    for (const id of want) {
      if (cache.current.has(id) || failed.current.has(id) || pending.current.has(id)) continue;
      pending.current.add(id);
      const forPlan = planId;
      getMemoryMedia(forPlan, id)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          if (current.current !== forPlan) { URL.revokeObjectURL(url); return; }
          cache.current.set(id, url);
        })
        .catch(() => { if (current.current === forPlan) failed.current.add(id); })
        .finally(() => {
          if (current.current !== forPlan) return;
          pending.current.delete(id);
          setVersion((v) => v + 1);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 写真の組(key)・旅行・今のコマが変わった時だけ
  }, [planId, key, index]);

  return useCallback((id: string | null): PhotoState | null => {
    if (!id) return null;
    if (failed.current.has(id)) return 'failed';
    return cache.current.get(id) ?? 'loading';
  }, []);
}
