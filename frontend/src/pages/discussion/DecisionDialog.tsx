/**
 * [Gate ChatConsensus] 「これで決まり」: 話し合いで決めたことを、投票なしで「決まったこと」に記録する(FR-022)。
 *
 * - 発言から題名と決めたことの下書きを作る(人が直してから記録する)
 * - 候補箱の候補を選ぶと、その候補を決定にする(旅程に反映する時に置く日を選ぶ)
 * - 「続けて旅程に反映する」を選ぶと、記録の後に反映の確認(AdoptDialog)を開く。反映は確かめてからだけ
 */
import React, { useState } from 'react';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import type { DecisionCreateData, PlanCandidateItem } from '@/services/api';

interface Props {
  initialTitle: string;
  initialLabel: string;
  sourceQuote?: string | null;
  candidates: PlanCandidateItem[];
  onClose: () => void;
  onSubmit: (data: Omit<DecisionCreateData, 'source_comment_id'>, reflect: boolean) => Promise<string | null>;
}

const inputClass = 'w-full border rounded-lg px-3 py-2';

const DecisionDialog: React.FC<Props> = ({ initialTitle, initialLabel, sourceQuote, candidates, onClose, onSubmit }) => {
  const [title, setTitle] = useState(initialTitle);
  const [label, setLabel] = useState(initialLabel);
  const [candidateId, setCandidateId] = useState('');
  const [reflect, setReflect] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    const l = label.trim();
    if (!t) return setError('何を決めたか(題名)を入力してください');
    if (!l && !candidateId) return setError('決めたことを入力するか、候補箱から選んでください');
    setBusy(true);
    setError(null);
    const failed = await onSubmit({
      title: t, option: candidateId ? { candidate_id: candidateId, ...(l ? { label: l } : {}) } : { label: l },
    }, reflect);
    setBusy(false);
    if (failed) setError(failed);
  };

  return (
    <Modal isOpen onClose={onClose} title="これで決まり" size="md">
      <form onSubmit={submit} noValidate>
        <Modal.Body>
          <div className="space-y-4">
            <p className="text-sm text-ink-700">投票をせずに、話し合いで決めたこととして記録します。メンバーに知らせます。</p>
            {sourceQuote && <p className="text-xs text-ink-700">元の発言: 「{sourceQuote}」</p>}
            {error && <div className="p-2 rounded-sm bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
            <div>
              <label htmlFor="decision-title" className="block text-sm font-medium text-ink-900 mb-1">何を決めたか(題名)</label>
              <input id="decision-title" className={inputClass} maxLength={200} value={title}
                onChange={(e) => setTitle(e.target.value)} placeholder="例: 2日目の夕食" />
            </div>
            <div>
              <label htmlFor="decision-label" className="block text-sm font-medium text-ink-900 mb-1">決めたこと</label>
              <input id="decision-label" className={inputClass} maxLength={200} value={label}
                onChange={(e) => setLabel(e.target.value)} placeholder="例: 寿司" />
            </div>
            {candidates.length > 0 && (
              <div>
                <label htmlFor="decision-candidate" className="block text-sm font-medium text-ink-900 mb-1">候補箱の候補にする(任意)</label>
                <select id="decision-candidate" className={inputClass} value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
                  <option value="">選ばない</option>
                  {candidates.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={reflect} onChange={(e) => setReflect(e.target.checked)} />
              続けて旅程に反映する(何が変わるかを確かめてから反映します)
            </label>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" type="button" onClick={onClose}>やめる</Button>
          <Button variant="primary" type="submit" loading={busy}>記録する</Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
};

export default DecisionDialog;
