/**
 * [Gate CandidateFilters] 候補のタグ(表示と編集)。「、」「,」・空白・Enter で区切って足す。最大 10 個・1 つ 20 文字。
 */
import React, { useState } from 'react';
import { Tag, X } from 'lucide-react';
import { parseTags } from './candidateFilter';

interface Props {
  title: string;
  tags: string[];
  canEdit: boolean;
  busy: boolean;
  onSave: (tags: string[]) => void;
  onPick?: (tag: string) => void;
}

const CandidateTags: React.FC<Props> = ({ title, tags, canEdit, busy, onSave, onPick }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const add = () => {
    const next = [...new Set([...tags, ...parseTags(text)])].slice(0, 10).map((t) => t.slice(0, 20));
    setText('');
    if (next.join('\u0000') !== tags.join('\u0000')) onSave(next);
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1" data-testid="candidate-tags">
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-0.5 rounded-full bg-cloud-100 px-2 py-0.5 text-xs text-ink-900">
          <button type="button" className="tc-focus-ring" onClick={() => onPick?.(t)} title="このタグで絞り込む">#{t}</button>
          {editing && canEdit && (
            <button type="button" className="tc-focus-ring" aria-label={`タグ「${t}」を外す`} disabled={busy}
              onClick={() => onSave(tags.filter((x) => x !== t))}><X size={11} aria-hidden="true" /></button>
          )}
        </span>
      ))}
      {canEdit && !editing && (
        <button type="button" className="tc-focus-ring inline-flex items-center gap-1 rounded-full border border-dashed border-cloud-200 px-2 py-0.5 text-xs text-ink-700"
          onClick={() => setEditing(true)} aria-label={`${title}のタグを編集`} data-testid="candidate-tags-edit">
          <Tag size={11} aria-hidden="true" />タグ</button>
      )}
      {canEdit && editing && (
        <span className="inline-flex items-center gap-1">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="例: 雨の日, 朝, 子ども" aria-label={`${title}に足すタグ`}
            autoFocus maxLength={200} data-testid="candidate-tags-input"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); add(); } if (e.key === 'Escape') setEditing(false); }}
            className="min-h-8 w-40 rounded-md border border-cloud-200 bg-cloud-0 px-2 text-xs" />
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" disabled={busy} onClick={add} data-testid="candidate-tags-add">足す</button>
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => { if (text.trim()) add(); setEditing(false); }}>閉じる</button>
        </span>
      )}
    </div>
  );
};

export default CandidateTags;
