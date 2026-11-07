/**
 * [Gate SpotInfo] 候補のカードを押した時の詳細。メモ・出典・住所・地図へのリンク・まとめた候補を出し、
 * 「行きたい場所に保存」(保存してから住所・電話・公式サイト・食事の情報・写真を空の項目だけ自動で埋める)・
 * 「旅程に追加」へ進める。
 */
import React, { useState } from 'react';
import { ExternalLink, Heart, Map as MapIcon, MapPin, NotebookPen } from 'lucide-react';
import { Link } from 'react-router-dom';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import type { PlanCandidateItem } from '@/services/api';
import { createWishSpot, enrichWishSpot } from '@/services/api/spotIntake';
import { safeExternalUrl } from '@/utils/safeNavigation';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { FILLED_LABEL, wishCategory } from '../spotListModel';

interface Props {
  candidate: PlanCandidateItem | null;
  planId: string;
  canEdit: boolean;
  onClose: () => void;
  /** 旅程に追加(日・時刻はカードの欄で選ぶ) */
  onSchedule: (c: PlanCandidateItem) => void;
}

const CandidateDetailDialog: React.FC<Props> = ({ candidate: c, planId, canEdit, onClose, onSchedule }) => {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!c) return null;
  const source = safeExternalUrl(c.source_url);
  const map = c.latitude != null && c.longitude != null
    ? safeExternalUrl(`https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=16/${c.latitude}/${c.longitude}`) : null;
  const saveWish = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const created = await createWishSpot({
        name: c.title, category: wishCategory(c.category), address: c.address, latitude: c.latitude, longitude: c.longitude,
        description: [c.note, c.source_url].filter(Boolean).join('\n') || null,
      });
      let text = `「${c.title}」を行きたい場所に保存しました`;
      try {
        const r = await enrichWishSpot(created.id);
        if (r.filled.length) text += `。${r.filled.map((k) => FILLED_LABEL[k] ?? k).join('・')} を自動で入れました(© OpenStreetMap contributors)`;
      } catch { /* 自動取得は任意 */ }
      setNote(text);
    } catch (e) {
      setError(errorDetailMessage(e, '行きたい場所に保存できませんでした'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen onClose={onClose} title={c.title} size="md">
      <div className="space-y-3 text-sm text-ink-900" data-testid="candidate-detail">
        <p className="text-ink-700">{`${c.status_label} · ${c.created_by} が追加`}</p>
        {c.address && <p className="flex items-start gap-1.5"><MapPin size={15} aria-hidden="true" className="mt-0.5 shrink-0" />{c.address}</p>}
        {c.note && <p className="flex items-start gap-1.5 whitespace-pre-wrap"><NotebookPen size={15} aria-hidden="true" className="mt-0.5 shrink-0" />{c.note}</p>}
        {c.merged_from.length > 0 && <p>{`まとめた候補: ${c.merged_from.map((m) => m.title).join('、')}`}</p>}
        <p className="flex flex-wrap gap-3">
          {map && <a href={safeExternalUrl(map) ?? undefined} target="_blank" rel="noopener noreferrer" className="tc-focus-ring inline-flex items-center gap-1 text-accent underline">
            <MapIcon size={14} aria-hidden="true" />地図で見る<span className="sr-only">(新しいタブ)</span></a>}
          {source && <a href={safeExternalUrl(source) ?? undefined} target="_blank" rel="noopener noreferrer nofollow" className="tc-focus-ring inline-flex items-center gap-1 text-accent underline">
            <ExternalLink size={14} aria-hidden="true" />出典を開く<span className="sr-only">(新しいタブ)</span></a>}
          {c.place_id && <Link className="text-accent underline" to={`/planner/${planId}/places/${c.place_id}`}>場所の詳細</Link>}
        </p>
        {error && <p role="alert" className="text-danger">{error}</p>}
        {note && <p role="status" className="rounded-lg bg-cloud-100 p-2">{note}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="button" onClick={() => void saveWish()} loading={busy} disabled={busy} data-testid="candidate-save-wish"
            icon={<Heart size={15} aria-hidden="true" />}>行きたい場所に保存</Button>
          {canEdit && c.status === 'open' && (
            <Button type="button" variant="outline" onClick={() => { onSchedule(c); onClose(); }}>旅程に追加</Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>閉じる</Button>
        </div>
      </div>
    </Modal>
  );
};

export default CandidateDetailDialog;
