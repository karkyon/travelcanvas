/**
 * [Gate PlanB] 切り替えの確認(S4): 前後のつながり・時刻・予約(使わなくなる予約・食い違い・未予約)を見てから切り替える。
 * 合わなくても切り替えられる(利用者の判断)。切り替えは「元に戻す」で戻せる。
 */
import React, { useEffect, useState } from 'react';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import { checkVariant, REASONS, switchVariant, type VariantCheck, type VariantReason, type VariantSummary } from '@/services/api/dayVariants';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { groupChecks } from './variantModel';

interface Props {
  planId: string;
  isOpen: boolean;
  target: VariantSummary | null;
  active: VariantSummary | null;
  revision: number;
  onClose: () => void;
  onSwitched: () => void;
}

const MARK: Record<string, string> = { ok: '✓', info: 'i', warn: '⚠', bad: '✕' };

const SwitchVariantDialog: React.FC<Props> = ({ planId, isOpen, target, active, revision, onClose, onSwitched }) => {
  const [check, setCheck] = useState<VariantCheck | null>(null);
  const [reason, setReason] = useState<VariantReason | ''>('');
  const [note, setNote] = useState('');
  const [group, setGroup] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !target) return;
    let live = true;
    setCheck(null);
    setError(null);
    setBusy(false);
    setReason(target.reason ?? '');
    setNote('');
    checkVariant(planId, target.day_id).then((c) => { if (live) setCheck(c); })
      .catch((e) => { if (live) setError(errorDetailMessage(e, '前後のつながりを確かめられませんでした(切り替えはできます)')); });
    return () => { live = false; };
  }, [isOpen, planId, target]);

  if (!target) return null;
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await switchVariant(planId, target.day_id, revision, { reason: reason || null, note: note.trim() || undefined, phase: 'planning',
        group: Boolean(target.group_id) && group });
      onSwitched();
    } catch (e) {
      setError(errorDetailMessage(e, '切り替えられませんでした'));
      setBusy(false);
    }
  };
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${target.label} ${target.name}に切り替えます`} size="lg">
      <Modal.Body>
        <div className="space-y-4" data-testid="variant-switch-dialog">
          <p className="tc-variant-hint">
            {active ? `今の案「${active.label} ${active.name}」は消えません。控えの案として残り、「元に戻す」かタブからいつでも戻せます。` : ''}
          </p>
          {!check && !error && <p className="tc-variant-hint" role="status">前後のつながりを確かめています…</p>}
          {check && groupChecks(check.items).map((g) => (
            <section key={g.title} aria-label={g.title}>
              <h3 className="tc-variant-flabel">{g.title}</h3>
              <ul className="tc-variant-checks">
                {g.items.map((i) => (
                  <li key={`${i.kind}-${i.title}`} className={`tc-variant-res is-${i.level}`} data-testid={`variant-check-${i.kind}`}>
                    <span className="tc-variant-res-mark" aria-hidden="true">{MARK[i.level]}</span>
                    <span><strong>{i.title}</strong>{i.text && <span>{i.text}</span>}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="tc-variant-grid">
            <label className="tc-variant-small">理由
              <select className="tc-variant-input" value={reason} onChange={(e) => setReason(e.target.value as VariantReason | '')}>
                <option value="">指定しない</option>
                {REASONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label className="tc-variant-small">一言(任意)
              <input className="tc-variant-input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 朝から本降りの予報" />
            </label>
          </div>
          {target.group_id && (
            <label className="tc-variant-check"><input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} />
              一緒に作ったほかの日の案もまとめて切り替える
            </label>
          )}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="secondary" onClick={onClose}>やめる</Button>
        <Button type="button" variant="primary" loading={busy} onClick={go} data-testid="variant-switch-go">切り替える</Button>
      </Modal.Footer>
    </Modal>
  );
};

export default SwitchVariantDialog;
