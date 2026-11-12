/**
 * [Gate PlanB] 案を比べる(S3): 今の案と控えの案の予定を、同じ並びで左右に。予定の数・時間帯・つながりの判定
 */
import React, { useEffect, useState } from 'react';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import { checkVariant, getVariant, type VariantCheck, type VariantDay, type VariantSummary } from '@/services/api/dayVariants';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

interface Props {
  planId: string;
  isOpen: boolean;
  left: VariantSummary | null;
  right: VariantSummary | null;
  canSwitch: boolean;
  onClose: () => void;
  onSwitch: () => void;
}

interface Side { day: VariantDay; check: VariantCheck }

const titleSet = (d: VariantDay) => new Set(d.day.events.map((e) => String(e.title ?? '')));

const CompareVariantsDialog: React.FC<Props> = ({ planId, isOpen, left, right, canSwitch, onClose, onSwitch }) => {
  const [sides, setSides] = useState<[Side, Side] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen || !left || !right) return;
    let live = true;
    setSides(null);
    setError(null);
    const load = async (v: VariantSummary): Promise<Side> => ({ day: await getVariant(planId, v.day_id), check: await checkVariant(planId, v.day_id) });
    Promise.all([load(left), load(right)]).then((s) => { if (live) setSides(s); })
      .catch((e) => { if (live) setError(errorDetailMessage(e, '案を読み込めませんでした')); });
    return () => { live = false; };
  }, [isOpen, planId, left, right]);
  if (!left || !right) return null;
  const other = sides ? [titleSet(sides[1].day), titleSet(sides[0].day)] : null;
  const col = (v: VariantSummary, s: Side | undefined, i: 0 | 1) => (
    <section className="tc-variant-cmp-col" aria-label={`${v.label} ${v.name}`} data-testid={`variant-cmp-${v.label}`}>
      <p className={`tc-vtab ${v.status === 'active' ? 'is-active' : 'is-open'}`}>
        <span className="tc-vtab-letter" aria-hidden="true">{v.label}</span>{v.name}{v.status === 'active' && <span className="tc-vtab-now">今の案</span>}
      </p>
      {s ? (
        <>
          <dl className="tc-variant-kv">
            <dt>予定</dt><dd>{`${s.day.day.events.length} 件`}</dd>
            <dt>時間帯</dt><dd>{v.first_time ? `${v.first_time}〜${v.last_time ?? ''}` : '時刻なし'}</dd>
            <dt>つながり</dt><dd className={`is-${s.check.status}`}>{s.check.status === 'ok' ? '✓ 合う' : s.check.status === 'warn' ? `⚠ 注意 ${s.check.counts.warn}` : `✕ 合わない ${s.check.counts.bad}`}</dd>
          </dl>
          <ol className="tc-variant-cmp-list">
            {s.day.day.events.map((e) => {
              const t = String(e.title ?? '');
              const only = Boolean(other && !other[i]?.has(t));
              return (
                <li key={String(e.id)} className={only ? 'is-only' : ''}>
                  <span className="tc-variant-cmp-time">{String(e.local_start_time ?? '').slice(0, 5) || '未定'}</span>
                  <span>{t}</span>{only && <span className="tc-variant-chip">この案だけ</span>}
                </li>
              );
            })}
          </ol>
        </>
      ) : <p className="tc-variant-hint">{error ? '' : '読み込んでいます…'}</p>}
    </section>
  );
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`案を比べる · ${left.local_date}`} size="xl">
      <Modal.Body>
        <div className="tc-variant-cmp" data-testid="variant-compare-dialog">{col(left, sides?.[0], 0)}{col(right, sides?.[1], 1)}</div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="secondary" onClick={onClose}>閉じる</Button>
        {canSwitch && right.status !== 'active' && (
          <Button type="button" variant="primary" onClick={onSwitch}>{`${right.label} ${right.name}に切り替える`}</Button>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default CompareVariantsDialog;
