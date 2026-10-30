/**
 * [Gate AppShell] 左の帯・スマホのメニューの項目(UI/UX モックの rail の 10 項目)。
 * 旅行の中の項目は今開いている旅行(最後に開いた旅行)へ。旅行が無ければ旅程の一覧へ(needsTrip)。
 */
import {
  House, CalendarDays, Compass, Sun, Luggage, Share2, Camera, Sparkles, Plus, Route,
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
  const trip = (suffix: string) => (tripId ? `/planner/${tripId}${suffix}` : '/planner');
  return [
    { key: 'home', label: 'ホーム', icon: House, to: '/dashboard', match: (p) => p === '/dashboard' },
    {
      key: 'plan', label: '旅程', icon: CalendarDays, to: trip(''),
      match: (p) => p === '/planner' || inTrip(['', '/draft', '/segments', '/constraints', '/branches'])(p),
    },
    {
      key: 'discover', label: '発見', icon: Compass, to: tripId ? `/planner/${tripId}/candidates` : '/search',
      match: (p) => p.startsWith('/search') || p.startsWith('/spots') || inTrip(['/candidates', '/places'])(p),
    },
    { key: 'today', label: '今日', icon: Sun, to: trip('/today'), match: inTrip(['/today', '/alerts', '/track']), needsTrip: true },
    {
      key: 'resources', label: '旅行箱', icon: Luggage, to: trip('/reservations'),
      match: inTrip(['/reservations', '/imports', '/documents', '/preparation', '/expenses']), needsTrip: true,
    },
    {
      key: 'share', label: '共有', icon: Share2, to: tripId ? `/share/${tripId}` : '/planner',
      match: (p) => p.startsWith('/share/') || inTrip(['/discussion', '/booklet', '/exports', '/corrections'])(p), needsTrip: true,
    },
    {
      key: 'memory', label: '記録', icon: Camera, to: trip('/memories'),
      match: (p) => p.startsWith('/atlas') || inTrip(['/memories', '/journey', '/visits', '/memory-replan'])(p), needsTrip: true,
    },
    { key: 'intake', label: '旅行相談', icon: Sparkles, to: '/trip-consult', match: (p) => p.startsWith('/trip-consult') },
    { key: 'quick', label: 'クイック', icon: Plus, to: '/planner?new=1', match: () => false },
    { key: 'optimize', label: '比較', icon: Route, to: trip('/route-options'), match: inTrip('/route-options'), needsTrip: true },
  ];
}

