/** [Gate PlanB] 旅程の画面: この日の案の一覧・開いている控えの案(予定・区間)・前後のつながりの要約 */
import { useCallback, useEffect, useState } from 'react';
import { mapDay } from '@/store/planStore';
import type { DaySchedule } from '@/types';
import type { TravelSegment } from '@/services/api/types/segments';
import { checkVariant, getVariant, listVariants, type VariantList, type VariantSummary } from '@/services/api/dayVariants';
import { getPlanCover } from '@/services/api/g11';

export interface OpenVariant { summary: VariantSummary; day: DaySchedule; segments: TravelSegment[] }

export function usePlanVariants(planId: string | undefined, revision: number | undefined, date: string | undefined) {
  const [list, setList] = useState<VariantList | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenVariant | null>(null);
  const [checkSum, setCheckSum] = useState<{ ok: number; warn: number; bad: number } | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  // 案を作る・切り替えるのは編集できる人だけ(表紙の API の can_edit と同じ判定)
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => {
    if (!planId) return undefined;
    let live = true;
    getPlanCover(planId).then((r) => { if (live) setCanEdit(r.can_edit); }).catch(() => { if (live) setCanEdit(false); });
    return () => { live = false; };
  }, [planId]);

  useEffect(() => {
    if (!planId) return undefined;
    let live = true;
    listVariants(planId).then((r) => { if (live) setList(r); }).catch(() => { if (live) setList(null); });
    return () => { live = false; };
  }, [planId, revision, tick]);
  // 日を変えたら今の案に戻る
  useEffect(() => { setOpenId(null); }, [date, planId]);
  const variants: VariantSummary[] = (date && list?.dates[date]) || [];
  const openSummary = variants.find((v) => v.day_id === openId && v.status !== 'active') ?? null;
  useEffect(() => {
    if (!planId || !openId) { setOpen(null); setCheckSum(null); return undefined; }
    let live = true;
    getVariant(planId, openId).then((r) => {
      if (!live) return;
      const day = mapDay(r.day as unknown as Parameters<typeof mapDay>[0]);
      setOpen({ summary: r.variant, day: { ...day, date: r.day.local_date }, segments: r.segments as unknown as TravelSegment[] });
    }).catch(() => { if (live) { setOpen(null); setOpenId(null); } });
    checkVariant(planId, openId).then((c) => { if (live) setCheckSum({ ok: c.counts.ok, warn: c.counts.warn, bad: c.counts.bad }); })
      .catch(() => { if (live) setCheckSum(null); });
    return () => { live = false; };
  }, [planId, openId, revision, tick]);
  // 開いていた案が今の案になった・消えた時は閉じる
  useEffect(() => {
    if (openId && list && date && !(list.dates[date] ?? []).some((v) => v.day_id === openId && v.status !== 'active')) setOpenId(null);
  }, [list, openId, date]);

  return { canEdit, variants, openId: openSummary ? openId : null, setOpenId, open: openSummary ? open : null, checkSum, reload,
    datesWithStandby: list ? Object.entries(list.dates).filter(([, vs]) => vs.some((v) => v.status === 'standby')).map(([d, vs]) => ({ date: d, variants: vs })) : [] };
}
