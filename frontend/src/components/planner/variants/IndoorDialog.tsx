/**
 * [Gate PlanB-Indoor] 雨の日の案: 屋外の予定の代わりに、この日の範囲の屋内の候補(水族館・美術館・博物館・屋内の体験)を探して
 * 入れ替える。押した時だけ探す(保存しない)。入れ替えは控えの案の中だけ(同じ時刻)。「元に戻す」で戻る
 */
import React, { useEffect, useState } from 'react';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import { indoorCandidates, replaceInVariant, type IndoorCandidate, type VariantSummary } from '@/services/api/dayVariants';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

interface Props {
  planId: string;
  isOpen: boolean;
  variant: VariantSummary | null;
  revision: number;
  onClose: () => void;
  onDone: () => void;
}

const IndoorDialog: React.FC<Props> = ({ planId, isOpen, variant, revision, onClose, onDone }) => {
  const outdoor = (variant?.conditions?.scaffold ?? []).filter((n) => n.kind === 'rain' && n.event_id && n.fit === 'outdoor');
  const [target, setTarget] = useState<string>('');
  const [rows, setRows] = useState<IndoorCandidate[] | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTarget(outdoor[0]?.event_id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いた時に 1 回
  }, [isOpen]);
  useEffect(() => {
    if (!isOpen || !variant) return undefined;
    let live = true;
    setRows(null);
    setError(null);
    indoorCandidates(planId, variant.day_id, target || null).then((r) => {
      if (!live) return;
      setRows(r.candidates);
      setRegion(r.message ?? (r.region ? `${r.region.label}${r.region.radius_km ? `(約${r.region.radius_km}km)` : ''}` : null));
    }).catch((e) => { if (live) { setRows([]); setError(errorDetailMessage(e, '候補を探せませんでした')); } });
    return () => { live = false; };
  }, [isOpen, variant, planId, target]);

  const put = async (c: IndoorCandidate) => {
    if (!variant) return;
    setBusy(c.name);
    setError(null);
    try {
      await replaceInVariant(planId, variant.day_id, revision, {
        replace_event_id: target || null, name: c.name, address: c.address ?? null, latitude: c.latitude ?? null,
        longitude: c.longitude ?? null, event_type: c.kind === 'activity' ? 'activity' : 'sightseeing',
      });
      onDone();
    } catch (e) {
      setError(errorDetailMessage(e, '入れ替えられませんでした'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`屋内の候補 · ${variant ? `${variant.label} ${variant.name}` : ''}`} size="lg">
      <Modal.Body>
        <div className="space-y-3" data-testid="indoor-dialog">
          <label className="tc-variant-small">入れ替える予定
            <select className="tc-variant-input" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="indoor-target">
              {outdoor.map((n) => <option key={n.event_id!} value={n.event_id!}>{`${n.title}(屋外)`}</option>)}
              <option value="">入れ替えずに足す(この日の範囲で探す)</option>
            </select>
          </label>
          {region && <p className="tc-variant-hint">{`探した範囲: ${region}`}</p>}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {rows === null ? <p className="tc-variant-hint" role="status">探しています…</p> : rows.length === 0 ? (
            <p className="tc-variant-hint">屋内の候補が見つかりませんでした。予定の追加の「名前で検索」でも探せます。</p>
          ) : (
            <ul className="tc-variant-checks" data-testid="indoor-list">
              {rows.map((c) => (
                <li key={c.name} className="tc-variant-res is-info">
                  <span className="tc-variant-res-mark" aria-hidden="true">屋</span>
                  <span className="flex-1">
                    <strong>{c.name}</strong>
                    <span>{[c.genre_label, c.distance_km !== null && c.distance_km !== undefined ? `${c.distance_km}km` : null,
                      c.fit === 'indoor' ? '屋内' : '屋内か要確認'].filter(Boolean).join(' · ')}</span>
                  </span>
                  <Button size="sm" variant="secondary" loading={busy === c.name} onClick={() => void put(c)}
                    data-testid={`indoor-put-${c.name}`}>{target ? '入れ替える' : '足す'}</Button>
                </li>
              ))}
            </ul>
          )}
          <p className="tc-variant-hint">営業時間・料金・空きは確かめていません(要確認)。入れ替えは控えの案の中だけで、旅程の「元に戻す」で戻せます。</p>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="secondary" onClick={onClose}>閉じる</Button>
      </Modal.Footer>
    </Modal>
  );
};

export default IndoorDialog;
