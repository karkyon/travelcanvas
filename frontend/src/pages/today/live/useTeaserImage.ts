/**
 * [Gate TDay] 次の場所の画像: 予定に選んだ写真(自分・同行者の記録)を優先し、無ければ Wikipedia の記事の代表画像(出典つき)。
 */
import { useEffect, useState } from 'react';
import { getMemoryThumbnail } from '@/services/api/photoFeatures';
import { getAreaImages } from '@/services/api/tripIntent';

const areaCache = new Map<string, { url: string; page_url: string } | null>();

export function useTeaserImage(planId: string, title: string, memoryId: string | null) {
  const [img, setImg] = useState<{ url: string; credit: string | null; href: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setImg(null);
    (async () => {
      if (memoryId) {
        try {
          const blob = await getMemoryThumbnail(planId, memoryId);
          objectUrl = URL.createObjectURL(blob);
          if (alive) setImg({ url: objectUrl, credit: '自分たちの写真', href: null });
          return;
        } catch {
          // 写真を取れなければ代表画像へ
        }
      }
      const key = title.trim().slice(0, 40);
      if (!key) return;
      try {
        if (!areaCache.has(key)) {
          const got = await getAreaImages([key]);
          const v = got[key];
          areaCache.set(key, v ? { url: v.url, page_url: v.page_url } : null);
        }
        const hit = areaCache.get(key);
        if (alive && hit) setImg({ url: hit.url, credit: '画像: Wikipedia', href: hit.page_url });
      } catch {
        // 画像は無くてもよい
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [planId, title, memoryId]);
  return img;
}

