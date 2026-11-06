/**
 * [Gate SpotLinks] 予定の場所の URL の入力(公式サイト・予約のページ・SNS など)。
 * 初めは 1 行。「＋ URL を追加」で 5 行まで増やせ、行ごとに消せる。形の確かめは保存の時(spotLinksModel.cleanUrls)。
 */
import React from 'react';
import { Link2, Plus, X } from 'lucide-react';
import { MAX_URLS } from './spotLinksModel';

interface Props {
  rows: string[];
  onChange: (rows: string[]) => void;
  error?: string | null;
}

const field = 'block w-full min-w-0 rounded-lg border border-cloud-200 bg-cloud-0 px-3 py-2 text-sm text-ink-900';

const EventUrlsField: React.FC<Props> = ({ rows, onChange, error = null }) => {
  const list = rows.length ? rows : [''];
  const set = (i: number, v: string) => onChange(list.map((r, j) => (j === i ? v : r)));
  const remove = (i: number) => onChange(list.length === 1 ? [''] : list.filter((_, j) => j !== i));
  return (
    <fieldset className="space-y-2" data-testid="event-urls">
      <legend className="text-sm font-medium text-ink-700">URL(公式サイト・予約・SNS など。{MAX_URLS} 件まで)</legend>
      {list.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <Link2 size={15} aria-hidden="true" className="shrink-0 text-ink-700" />
          <input type="url" inputMode="url" className={field} value={r} placeholder="https://"
            aria-label={`URL ${i + 1}`} maxLength={2000} onChange={(e) => set(i, e.target.value)} />
          {(list.length > 1 || r) && (
            <button type="button" className="tc-focus-ring tc-time-toggle shrink-0" onClick={() => remove(i)}
              aria-label={`URL ${i + 1} を消す`} title="この URL を消す">
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
      {list.length < MAX_URLS && (
        <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => onChange([...list, ''])}
          data-testid="event-url-add">
          <Plus size={14} aria-hidden="true" />URL を追加
        </button>
      )}
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </fieldset>
  );
};

export default EventUrlsField;
