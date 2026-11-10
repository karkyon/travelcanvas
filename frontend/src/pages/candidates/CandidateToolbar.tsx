/**
 * [Gate CandidateFilters] 候補箱の検索・絞り込み・並べ替え・表示の切り替え。
 * 言葉(名前・メモ・住所・タグ)・状態・種類・エリア(市区町村)・タグ・優先度で絞り、優先度・新しい順・名前・基点からの距離で並べる。
 */
import React from 'react';
import { LayoutGrid, List, Search, X, Map as MapIcon } from 'lucide-react';
import type { PlanCandidateItem } from '@/services/api';
import type { BasePoint } from '../discover/discoverModel';
import {
  EMPTY_FILTER, KIND_LABEL, facets, isFiltered, type CandidateFilter, type KindKey, type SortKey, type StatusFilter,
} from './candidateFilter';

const STATUS_TABS: Array<[StatusFilter, string]> = [
  ['active', '見送り以外'], ['open', '候補'], ['scheduled', '予定に配置済み'], ['dismissed', '見送り'], ['all', 'すべて'],
];
const SORTS: Array<[SortKey, string]> = [['priority', '優先度の高い順'], ['new', '新しい順'], ['name', '名前順'], ['distance', '基点から近い順']];

interface Props {
  items: PlanCandidateItem[];
  shown: number;
  filter: CandidateFilter;
  onChange: (f: CandidateFilter) => void;
  view: 'card' | 'list' | 'map';
  onView: (v: 'card' | 'list' | 'map') => void;
  bases: BasePoint[];
  baseId: string;
  onBase: (id: string) => void;
}

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

const Chip: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode; testId?: string }> = ({ on, onClick, children, testId }) => (
  <button type="button" aria-pressed={on} onClick={onClick} data-testid={testId}
    className={`tc-focus-ring min-h-8 rounded-full border px-3 text-xs font-semibold ${on ? 'border-accent bg-accent text-on-accent'
      : 'border-cloud-200 bg-cloud-0 text-ink-900'}`}>{children}</button>
);

const CandidateToolbar: React.FC<Props> = ({ items, shown, filter, onChange, view, onView, bases, baseId, onBase }) => {
  const f = facets(items);
  const counts: Record<StatusFilter, number> = {
    active: items.filter((c) => c.status !== 'dismissed').length, open: items.filter((c) => c.status === 'open').length,
    scheduled: items.filter((c) => c.status === 'scheduled').length, dismissed: items.filter((c) => c.status === 'dismissed').length,
    all: items.length,
  };
  const set = (p: Partial<CandidateFilter>) => onChange({ ...filter, ...p });
  return (
    <div className="tc-card mb-3 space-y-3 p-3" data-testid="candidate-toolbar" role="search" aria-label="候補を探す・絞り込む">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-10 min-w-0 flex-1 basis-60 items-center gap-2 rounded-xl border border-cloud-200 bg-cloud-0 px-3">
          <Search size={15} aria-hidden="true" />
          <input value={filter.q} onChange={(e) => set({ q: e.target.value })} placeholder="名前・メモ・住所・タグで探す"
            aria-label="候補を言葉で探す" className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-hidden" data-testid="candidate-q" />
        </label>
        <select value={filter.sort} onChange={(e) => set({ sort: e.target.value as SortKey })} aria-label="並べ替え"
          className="min-h-10 rounded-xl border border-cloud-200 bg-cloud-0 px-2 text-sm" data-testid="candidate-sort">
          {SORTS.map(([k, l]) => <option key={k} value={k} disabled={k === 'distance' && bases.length === 0}>{l}</option>)}
        </select>
        {filter.sort === 'distance' && bases.length > 0 && (
          <select value={baseId} onChange={(e) => onBase(e.target.value)} aria-label="距離の基点"
            className="min-h-10 max-w-60 rounded-xl border border-cloud-200 bg-cloud-0 px-2 text-sm" data-testid="candidate-sort-base">
            {bases.map((b) => <option key={b.id} value={b.id}>{`基点: ${b.label}`}</option>)}
          </select>
        )}
        <div className="flex rounded-xl border border-cloud-200" role="group" aria-label="表示">
          <button type="button" aria-pressed={view === 'card'} onClick={() => onView('card')} title="カードで表示"
            className={`tc-focus-ring min-h-10 rounded-l-xl px-3 ${view === 'card' ? 'bg-ink-900 text-cloud-0' : ''}`} data-testid="candidate-view-card">
            <LayoutGrid size={15} aria-label="カード" /></button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => onView('list')} title="一覧で表示(コンパクト)"
            className={`tc-focus-ring min-h-10 px-3 ${view === 'list' ? 'bg-ink-900 text-cloud-0' : ''}`} data-testid="candidate-view-list">
            <List size={15} aria-label="一覧" /></button>
          {/* [Gate DiscoverUX] 地図で位置関係と基点からの直線距離を見る */}
          <button type="button" aria-pressed={view === 'map'} onClick={() => onView('map')} title="地図で表示(位置関係・直線距離)"
            className={`tc-focus-ring min-h-10 rounded-r-xl px-3 ${view === 'map' ? 'bg-ink-900 text-cloud-0' : ''}`} data-testid="candidate-view-map">
            <MapIcon size={15} aria-label="地図" /></button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="状態">
        {STATUS_TABS.map(([k, l]) => (
          <Chip key={k} on={filter.status === k} onClick={() => set({ status: k })} testId={`candidate-status-${k}`}>{`${l} ${counts[k]}`}</Chip>
        ))}
      </div>
      {f.kinds.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="種類">
          <span className="text-xs text-ink-700">種類</span>
          {f.kinds.map(([k, n]) => (
            <Chip key={k} on={filter.kinds.includes(k)} onClick={() => set({ kinds: toggle<KindKey>(filter.kinds, k) })}
              testId={`candidate-kind-${k}`}>{`${KIND_LABEL[k]} ${n}`}</Chip>
          ))}
        </div>
      )}
      {f.areas.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="エリア">
          <span className="text-xs text-ink-700">エリア</span>
          {f.areas.map(([a, n]) => (
            <Chip key={a} on={filter.areas.includes(a)} onClick={() => set({ areas: toggle(filter.areas, a) })}
              testId={`candidate-area-${a}`}>{`${a} ${n}`}</Chip>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="タグ・優先度">
        <span className="text-xs text-ink-700">タグ</span>
        {f.tags.length === 0 && <span className="text-xs text-ink-700">(まだありません。候補の「タグ」で付けられます)</span>}
        {f.tags.map(([t, n]) => (
          <Chip key={t} on={filter.tags.includes(t)} onClick={() => set({ tags: toggle(filter.tags, t) })} testId={`candidate-tag-${t}`}>
            {`#${t} ${n}`}</Chip>
        ))}
        <span className="ml-2 text-xs text-ink-700">優先度</span>
        {[1, 2, 3].map((p) => (
          <Chip key={p} on={filter.priority === p} onClick={() => set({ priority: filter.priority === p ? null : p })}
            testId={`candidate-priority-${p}`}>{['', '高', '中', '低'][p]}</Chip>
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-700" aria-live="polite" data-testid="candidate-shown">
        {`${items.length}件中 ${shown}件を表示`}
        {isFiltered(filter) && (
          <button type="button" className="tc-focus-ring inline-flex items-center gap-1 rounded-full border border-cloud-200 px-2 py-0.5 font-semibold text-ink-900"
            onClick={() => onChange({ ...EMPTY_FILTER, sort: filter.sort })} data-testid="candidate-clear">
            <X size={12} aria-hidden="true" />条件をクリア</button>
        )}
      </p>
    </div>
  );
};

export default CandidateToolbar;
