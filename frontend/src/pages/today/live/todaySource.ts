/**
 * [Gate TDay-Live2] 旅の当日の「出どころ」と「変化の知らせ」の計算(部品から切り離した関数)。
 */
import type { TodayEvent } from '@/services/api';
import { formatTimeInZone } from '../todayModel';
import { hoursLabel, modeWord, rainWindow } from './todayLive';
import type { TodayCtx, TodayScreen } from './todayCtx';

const hm = (iso: string | null | undefined, tz: string | null) => formatTimeInZone(iso ?? null, tz);

// ---- 移動時間の出どころ ------------------------------------------------------------------------------------------

export type SourceKind = 'api' | 'manual' | 'seg' | 'est' | 'none';
export const SOURCE_WORD: Record<SourceKind, string> = {
  api: '実時刻', manual: '手入力', seg: '登録した移動', est: '概算', none: '不明',
};
export const SOURCE_LETTER: Record<SourceKind, string> = { api: '実', manual: '手', seg: '登', est: '概', none: '!' };

/** guide の travel_source を出どころの種類へ(実時刻は交通の情報サービスから取った時だけ。今は登録・手入力・概算) */
export function sourceKind(src: string | null | undefined, minutes: number | null | undefined): SourceKind {
  if (minutes == null) return 'none';
  if (src === 'manual') return 'manual';
  if (src === 'segment') return 'seg';
  if (src === 'estimate') return 'est';
  if (src === 'provider' || src === 'api') return 'api';
  return 'none';
}

/** 次の予定へ向かう移動の出どころと文(「登録した移動 ・ 徒歩 約5分」) */
export function travelSource(ctx: TodayCtx, e: TodayEvent | null): { kind: SourceKind; text: string } {
  if (!e) return { kind: 'none', text: '所要が分かりません' };
  const g = ctx.gEvents[e.id];
  const min = g?.travel_minutes ?? null;
  const kind = sourceKind(g?.travel_source, min);
  if (min == null) return { kind, text: '所要が分かりません' };
  const word = kind === 'est' ? '距離からの概算' : SOURCE_WORD[kind];
  return { kind, text: `${word} ・ ${modeWord(g?.travel_mode ?? e.transport_mode)} 約${min}分` };
}

export function hasBookingFor(ctx: TodayCtx, e: TodayEvent): boolean {
  return !!(ctx.guide?.bookings?.[e.id] || e.reservation_id || e.has_ticket);
}

// ---- 変化の知らせ ------------------------------------------------------------------------------------------------

export interface ChangeItem { key: string; tone: 'rain' | 'delay' | 'warn'; icon: 'alert' | 'ticket' | 'rain'; title: string; body: string; meta: string[];
  action: string; screen: TodayScreen; arg?: string | null; testId?: string }

export function changeItems(ctx: TodayCtx): ChangeItem[] {
  const out: ChangeItem[] = [];
  const later = ctx.events.filter((e) => !ctx.doneIds.has(e.id) && !ctx.visitedIds.has(e.id));
  for (const e of later) {
    if (e.transport_status === 'delayed' || e.transport_status === 'cancelled') {
      out.push({
        key: `t:${e.id}`, tone: 'delay', icon: 'alert',
        title: `${e.title}へ向かう移動が${e.transport_status === 'cancelled' ? '運休' : '遅れています'}`,
        body: '経路の区間に登録された状態です。交通の最新の運行情報を取得済みとは限りません。',
        meta: [`対象 ${hm(e.start_at, ctx.timeZone)} ${e.title}`, '出どころ 登録した区間'],
        action: '対応の案を見る', screen: 'delay', testId: 'today-change-delay',
      });
    }
  }
  for (const e of later) {
    const h = ctx.gEvents[e.id]?.hours;
    if (h && (h.status === 'closed' || h.status === 'closes_during' || h.status === 'last_entry' || h.status === 'last_order')) {
      const lbl = hoursLabel(h.status, h.minutes_to_close);
      out.push({
        key: `h:${e.id}`, tone: 'warn', icon: 'alert',
        title: `${hm(e.start_at, ctx.timeZone)} ${e.title}：${lbl?.text ?? '営業時間に注意'}`,
        body: `${h.window_label ? `営業 ${h.window_label}。` : ''}営業時間は旅程の値と照合した結果です。臨時休業は確認していません。`,
        meta: [h.estimated ? '営業時間 推定' : '営業時間 登録・取得した値', ...(h.stale ? ['情報が古い可能性'] : [])],
        action: '対応の案を見る', screen: 'delay', testId: 'today-change-hours',
      });
      break;
    }
  }
  const nx = ctx.nextEv;
  if (nx && ctx.guide?.bookings?.[nx.id]?.state === 'issue') {
    out.push({
      key: `b:${nx.id}`, tone: 'warn', icon: 'ticket',
      title: `${nx.title}の予約に要確認があります`, body: (ctx.guide.bookings[nx.id]?.issues ?? []).join('・') || '予約の内容を確かめてください。',
      meta: ['出どころ 登録した予約'], action: '予約を見る', screen: 'ticket', arg: nx.id, testId: 'today-change-booking',
    });
  }
  const w = rainWindow(ctx.hours, ctx.nowHour);
  const rain = ctx.upcomingRain;
  if (w && rain) {
    const fetched = ctx.sky?.fetchedAt ? hm(new Date(ctx.sky.fetchedAt).toISOString(), ctx.timeZone) : null;
    out.push({
      key: `r:${rain.id}`, tone: 'rain', icon: 'rain',
      title: `${w.start}〜${w.end}時 雨の可能性 最大${w.max}% ・ ${rain.title}（屋外）にかかる`,
      body: `${hm(rain.start_at, ctx.timeZone)} ${rain.title}。${ctx.sky?.hasRainVariant ? '控えの案(プランB)と比べてから切り替えられます。' : '屋内の案を作れます。'}`,
      meta: [`予報 ${ctx.sky?.source ?? 'Open-Meteo'}（1時間ごと）`, `対象 ${w.start}〜${w.end}時`, ...(fetched ? [`取得 ${fetched}`] : []), '予報で、確定ではありません'],
      action: '影響とプランBを比べる', screen: 'rain', testId: 'today-rain',
    });
  }
  return out;
}

/** 地図の上に選んだ場所のカードを重ねる幅か(それより狭い時は地図の画面を開く) */
export function overlayWidth(): boolean {
  try { return window.matchMedia('(min-width: 640px)').matches; } catch { return false; }
}
