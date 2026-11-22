/** [FR-062] 「今度行きたいの『赤福 本店』がこの近く(120m)です」と「行く」「あとで」(画面の上に 1 回だけ) */
import React from 'react';
import { safeExternalUrl } from '@/utils/safeNavigation';
import { useNearbyWishReminder } from './useNearbyWishReminder';

const WishNearbyBanner: React.FC<{ active: boolean }> = ({ active }) => {
  const { hit, dismiss } = useNearbyWishReminder(active);
  if (!hit) return null;
  const go = safeExternalUrl(`https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${hit.spot.lat},${hit.spot.lng}`);
  return (
    <div role="status" className="tc-card mb-3 flex flex-wrap items-center gap-2 p-3" data-testid="wish-nearby">
      <p className="flex-1 text-sm text-ink-900">{`今度行きたいの『${hit.spot.name}』がこの近く(${hit.distance_m}m)です`}</p>
      {go && <a href={go} target="_blank" rel="noopener noreferrer" className="tc-focus-ring tc-mbtn tc-mbtn--primary min-h-11"
        onClick={dismiss}>行く</a>}
      <button type="button" className="tc-focus-ring tc-mbtn min-h-11" onClick={dismiss}>あとで</button>
    </div>
  );
};

export default WishNearbyBanner;
