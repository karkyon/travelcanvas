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

/**
 * [Gate RelDays] 日数を読みやすい長さに。31 日までは日のまま、それより長いと「か月」(半月の単位で丸めて「約」)、
 * 1 年以上は「年とか月」(月で丸めて「約」)。多くのアプリの相対時刻(30 日前後で月・11 か月前後で年に切り替える)に合わせ、
 * 端数は半月まで出す。正確な日数は title で見られる(spanTitle)。
 */
export function daySpan(days: number): string {
  if (days <= 31) return `${days}日`;
  const months = days / 30.44;
  if (days < 365) {
    const half = Math.round(months * 2) / 2;
    const whole = Math.floor(half);
    return `約${whole}か月${half > whole ? '半' : ''}`;
  }
  let years = Math.floor(days / 365.25);
  let rest = Math.round((days - years * 365.25) / 30.44);
  if (rest >= 12) { years += 1; rest -= 12; }
  return `約${years}年${rest ? `${rest}か月` : ''}`;
}

/** 状況の札の title(正確な日数。31 日を超える時だけ) */
export function spanTitle(t: DashboardTrip): string | undefined {
  const n = t.phase === 'upcoming' ? t.days_until_start : t.phase === 'past' ? t.days_since_end : null;
  if (n === null || n === undefined || n <= 31) return undefined;
  return t.phase === 'upcoming' ? `出発まで ${n}日` : `終了から ${n}日`;
}

/** 段階ごとの短い状況(あと何日・何日目・何日前。長い時は「約○か月」「約○年○か月」) */
export function statusLabel(t: DashboardTrip): string {
  switch (t.phase) {
    case 'upcoming':
      if (t.days_until_start === 0) return '今日から';
      return t.days_until_start === 1 ? '明日から' : t.days_until_start == null ? 'あと?日' : `あと${daySpan(t.days_until_start)}`;
    case 'ongoing':
      return t.total_days ? `${t.day_number ?? 1}日目 / ${t.total_days}日` : `${t.day_number ?? 1}日目`;
    case 'past':
      if (t.days_since_end === 0) return '今日まで';
      if (t.days_since_end === 1) return '昨日終了';
      return t.days_since_end == null ? '?日前に終了' : `${daySpan(t.days_since_end)}前に終了`;
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
