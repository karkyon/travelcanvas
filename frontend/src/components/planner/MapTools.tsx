/**
 * [Gate MapTools] 旅程の地図の右上の操作: 「地図を最大化 / 元の大きさ」と「Google マップで表示」。
 * Google マップは新しいタブで開く(この日の予定の順に経路を検索。乗り物は Google マップの側で選ぶ)。
 */
import React from 'react';
import { ExternalLink, Maximize2, Minimize2 } from 'lucide-react';
import UiIcon from '@/components/common/UiIcon';
import { googleMapLinks, type MapStop } from './mapToolsModel';
import { safeExternalUrl } from '@/utils/safeNavigation';

interface Props {
  stops: MapStop[];
  maximized: boolean;
  onToggleMax: () => void;
}

const MapTools: React.FC<Props> = ({ stops, maximized, onToggleMax }) => {
  const { urls, used, missing } = googleMapLinks(stops);
  const note = missing > 0 ? `(場所の分からない予定 ${missing} 件は入りません)` : '';
  return (
    <div className="tc-map-actions" data-testid="map-tools">
      <button type="button" className="tc-focus-ring tc-map-action" onClick={onToggleMax} aria-pressed={maximized}
        data-testid="map-maximize">
        <UiIcon icon={maximized ? Minimize2 : Maximize2} size={14} />{maximized ? '元の大きさ' : '地図を最大化'}
      </button>
      {urls.length > 0 ? (
        <>
          <a className="tc-focus-ring tc-map-action" href={safeExternalUrl(urls[0]) ?? undefined} target="_blank" rel="noopener noreferrer" data-testid="map-google"
            title={`${used >= 2 ? `予定 ${used} か所の順に経路を検索します` : 'この場所を開きます'}${note}(新しいタブ)`}>
            <UiIcon icon={ExternalLink} size={14} />Google マップで表示
          </a>
          {urls.slice(1).map((u, i) => (
            <a key={u} className="tc-focus-ring tc-map-action" href={safeExternalUrl(u) ?? undefined} target="_blank" rel="noopener noreferrer"
              data-testid="map-google-more" aria-label={`Google マップで経路の続き ${i + 2}(新しいタブ)`}>続き {i + 2}</a>
          ))}
        </>
      ) : (
        <button type="button" className="tc-map-action" disabled data-testid="map-google"
          title="場所の分かる予定がまだありません">
          <UiIcon icon={ExternalLink} size={14} />Google マップで表示
        </button>
      )}
    </div>
  );
};

export default MapTools;
