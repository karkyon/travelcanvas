/**
 * [Gate TripNav] 「この旅行」のメニュー。今の旅行の名前と同じ上の帯に並べ、どの旅行の画面かを一目で分かるようにする。
 * [Gate HeaderPicker] 旅行の中の画面(費用など)を旅程を経ずに直接開いた時も、その旅行を読んで上の帯に名前を出す
 * (以前は「旅行を選ぶ」のままだった)。読めない時は名前を作らない。最初に読む JS を増やさないよう、遅れて読むこの塊で行う。
 */
import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { railItems, tripIsLive } from './railItems';
import { safeInternalPath } from '../../utils/safeNavigation';
import { travelAPI } from '../../services/api';
import { publishCurrentTrip, useCurrentTripStore } from '../../store/currentTripStore';

const TripNav: React.FC<{ tripId: string; path: string; row?: boolean }> = ({ tripId, path, row = false }) => {
  const knownId = useCurrentTripStore((s) => s.trip?.id ?? null);
  const current = useCurrentTripStore((s) => s.trip);
  const live = current?.id === tripId && tripIsLive(current);
  // [Gate TripShare] 共有の画面(/share/<id>)を直接開いた時も旅行を読んで名前を出す
  const inPlanner = path.startsWith(`/planner/${tripId}`) || path.startsWith(`/share/${tripId}`);
  useEffect(() => {
    if (!inPlanner || knownId === tripId) return undefined;
    let alive = true;
    travelAPI.getPlan(tripId)
      .then((res) => { if (alive && res && res.success && res.data?.id === tripId) publishCurrentTrip(res.data); })
      .catch(() => { /* 読めなければ「旅行を選ぶ」のまま */ });
    return () => { alive = false; };
  }, [tripId, knownId, inPlanner]);
  return (
    <nav className={`tc-tripnav${row ? ' tc-tripnav--row' : ''}`} aria-label="この旅行のメニュー" data-testid="trip-nav">
      {railItems(tripId, path, { live }).filter((i) => i.group === 'trip').map(({ key, label, icon: Icon, to, match }) => (
        <Link key={key} to={safeInternalPath(to) ?? '/dashboard'} aria-current={match(path) ? 'page' : undefined}
          className={`tc-focus-ring${key === 'today' ? ' tc-tripnav-live' : ''}`} data-testid={`rail-${key}`}>
          <Icon size={16} aria-hidden="true" />
          <span>{label}</span>
          {key === 'today' && live && <span className="tc-live-dot" aria-label="旅行中" />}
        </Link>
      ))}
    </nav>
  );
};

export default TripNav;
