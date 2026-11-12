/**
 * [Gate TDay] 当日の手がかり(guide)と空模様(天気の予報)を取りに行く。
 * - guide: 2分ごと(出る時刻・すきま時間・旅帖の印)。印を押した・寄り道を足した時はすぐ取り直す
 * - 天気: 15分ごと(Open-Meteo の値は backend が1時間覚えている)
 * 通信できない時は直前の値を表示し続ける(当日の NOW/NEXT は todayModel の保存から出る)。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getTodayGuide, type TodayGuide } from '@/services/api/travelDay';
import { getWeather, type Forecast } from '@/services/api/dayVariants';
import type { SkyHour } from './todayLive';

const GUIDE_MS = 120_000;
const WEATHER_MS = 15 * 60_000;
const CACHE = 'tc.today.guide.';

export interface SkyState {
  hours: SkyHour[]; affected: { event_id: string; title: string; time: string }[]; hasRainVariant: boolean;
  label: string | null; tempMax: number | null; tempMin: number | null; source: string;
}

function readCache(planId: string): TodayGuide | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE + planId);
    return raw ? (JSON.parse(raw) as TodayGuide) : null;
  } catch {
    return null;
  }
}

export function useTodayLive(planId: string | undefined, date: string | null, offline: boolean) {
  const [guide, setGuide] = useState<TodayGuide | null>(() => (planId ? readCache(planId) : null));
  const [sky, setSky] = useState<SkyState | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const reloadGuide = useCallback(async () => {
    if (!planId) return;
    try {
      const g = await getTodayGuide(planId);
      if (!alive.current) return;
      setGuide(g);
      try {
        // 電話番号などを含むため、この画面を開いている間(タブを閉じるまで)だけ覚える
        window.sessionStorage.setItem(CACHE + planId, JSON.stringify(g));
      } catch {
        // 保存できなくても表示は続ける
      }
    } catch {
      // 取れない時は直前の値のまま
    }
  }, [planId]);

  const reloadSky = useCallback(async () => {
    if (!planId || !date) return;
    try {
      const w = await getWeather(planId, date);
      const f = (w.forecasts.find((x) => x.date === date) ?? null) as (Forecast & { hours?: SkyHour[] }) | null;
      if (!alive.current) return;
      setSky(f ? {
        hours: Array.isArray(f.hours) ? f.hours.map((h) => ({ hour: h.hour, probability: h.probability ?? null, rainy: !!h.rainy })) : [],
        affected: (f.affected_events ?? []).map((a) => ({ event_id: a.event_id, title: a.title, time: a.time })),
        hasRainVariant: !!f.has_rain_variant, label: f.label ?? null, tempMax: f.temp_max ?? null, tempMin: f.temp_min ?? null,
        source: f.source || 'Open-Meteo',
      } : null);
    } catch {
      // 天気は無くてもよい
    }
  }, [planId, date]);

  useEffect(() => {
    if (offline) return;
    void reloadGuide();
    const t = window.setInterval(reloadGuide, GUIDE_MS);
    return () => window.clearInterval(t);
  }, [reloadGuide, offline]);

  useEffect(() => {
    if (offline) return;
    void reloadSky();
    const t = window.setInterval(reloadSky, WEATHER_MS);
    return () => window.clearInterval(t);
  }, [reloadSky, offline]);

  return { guide, sky, reloadGuide };
}
