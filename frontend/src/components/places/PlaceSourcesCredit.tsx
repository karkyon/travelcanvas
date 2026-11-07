/**
 * [Gate PlaceLookupJP] 場所の自動取得の出典(各提供元の規約のクレジット)。応答の URL ではなく、提供元ごとの決まった値を出す。
 */
import React from 'react';
import type { PlaceSource } from '@/services/api/planEdit';
import { safeExternalUrl } from '@/utils/safeNavigation';

const FIXED: Record<string, string> = {
  yahoo_local: 'https://developer.yahoo.co.jp/sitemap/',
  rakuten_travel: 'https://developers.rakuten.com/',
  hotpepper: 'https://webservice.recruit.co.jp/',
  openstreetmap: 'https://www.openstreetmap.org/copyright',
  wikidata: 'https://www.wikidata.org/',
  gsi: 'https://www.gsi.go.jp/',
};

const PlaceSourcesCredit: React.FC<{ sources?: PlaceSource[]; fallback?: string; className?: string }> = ({ sources, fallback, className }) => {
  const list = (sources ?? []).filter((s) => FIXED[s.provider]);
  if (!list.length) return fallback ? <p className={className}>{fallback}</p> : null;
  return (
    <p className={className} data-testid="place-sources">
      出典:{' '}
      {list.map((s, i) => (
        <React.Fragment key={s.provider}>
          {i > 0 && '・'}
          <a href={safeExternalUrl(FIXED[s.provider]) ?? undefined} target="_blank" rel="noopener noreferrer" className="underline">{s.credit}</a>
        </React.Fragment>
      ))}
      。情報が古い・違う場合があります
    </p>
  );
};

export default PlaceSourcesCredit;
