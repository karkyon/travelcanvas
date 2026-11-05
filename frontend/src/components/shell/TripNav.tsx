/** [Gate TripNav] 「この旅行」のメニュー。今の旅行の名前と同じ上の帯に並べ、どの旅行の画面かを一目で分かるようにする。 */
import React from 'react';
import { Link } from 'react-router-dom';
import { railItems } from './railItems';
import { safeInternalPath } from '../../utils/safeNavigation';

const TripNav: React.FC<{ tripId: string; path: string; row?: boolean }> = ({ tripId, path, row = false }) => (
  <nav className={`tc-tripnav${row ? ' tc-tripnav--row' : ''}`} aria-label="この旅行のメニュー" data-testid="trip-nav">
    {railItems(tripId, path).filter((i) => i.group === 'trip').map(({ key, label, icon: Icon, to, match }) => (
      <Link key={key} to={safeInternalPath(to) ?? '/dashboard'} aria-current={match(path) ? 'page' : undefined}
        className="tc-focus-ring" data-testid={`rail-${key}`}>
        <Icon size={16} aria-hidden="true" />
        <span>{label}</span>
      </Link>
    ))}
  </nav>
);

export default TripNav;
