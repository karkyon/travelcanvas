/**
 * [Gate TDay-Mock] 旅の当日の画面で使う計算・取得(部品から切り離した関数とフック)。
 */
import { useCallback, useEffect, useState } from 'react';
import type { TodayEvent } from '@/services/api';
import { getEta, putEta, type EtaShare } from '@/services/api/travelDay';
import { safeExternalUrl } from '@/utils/safeNavigation';
import { mapUrl } from '../todayModel';
import { distanceKm, hourAt, localHm, modeWord } from './todayLive';
import type { TodayCtx } from './todayCtx';

/** 予約の状態の言葉(guide.bookings から。無ければ予定の予約の有無) */
export function bookingPill(ctx: TodayCtx, e: TodayEvent): { text: string; tone: 'good' | 'warn' } | null {
  const b = ctx.guide?.bookings?.[e.id];
  if (b?.state === 'issue') return { text: '予約 要確認', tone: 'warn' };
  if (b?.state === 'booked') return { text: '予約済み', tone: 'good' };
  if (e.has_ticket) return { text: 'チケットあり', tone: 'good' };
  if (e.reservation_id) return { text: '予約 あり', tone: 'good' };
  return null;
}

/** 着く頃の天気(1時間ごとの予報。無ければ一日の言葉と最高気温) */
export function arriveSky(ctx: TodayCtx, e: TodayEvent): { text: string; rainy: boolean } | null {
  const h = hourAt(ctx.hours, localHm(e.start_at, ctx.timeZone));
  if (h?.rainy) return { text: `雨 ${h.probability ?? ''}%`.trim(), rainy: true };
  const head = [ctx.sky?.label, ctx.sky?.tempMax != null ? `${Math.round(ctx.sky.tempMax)}°` : null].filter(Boolean).join(' ');
  if (head) return { text: head, rainy: false };
  if (h?.probability != null) return { text: `降水 ${h.probability}%`, rainy: false };
  return null;
}

/** 「徒歩 約12分（概算）」 */
export function travelShort(ctx: TodayCtx, e: TodayEvent | null): string | null {
  if (!e) return null;
  const g = ctx.gEvents[e.id];
  const min = g?.travel_minutes ?? null;
  if (min == null) return null;
  return `${modeWord(g?.travel_mode ?? e.transport_mode)} 約${min}分${g?.travel_source === 'estimate' ? '（概算）' : ''}`;
}

export function useCrew(planId: string, offline: boolean) {
  const [shares, setShares] = useState<EtaShare[] | null>(null);
  const [maxHours, setMaxHours] = useState(12);
  const load = useCallback(async () => {
    try {
      const r = await getEta(planId);
      setShares(r.shares);
      setMaxHours(r.max_hours || 12);
    } catch {
      setShares((s) => s ?? []);
    }
  }, [planId]);
  useEffect(() => {
    if (offline) return;
    void load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [load, offline]);
  return { shares, setShares, load, maxHours };
}

/** 到着予定を共有する(今日の終わりか 12 時間まで) */
export async function shareMyEta(ctx: TodayCtx): Promise<EtaShare[]> {
  const e = ctx.nextEv;
  const go = ctx.go;
  if (!e) throw new Error('次の予定がありません');
  const arrive = go?.expectedArrivalMs ?? (e.start_at ? Date.parse(e.start_at) : Date.now());
  const end = ctx.data.day_end_at ? Date.parse(ctx.data.day_end_at) : Date.now() + 12 * 3600_000;
  const until = Math.max(Math.min(end, Date.now() + 12 * 3600_000), Date.now() + 3600_000);
  return (await putEta(ctx.planId, { event_id: e.id, arrive_at: new Date(arrive).toISOString(),
    until: new Date(until).toISOString() })).shares;
}

/** 外の地図アプリで案内(座標か住所から) */
export function openGuide(e: { latitude: number | null; longitude: number | null; address: string | null; title?: string } | null): void {
  if (!e) return;
  const url = mapUrl(e as TodayEvent)
    ?? (e.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.address)}` : null);
  const safe = safeExternalUrl(url ?? '');
  if (safe) window.open(safe, '_blank', 'noopener,noreferrer');
}

/** 今日の予約の数と「要確認」の数 */
export function ticketCount(ctx: TodayCtx): { total: number; issues: number } {
  let total = 0;
  let issues = 0;
  for (const e of ctx.events) {
    const b = ctx.guide?.bookings?.[e.id];
    if (b) {
      total += Math.max(1, b.reservations.length);
      if (b.state === 'issue') issues += 1;
    } else if (e.reservation_id) total += 1;
  }
  return { total, issues };
}

export interface TicketTab { key: string; eventId: string; resId: string; label: string; issue: boolean; start: string | null; guests: number | null; type: string }

export function ticketTabs(ctx: TodayCtx): TicketTab[] {
  const out: TicketTab[] = [];
  for (const e of ctx.events) {
    const b = ctx.guide?.bookings?.[e.id];
    if (b && b.reservations.length > 0) {
      for (const r of b.reservations) {
        out.push({ key: r.id, eventId: e.id, resId: r.id, label: r.type_label || e.title, issue: b.state === 'issue', start: r.start ?? e.start_at,
          guests: r.guest_count, type: r.type_label });
      }
    } else if (e.reservation_id) {
      out.push({ key: e.reservation_id, eventId: e.id, resId: e.reservation_id, label: e.title, issue: false, start: e.start_at, guests: null, type: '予約' });
    }
  }
  return out;
}

export function homeRoute(ctx: TodayCtx, me: [number, number] | null) {
  const l = ctx.lodging;
  if (!l || l.latitude == null || l.longitude == null) return null;
  const visited = ctx.events.filter((e) => (ctx.visitedIds.has(e.id) || ctx.doneIds.has(e.id)) && e.latitude != null && e.id !== l.event_id);
  const base: TodayEvent | null = ctx.nowEv && ctx.nowEv.latitude != null ? ctx.nowEv : visited[visited.length - 1] ?? null;
  const from = me ? { latitude: me[0], longitude: me[1], title: '今いる場所' }
    : base ? { latitude: base.latitude, longitude: base.longitude, title: base.title } : null;
  if (!from || from.latitude == null || from.longitude == null) return null;
  const km = distanceKm(from, l) ?? 0;
  const walk = Math.max(3, Math.round((km * 1.3 / 4.5) * 60));
  const taxi = Math.max(3, Math.round((km * 1.3 / 25) * 60) + 2);
  return { from, km, walk, taxi };
}
