/**
 * [Gate AppShell] 左の帯・スマホのメニューの項目(UI/UX モックの rail の 10 項目)。
 * 旅行の中の項目は今開いている旅行(最後に開いた旅行)へ。旅行が無ければ旅程の一覧へ(needsTrip)。
 */
import {
  House, CalendarDays, Compass, Sun, Luggage, Share2, Camera, Sparkles, Route, Heart, Briefcase,
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

export function railItems(tripId: string | null, path: string): RailItem[] {
  void path;
  const inTrip = (s: string | string[]) => (p: string) => {
    const mm = TRIP_RE.exec(p);
    if (!mm) return false;
    const rest = mm[2] ?? '';
    return (Array.isArray(s) ? s : [s]).some((x) => (x === '' ? rest === '' || rest === '/' : rest.startsWith(x)));
  };
  // [Gate HomeV2] モックアップ v2: ホーム / 旅行 / 旅の記録と思い出 / 行きたい場所 / 発見 / 旅行相談。
  // 旅行の中の項目(旅程・今日・旅行箱・共有・比較)は、旅行を開いている時だけ「この旅行」として下に出す
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
      match: inTrip(['', '/draft', '/segments', '/constraints', '/branches']),
    },
    { key: 'today', label: '今日', icon: Sun, to: trip('/today'), match: inTrip(['/today', '/alerts', '/track']), group: 'trip' },
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
