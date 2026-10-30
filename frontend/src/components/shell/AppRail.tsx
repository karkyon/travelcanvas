/**
 * [Gate AppShell] 左の帯(スマホでは下の帯)。UI/UX モックの rail の 10 項目+設定。
 *
 * 旅行の中の項目(旅程・今日・旅行箱・共有・記録・比較)は、今開いている旅行(最後に開いた旅行)へ移る。
 * 旅行をまだ開いていない時は旅程の一覧へ移り、旅行を選ぶよう名前で伝える(押しても何も起きないボタンを作らない)。
 * スマホの幅では最初の5項目だけを下の帯に出し、残りは上の帯の「メニュー」から開く(Header)。
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { railItems } from './railItems';
import { useCurrentTripStore } from '../../store/currentTripStore';
import { safeInternalPath } from '../../utils/safeNavigation';

const AppRail: React.FC = () => {
  const { pathname } = useLocation();
  const trip = useCurrentTripStore((s) => s.trip);
  const items = railItems(trip?.id ?? null, pathname);
  const settingsActive = pathname.startsWith('/settings');
  return (
    <nav className="tc-rail" aria-label="主なメニュー" data-testid="app-rail">
      {items.map(({ key, label, icon: Icon, to, match, needsTrip }) => {
        const active = match(pathname);
        const pending = needsTrip && !trip;
        return (
          <Link key={key} to={safeInternalPath(to) ?? '/dashboard'} aria-current={active ? 'page' : undefined} className="tc-focus-ring"
            data-testid={`rail-${key}`} title={pending ? `${label}(旅行を選ぶと開きます)` : label}>
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
            {pending && <span className="sr-only">(旅行を選ぶと開きます)</span>}
          </Link>
        );
      })}
      <Link to="/settings" aria-current={settingsActive ? 'page' : undefined} className="tc-focus-ring tc-rail-bottom"
        data-testid="rail-settings" title="設定">
        <Settings size={20} aria-hidden="true" />
        <span>設定</span>
      </Link>
    </nav>
  );
};

export default AppRail;
