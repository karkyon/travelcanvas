/**
 * [Gate MockScreens] 旅行の中の画面(今日・旅行箱・共有など)で、旅行の題名・行き先・期間を読む。
 * 読んだ旅行は上の帯の旅行の切り替え(currentTripStore)へ写す(旅程の画面を経ずに開いた時も「旅行を選ぶ」にならない)。
 * 読めない時は題名を null のままにする(値を作らない)。
 */
import { useEffect, useState } from 'react';
import { travelAPI } from '@/services/api';
import { publishCurrentTrip, useCurrentTripStore } from '@/store/currentTripStore';

export interface TripContext {
  title: string | null;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
}

export function useTripContext(planId: string | undefined): TripContext {
  const trip = useCurrentTripStore((s) => s.trip);
  const [plan, setPlan] = useState<{ id: string; title?: string; destination?: string | null; start_date?: string | null; end_date?: string | null } | null>(null);
  useEffect(() => {
    if (!planId) return undefined;
    let alive = true;
    Promise.resolve()
      .then(() => travelAPI.getPlan(planId))
      .then((res) => {
        const p = res && res.success ? res.data : null;
        if (!alive || !p?.id) return;
        setPlan({ id: String(p.id), title: p.title, destination: p.destination ?? null, start_date: p.start_date ?? null, end_date: p.end_date ?? null });
        publishCurrentTrip(p);
      })
      .catch(() => { /* 読めなければ題名を出さない */ });
    return () => { alive = false; };
  }, [planId]);
  const known = plan && plan.id === planId ? plan : null;
  const fromStore = trip && trip.id === planId ? trip : null;
  return {
    title: known?.title || fromStore?.title || null,
    destination: known?.destination ?? null,
    startDate: known?.start_date ?? fromStore?.start_date ?? null,
    endDate: known?.end_date ?? fromStore?.end_date ?? null,
  };
}
