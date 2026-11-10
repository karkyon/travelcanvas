/**
 * [Gate DiscoverUX] 「場所を探す」の検索結果の帯(モックアップ 2026-11-10)。
 * ここは「まだこの旅行に保存していない検索結果」だと見て分かるように、点線の枠・「未保存」の札で示す。
 * 「この旅行の候補に保存」を押すと札が「候補に保存済み」に変わり、結果はここに残る。下の候補一覧へ移るリンクを出す。
 * 一覧と地図(基点からの直線距離の目安)を切り替えられる。
 */
import React, { Suspense, useState } from 'react';
import { List, Map as MapIcon } from 'lucide-react';
import Button from '@/components/common/Button';
import type { NearbyResult } from '@/services/api/types/g11discover';
import { distanceLabel, type BasePoint, type DiscoverPin } from './discoverModel';

const DiscoverMap = React.lazy(() => import('./DiscoverMap'));

const PROVIDER_LABEL: Record<string, string> = {
  overpass: 'OpenStreetMap', nominatim: 'OpenStreetMap', wikipedia: 'Wikipedia',
};

interface Props {
  results: NearbyResult[];
  base: BasePoint | null;
  saved: Record<string, boolean>;
  busyId: string | null;
  canEdit: boolean;
  onSave: (r: NearbyResult) => void;
  lastSaved: string | null;
  onViewCandidates: () => void;
}

const DiscoverResults: React.FC<Props> = ({ results, base, saved, busyId, canEdit, onSave, lastSaved, onViewCandidates }) => {
  const [view, setView] = useState<'list' | 'map'>('list');
  const providers = [...new Set(results.map((r) => PROVIDER_LABEL[r.provider] ?? r.provider))];
  const fetched = results.map((r) => r.retrieved_at).filter(Boolean).sort().pop();
  const pins: DiscoverPin[] = results.filter((r) => r.location.latitude !== null && r.location.longitude !== null).map((r) => ({
    id: r.id, label: r.name, latitude: r.location.latitude as number, longitude: r.location.longitude as number,
    kind: saved[r.id] ? 'saved' : 'result', sub: r.category ?? undefined,
  }));
  return (
    <div className="tc-disc-results" aria-live="polite" data-testid="discover-results">
      <div className="tc-disc-results-head">
        <p className="m-0 text-sm font-bold text-ink-900">
          検索結果 <span className="text-accent">{`${results.length}件`}</span>
          <span className="tc-disc-unsaved-label">未保存の検索結果</span>
        </p>
        <span className="text-xs text-ink-700">
          {[providers.join('・'), fetched ? `取得 ${fetched.slice(11, 16)}` : null, '距離は直線の目安'].filter(Boolean).join(' · ')}
        </span>
        <div className="tc-disc-toggle ml-auto" role="group" aria-label="検索結果の表示">
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} data-testid="discover-results-list">
            <List size={14} aria-hidden="true" />一覧</button>
          <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')} data-testid="discover-results-map">
            <MapIcon size={14} aria-hidden="true" />地図</button>
        </div>
      </div>
      {results.length === 0 && <p className="text-sm text-ink-700">見つかりませんでした。半径・カテゴリ・言葉を変えてください。</p>}
      {view === 'map' && results.length > 0 ? (
        <Suspense fallback={<p role="status" className="text-sm text-ink-700">地図を読み込み中…</p>}>
          <DiscoverMap base={base} pins={pins} label="検索結果の地図" />
        </Suspense>
      ) : (
        <ul className="tc-disc-result-list" aria-label="検索結果(まだ保存していない場所)">
          {results.map((r) => {
            const done = Boolean(saved[r.id]);
            return (
              <li key={r.id} className="tc-disc-result" data-saved={done ? 'true' : 'false'} data-testid={`nearby-result-${r.id}`}>
                <div className="min-w-0">
                  <p className="m-0 font-semibold text-ink-900 break-words">{r.name}</p>
                  <p className="m-0 flex flex-wrap items-center gap-x-2 text-xs text-ink-700">
                    {r.category && <span>{r.category}</span>}
                    <span>{distanceLabel(r)}</span>
                    <span className={done ? 'tc-disc-pill tc-disc-pill--saved' : 'tc-disc-pill tc-disc-pill--unsaved'}
                      data-testid={`nearby-state-${r.id}`}>{done ? '候補に保存済み' : '未保存'}</span>
                  </p>
                  {r.location.address && <p className="m-0 text-xs text-ink-700 break-words">{`${r.location.address} · 検索結果から`}</p>}
                </div>
                {canEdit && (
                  <Button type="button" size="sm" variant={done ? 'outline' : 'primary'} disabled={Boolean(busyId) || done}
                    loading={busyId === r.id} onClick={() => onSave(r)} data-testid={`nearby-add-${r.id}`}>
                    {done ? '✓ 保存済み' : 'この旅行の候補に保存'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {lastSaved && (
        <div className="tc-disc-notice" role="status" data-testid="discover-saved-notice">
          <span>{`✓ 「${lastSaved}」をこの旅行の候補に保存しました。検索結果はここに残ります。`}</span>
          <button type="button" className="tc-focus-ring" onClick={onViewCandidates}>候補一覧を見る ↓</button>
        </div>
      )}
    </div>
  );
};

export default DiscoverResults;
