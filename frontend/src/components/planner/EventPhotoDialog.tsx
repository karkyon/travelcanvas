/**
 * [Gate G11] 予定のカードの写真(docs/ux/G11_UIUX全範囲_実装仕様.md §2.2・§3.3。画面の正本のモックの「写真を選ぶ」「写真を旅程に差し込む」)。
 * 旅行の写真から選ぶ、または外部の写真を探して取り込む(非公開の記録)。表紙と同じく記録の公開範囲は変えない。
 */
import React, { useEffect, useState } from 'react';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import ExternalPhotoPicker from '@/components/media/ExternalPhotoPicker';
import { getMemories, getMemoryMedia } from '@/services/api';
import { clearEventImage, setEventImage } from '@/services/api/g11discover';
import type { EventImage } from '@/services/api/types/g11discover';
import type { TravelMemory } from '@/services/api/types/memories';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  planId: string;
  eventId: string;
  eventTitle: string;
  near: { latitude: number; longitude: number } | null;
  current: EventImage | null;
  externalEnabled: boolean;
  onChanged: (image: EventImage | null) => void;
}

const Choice: React.FC<{ planId: string; m: TravelMemory; selected: boolean; onSelect: () => void }> = ({ planId, m, selected, onSelect }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    getMemoryMedia(planId, m.id).then((b) => { if (active) { objectUrl = URL.createObjectURL(b); setUrl(objectUrl); } })
      .catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [planId, m.id]);
  return (
    <li>
      <button type="button" aria-pressed={selected} onClick={onSelect} data-testid={`event-photo-choice-${m.id}`}
        className={`w-full rounded-lg border-2 p-1 text-left text-xs ${selected ? 'border-accent' : 'border-transparent'}`}>
        <span className="block aspect-[4/3] overflow-hidden rounded-md bg-cloud-100">
          {url && <img src={url} alt="" className="h-full w-full object-cover" />}
        </span>
        <span className="block truncate text-ink-900">{m.body || m.place_name || '写真'}</span>
        <span className="block text-ink-700">{`${m.visibility === 'private' ? '自分だけ' : 'メンバー'}${m.source ? '・外部の写真' : ''}`}</span>
      </button>
    </li>
  );
};

const EventPhotoDialog: React.FC<Props> = ({
  isOpen, onClose, planId, eventId, eventTitle, near, current, externalEnabled, onChanged,
}) => {
  const [photos, setPhotos] = useState<TravelMemory[] | null>(null);
  const [selected, setSelected] = useState<string | null>(current?.memory_id ?? null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelected(current?.memory_id ?? null);
    setError(null);
    getMemories(planId).then((l) => setPhotos(l.memories.filter((m) => m.kind === 'photo' && m.has_media)))
      .catch(() => { setPhotos([]); setError('写真の一覧を読み込めませんでした'); });
  }, [isOpen, planId, current]);

  const save = async (memoryId: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await setEventImage(planId, eventId, memoryId);
      onChanged(r.image);
      onClose();
    } catch {
      setError('予定の写真を保存できませんでした');
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await clearEventImage(planId, eventId);
      onChanged(null);
      onClose();
    } catch {
      setError('予定の写真を外せませんでした');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal isOpen={isOpen && !picker} onClose={onClose} title={`予定の写真(${eventTitle})`} size="lg">
        <div className="space-y-4" data-testid="event-photo-dialog">
          {error && <p role="alert" className="rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</p>}
          <section aria-label="この旅行の写真から選ぶ">
            <h3 className="text-sm font-semibold text-ink-900">この旅行の写真から選ぶ</h3>
            {photos === null && <p className="text-sm text-ink-700" role="status">読み込み中…</p>}
            {photos && photos.length === 0 && <p className="text-sm text-ink-700">まだ写真がありません。</p>}
            {photos && photos.length > 0 && (
              <ul className="mt-2 grid grid-cols-3 gap-2" aria-label="予定に使える写真">
                {photos.map((m) => <Choice key={m.id} planId={planId} m={m} selected={m.id === selected} onSelect={() => setSelected(m.id)} />)}
              </ul>
            )}
          </section>
          {externalEnabled && (
            <section aria-label="外部の写真を探す">
              <h3 className="text-sm font-semibold text-ink-900">場所の写真を探す</h3>
              <p className="text-xs text-ink-700">作者・ライセンスが分かる外部の写真を、この旅行内に非公開で取り込んでから使います。</p>
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setPicker(true)}
                data-testid="event-photo-external">外部の写真を探す</Button>
            </section>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-cloud-200 pt-3">
            {current && <Button type="button" variant="ghost" onClick={clear} disabled={busy} data-testid="event-photo-clear">写真を外す</Button>}
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>やめる</Button>
            <Button type="button" onClick={() => selected && save(selected)} disabled={!selected || busy} loading={busy}
              data-testid="event-photo-save">この写真を予定に使う</Button>
          </div>
        </div>
      </Modal>
      <ExternalPhotoPicker isOpen={isOpen && picker} onClose={() => setPicker(false)} planId={planId} initialQuery={eventTitle}
        near={near} eventId={eventId} purposeLabel="予定の写真" onImported={(m) => { setPicker(false); void save(m.id); }} />
    </>
  );
};

export default EventPhotoDialog;
