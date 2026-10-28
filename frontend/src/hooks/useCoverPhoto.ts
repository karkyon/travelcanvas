/**
 * [Gate G11] 旅行の表紙の写真を読む(GET /plans/{id}/cover/media を Blob → 一時の URL)。
 *
 * - 表紙が無い・読めない(権限なし・消えた・オフライン・形式の誤り)時は null を返し、画面は生成グラデーションの表紙になる
 * - 表紙を変えたら bumpCover(planId) で、同じ旅行の表紙を出している全ての画面(見出し・ダッシュボード・カード)を読み直す
 * - 一時の URL は使い終わったら片付ける(revokeObjectURL)
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { getPlanCoverMedia } from '@/services/api/g11';
import type { PlanCover } from '@/services/api/types/g11';
import type { TripCoverPhoto } from '@/components/trip/TripCover';

interface CoverVersions {
  versions: Record<string, number>;
  bump: (planId: string) => void;
}

export const useCoverVersions = create<CoverVersions>((set) => ({
  versions: {},
  bump: (planId) => set((s) => ({ versions: { ...s.versions, [planId]: (s.versions[planId] ?? 0) + 1 } })),
}));

export function bumpCover(planId: string): void {
  useCoverVersions.getState().bump(planId);
}

export function useCoverPhoto(planId: string | null | undefined, cover: PlanCover | null | undefined,
  alt = ''): { photo: TripCoverPhoto | null; failed: boolean; onError: () => void } {
  const version = useCoverVersions((s) => (planId ? s.versions[planId] ?? 0 : 0));
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const memoryId = cover?.memory_id ?? null;
  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (!planId || !memoryId) return undefined;
    let active = true;
    let objectUrl: string | null = null;
    getPlanCoverMedia(planId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [planId, memoryId, version]);
  const photo = url && cover && !failed
    ? { src: url, focusX: cover.focus_x, focusY: cover.focus_y, zoom: cover.zoom, alt, credit: creditOf(cover.source) }
    : null;
  return { photo, failed, onError: () => setFailed(true) };
}

/** 外部の写真の出典の表示(作者・ライセンス。表示の義務があるもの)。手で上げた写真は null */
export function creditOf(source: Record<string, unknown> | null | undefined): string | null {
  if (!source || source.kind !== 'external') return null;
  const author = typeof source.author === 'string' ? source.author : null;
  const license = typeof source.license === 'string' ? source.license : null;
  const provider = typeof source.provider === 'string' ? source.provider : null;
  const parts = [author ? `写真: ${author}` : null, license, provider === 'wikimedia_commons' ? 'Wikimedia Commons' : provider];
  const text = parts.filter(Boolean).join(' / ');
  return text || null;
}
