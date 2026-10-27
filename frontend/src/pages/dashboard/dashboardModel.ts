/**
 * [Gate G9] UX-4 文脈型ダッシュボードの表示の決まり(純粋関数。dashboardModel.test.ts で確かめる)。
 *
 * 最上段は「次に何をすべきか」: 旅行が無い → 旅行を始める / 旅行前 → 準備・予約の期限・警告 / 旅行中 → NOW/NEXT・
 * 移動・チケット・遅延 / 旅行後 → 精算・記録・訪問の確認・振り返り。操作は文脈ごとに最大4つで、権限の無い操作は出さない。
 */
import type { DashboardEvent, DashboardTrip, TripPhase, TripRole } from '@/services/api/types/g9';

export const PHASE_LABEL: Record<TripPhase, string> = {
  ongoing: '旅行中', upcoming: '旅行前', past: '旅行後', undated: '日付未定',
};

export const ROLE_LABEL: Record<TripRole, string> = { owner: '所有者', editor: '編集者', viewer: '閲覧のみ' };

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];

/** 'YYYY-MM-DD' を「11/4(水)」に(タイムゾーンに依らない。日付だけを読む) */
export function shortDate(iso: string | null | undefined, withYear = false): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const wd = WEEKDAY[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${withYear ? `${y}/` : ''}${mo}/${d}(${wd})`;
}

/** 旅行の期間の表示(日付が無ければ「日付未定」) */
export function tripDateLabel(t: Pick<DashboardTrip, 'start_date' | 'end_date' | 'total_days'>): string {
  const s = shortDate(t.start_date, true);
  if (!s) return '日付未定';
  const e = t.end_date && t.end_date !== t.start_date ? shortDate(t.end_date) : null;
  const days = t.total_days ? `・${t.total_days}日間` : '';
  return e ? `${s}〜${e}${days}` : `${s}${days}`;
}

/** 段階ごとの短い状況(あと何日・何日目・何日前) */
export function statusLabel(t: DashboardTrip): string {
  switch (t.phase) {
    case 'upcoming':
      return t.days_until_start === 1 ? '明日から' : `あと${t.days_until_start ?? '?'}日`;
    case 'ongoing':
      return t.total_days ? `${t.day_number ?? 1}日目 / ${t.total_days}日` : `${t.day_number ?? 1}日目`;
    case 'past':
      return t.days_since_end === 0 ? '今日まで' : `${t.days_since_end ?? '?'}日前に終了`;
    default:
      return '日程を決めましょう';
  }
}

/** 予定の時刻の表示(現地の時刻。local_start_time を優先し、無ければ start_at を旅行のタイムゾーンで) */
export function eventTime(ev: Pick<DashboardEvent, 'local_start_time' | 'start_at'> | null, timeZone: string | null): string | null {
  if (!ev) return null;
  if (ev.local_start_time) return ev.local_start_time.slice(0, 5);
  if (!ev.start_at) return null;
  const d = new Date(ev.start_at);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timeZone || undefined })
      .format(d);
  } catch {
    return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  }
}

/** 「あと1時間59分」 */
export function minutesLabel(min: number | null): string | null {
  if (min === null || min === undefined || min < 0) return null;
  if (min < 60) return `あと${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `あと${h}時間${m}分` : `あと${h}時間`;
}

export const TRANSPORT_STATUS_LABEL: Record<string, string> = {
  on_time: '平常', delayed: '遅れ', cancelled: '運休', unknown: '運行の情報なし',
};

export interface QuickAction {
  key: string;
  label: string;
  to: string;
}

type Need = 'any' | 'edit' | 'owner';

const ACTIONS: Record<TripPhase, Array<{ key: string; label: string; path: string; need: Need }>> = {
  ongoing: [
    { key: 'today', label: '今日の予定', path: '/today', need: 'any' },
    { key: 'reservations', label: '予約・チケット', path: '/reservations', need: 'any' },
    { key: 'alerts', label: '遅延・休業の対応', path: '/alerts', need: 'any' },
    { key: 'planner', label: '旅程を開く', path: '', need: 'any' },
  ],
  upcoming: [
    { key: 'planner', label: '旅程を開く', path: '', need: 'any' },
    { key: 'preparation', label: '準備を進める', path: '/preparation', need: 'any' },
    { key: 'reservations', label: '予約を確かめる', path: '/reservations', need: 'any' },
    { key: 'share', label: '一緒に行く人を招く', path: '', need: 'owner' },
  ],
  past: [
    { key: 'expenses', label: '費用を精算する', path: '/expenses', need: 'any' },
    { key: 'memories', label: '旅の記録', path: '/memories', need: 'any' },
    { key: 'visits', label: '訪問を確かめる', path: '/visits', need: 'any' },
    { key: 'journey', label: '振り返り', path: '/journey', need: 'any' },
  ],
  undated: [
    { key: 'planner', label: '日程を決める', path: '', need: 'edit' },
    { key: 'candidates', label: '行きたい所を集める', path: '/candidates', need: 'any' },
    { key: 'share', label: '一緒に行く人を招く', path: '', need: 'owner' },
    { key: 'open', label: '旅程を開く', path: '', need: 'any' },
  ],
};

/** 段階と権限に合わせた操作(最大4つ。権限の無い操作は出さない) */
export function quickActions(t: Pick<DashboardTrip, 'id' | 'phase' | 'role' | 'can_edit'>): QuickAction[] {
  const allowed = (need: Need) => need === 'any' || (need === 'edit' && t.can_edit) || (need === 'owner' && t.role === 'owner');
  const seen = new Set<string>();
  const out: QuickAction[] = [];
  for (const a of ACTIONS[t.phase]) {
    if (!allowed(a.need)) continue;
    const id = encodeURIComponent(t.id); // サーバーの値を道のりへ入れる時は符号化する(画面側でも safeInternalPath を通す)
    const to = a.key === 'share' ? `/share/${id}` : `/planner/${id}${a.path}`;
    if (seen.has(to)) continue;
    seen.add(to);
    out.push({ key: a.key, label: a.label, to });
  }
  return out.slice(0, 4);
}

/** 旅行カードの並び(段階ごとの見出し) */
export const PHASE_ORDER: TripPhase[] = ['ongoing', 'upcoming', 'past', 'undated'];

export function groupTrips(trips: DashboardTrip[]): Array<{ phase: TripPhase; trips: DashboardTrip[] }> {
  return PHASE_ORDER.map((phase) => ({ phase, trips: trips.filter((t) => t.phase === phase) }))
    .filter((g) => g.trips.length > 0);
}
