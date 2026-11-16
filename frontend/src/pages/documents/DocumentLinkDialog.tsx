/**
 * [Gate TripKitFix] 文書を予約・予定へ関連付ける(文書の側から)。
 *
 * 以前は「予約の詳細から添付できます」とだけ出ていた。既存の API(POST /plans/{plan_id}/documents/{id}/links)で
 * 参照だけを足す(ファイルは複製しない)。候補は、ファイル名と予約名・予定名の語が重なるものを上に出すだけで、
 * 勝手には関連付けない(本人が選ぶ)。別の旅行の予約・予定は backend が 404 で拒む。
 */
import React, { useEffect, useMemo, useState } from 'react';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import api, { getReservations } from '@/services/api';
import { createDocumentLink } from '@/services/api/documentLinks';
import type { NormalizedDay, Reservation, TravelDocument } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { linkCandidates, type LinkTarget } from './documentLinkModel';

interface Props {
  planId: string;
  doc: TravelDocument | null;
  onClose: () => void;
  onLinked: () => void;
}

const DocumentLinkDialog: React.FC<Props> = ({ planId, doc, onClose, onLinked }) => {
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [days, setDays] = useState<NormalizedDay[] | null>(null);
  const [kind, setKind] = useState<'reservation' | 'event'>('reservation');
  const [picked, setPicked] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!doc) return;
    let alive = true;
    setPicked(''); setErr(null);
    Promise.all([getReservations(planId), api.getPlanDetail(planId)])
      .then(([rs, plan]) => { if (alive) { setReservations(rs); setDays(plan.data.days || []); } })
      .catch((e) => { if (alive) { setErr(errorDetailMessage(e, '関連付けの候補を読めませんでした')); setReservations([]); setDays([]); } });
    return () => { alive = false; };
  }, [doc, planId]);

  const targets: LinkTarget[] = useMemo(
    () => linkCandidates(doc?.original_filename ?? '', reservations ?? [], days ?? []),
    [doc, reservations, days],
  );
  const shown = targets.filter((t) => t.kind === kind);
  const suggested = targets.filter((t) => t.score > 0).slice(0, 3);

  const save = async () => {
    if (!doc || !picked) return;
    const t = targets.find((x) => x.key === picked);
    if (!t) return;
    setSaving(true); setErr(null);
    try {
      await createDocumentLink(planId, doc.id, { entity_type: t.kind, entity_id: t.id });
      onLinked();
      onClose();
    } catch (e) {
      setErr(errorDetailMessage(e, '関連付けられませんでした'));
    } finally {
      setSaving(false);
    }
  };

  const Option: React.FC<{ t: LinkTarget }> = ({ t }) => (
    <li>
      <label className="tc-kit-pick">
        <input type="radio" name="doc-link-target" value={t.key} checked={picked === t.key} onChange={() => setPicked(t.key)} />
        <span className="min-w-0"><b>{`${t.kind === 'reservation' ? '予約' : '予定'}: ${t.title}`}</b>
          <small>{[t.sub, t.score > 0 ? 'ファイル名が似ています' : null].filter(Boolean).join(' · ')}</small></span>
      </label>
    </li>
  );

  return (
    <Modal isOpen={!!doc} onClose={onClose} title="関連付ける" size="md">
      <Modal.Body>
        {doc && (
          <div className="space-y-4" data-testid="doc-link-dialog">
            <p className="m-0 text-sm"><b>{doc.original_filename ?? '文書'}</b></p>
            <p className="m-0 text-xs text-ink-700">文書は複製せず、参照だけを足します。あとで外せます。</p>
            {err && <p className="m-0 text-sm text-red-800" role="alert">{err}</p>}
            {reservations == null ? <p className="m-0 text-sm text-ink-700" aria-busy="true">候補を読み込み中…</p> : (
              <>
                {suggested.length > 0 && (
                  <fieldset className="tc-kit-fieldset">
                    <legend>合いそうな候補</legend>
                    <ul className="tc-kit-picklist">{suggested.map((t) => <Option key={`s${t.key}`} t={t} />)}</ul>
                  </fieldset>
                )}
                <fieldset className="tc-kit-fieldset">
                  <legend>ほかから選ぶ</legend>
                  <div className="tc-kit-seg-mini" role="group" aria-label="関連付ける先の種類">
                    {(['reservation', 'event'] as const).map((k) => (
                      <button key={k} type="button" className="tc-focus-ring tc-kit-chipbtn" aria-pressed={kind === k} onClick={() => setKind(k)}>
                        {k === 'reservation' ? '予約' : '予定'}
                      </button>
                    ))}
                  </div>
                  {shown.length === 0
                    ? <p className="m-0 mt-2 text-sm text-ink-700">{kind === 'reservation' ? 'この旅行に予約がありません' : 'この旅行に予定がありません'}</p>
                    : <ul className="tc-kit-picklist">{shown.map((t) => <Option key={t.key} t={t} />)}</ul>}
                </fieldset>
              </>
            )}
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline" onClick={onClose}>やめる</Button>
        <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!picked || saving}>関連付ける</Button>
      </Modal.Footer>
    </Modal>
  );
};

export default DocumentLinkDialog;
