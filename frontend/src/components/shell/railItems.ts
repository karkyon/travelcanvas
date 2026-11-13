/**
 * [Gate AppShell] 左の帯・スマホのメニューの項目(UI/UX モックの rail の 10 項目)。
 * 旅行の中の項目は今開いている旅行(最後に開いた旅行)へ。旅行が無ければ旅程の一覧へ(needsTrip)。
 */
import {
  House, CalendarDays, Compass, PartyPopper, Luggage, Share2, Camera, Sparkles, Route, Heart, Briefcase,
  type LucideIcon,
} from 'lucide-react';

export interface RailItem {
  key: string;
  label: string;
  icon: LucideIcon;
  to: string;
  /** この画面にいる時に「今の画面」とする path の判定 */
  match: (path: string) => boolean;
  /** 旅行を開いていないため一覧へ移る時の読み上げの補足 */
  needsTrip?: boolean;
  /** [Gate HomeV2] 開いている旅行の中の項目(帯では区切りの下に「この旅行」として出す) */
  group?: 'trip';
}

const TRIP_RE = /^\/planner\/([0-9a-fA-F-]{36})(\/[^?#]*)?$/;

/** 端末の今日(YYYY-MM-DD) */
function localDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * [Gate TripDayNav] 旅行の期間の中か(端末の今日が出発の日〜最後の日)。日付が分からない旅行は期間の外とする。
 * 「旅の当日」の項目は旅行の当日だけ出す(当日まで使わない画面なので、普段は出さない)
 */
export function tripIsLive(trip: { start_date?: string | null; end_date?: string | null } | null | undefined,
  now: Date = new Date()): boolean {
  const s = trip?.start_date?.slice(0, 10);
  const e = (trip?.end_date ?? trip?.start_date)?.slice(0, 10);
  if (!s || !e) return false;
  const today = localDate(now);
  return s <= today && today <= e;
}

export function railItems(tripId: string | null, path: string, opts: { live?: boolean } = {}): RailItem[] {
  void path;
  const inTrip = (s: string | string[]) => (p: string) => {
    const mm = TRIP_RE.exec(p);
    if (!mm) return false;
    const rest = mm[2] ?? '';
    return (Array.isArray(s) ? s : [s]).some((x) => (x === '' ? rest === '' || rest === '/' : rest.startsWith(x)));
  };
  // [Gate HomeV2] モックアップ v2: ホーム / 旅行 / 旅の記録と思い出 / 行きたい場所 / 発見 / 旅行相談。
  // 旅行の中の項目(旅程・旅の当日(当日だけ)・旅行箱・共有・比較)は、旅行を開いている時だけ「この旅行」として下に出す
  const top: RailItem[] = [
    { key: 'home', label: 'ホーム', icon: House, to: '/dashboard', match: (p) => p === '/dashboard' },
    { key: 'trips', label: '旅行', icon: Luggage, to: '/planner', match: (p) => p === '/planner' || p.startsWith('/trip-consult/draft') },
    {
      key: 'memory', label: '旅の記録と思い出', icon: Camera, to: '/memories',
      match: (p) => p.startsWith('/memories') || p.startsWith('/atlas') || inTrip(['/memories', '/journey', '/visits', '/memory-replan'])(p),
    },
    { key: 'wish', label: '行きたい場所', icon: Heart, to: '/spots', match: (p) => p.startsWith('/spots') },
    {
      key: 'discover', label: '発見', icon: Compass, to: tripId ? `/planner/${tripId}/candidates` : '/search',
      match: (p) => p.startsWith('/search') || inTrip(['/candidates', '/places'])(p),
    },
    { key: 'intake', label: '旅行相談', icon: Sparkles, to: '/trip-consult', match: (p) => p.startsWith('/trip-consult') },
  ];
  if (!tripId) return top;
  const trip = (suffix: string) => `/planner/${tripId}${suffix}`;
  const inside: RailItem[] = [
    {
      key: 'plan', label: '旅程', icon: CalendarDays, to: trip(''), group: 'trip',
      match: inTrip(['', '/draft', '/segments', '/constraints']),
    },
    // [Gate TripDayNav] 旅の当日だけ出す(その画面を開いている時も出す)。「今日」ではなく、待ちに待った「旅の当日」
    ...(opts.live || inTrip(['/today', '/alerts', '/track'])(path) ? [{
      key: 'today', label: '旅の当日', icon: PartyPopper, to: trip('/today'), match: inTrip(['/today', '/alerts', '/track']),
      group: 'trip' as const,
    }] : []),
    {
      key: 'resources', label: '旅行箱', icon: Briefcase, to: trip('/reservations'), group: 'trip',
      match: inTrip(['/reservations', '/imports', '/documents', '/preparation', '/expenses']),
    },
    {
      key: 'share', label: '共有', icon: Share2, to: `/share/${tripId}`, group: 'trip',
      match: (p) => p.startsWith('/share/') || inTrip(['/discussion', '/booklet', '/exports', '/corrections'])(p),
    },
    { key: 'optimize', label: '比較', icon: Route, to: trip('/route-options'), match: inTrip('/route-options'), group: 'trip' },
  ];
  return [...top, ...inside];
}
