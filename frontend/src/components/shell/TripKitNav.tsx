/**
 * [Gate MockScreens] 旅行箱(UI/UX モックの resources)の切り替え: 予約・チケット / 準備・持ち物 / 費用 / 文書 / 取込。
 * 画面ごとに URL が違うため、タブの見た目のリンク(aria-current)にする。右に旅行の期間と行き先(読めた時だけ)。
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTripContext } from '@/hooks/useTripContext';

const KIT = [
  { suffix: '/reservations', label: '予約・チケット' },
  { suffix: '/preparation', label: '準備・持ち物' },
  { suffix: '/expenses', label: '予算・費用' },
  { suffix: '/documents', label: '文書' },
  { suffix: '/imports', label: '予約の取込' },
] as const;

function md(d: string | null): string | null {
  return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : null;
}

const TripKitNav: React.FC<{ planId: string }> = ({ planId }) => {
  const { pathname } = useLocation();
  const trip = useTripContext(planId);
  const range = [md(trip.startDate), md(trip.endDate)].filter(Boolean);
  const meta = [range.length ? Array.from(new Set(range)).join(' — ') : null, trip.destination].filter(Boolean).join(' · ');
  return (
    <div className="tc-kit-nav">
      <nav aria-label="旅行箱の中の画面" className="tc-kit-tabs">
        {KIT.map((k) => {
          const to = `/planner/${planId}${k.suffix}`;
          const active = pathname.startsWith(to);
          return (
            <Link key={k.suffix} to={to} aria-current={active ? 'page' : undefined} className="tc-focus-ring tc-day-tab">
              {k.label}
            </Link>
          );
        })}
      </nav>
      {meta && <span className="tc-kit-meta">{meta}</span>}
    </div>
  );
};

export default TripKitNav;
