/**
 * [Gate PlanSpotEdit] 予定の写真を入れる枠(課題 #3-③)。枠へドラッグ&ドロップするか、押してファイルを選ぶ。
 * 選んだらすぐ取り込み、予定の写真にする(取り込んだ写真は「自分だけ」)。
 */
import React, { useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import type { EventImage } from '@/services/api/types/g11discover';
import { PHOTO_TYPES, uploadEventPhoto } from './eventPhoto';

interface Props {
  planId: string;
  eventId: string;
  eventTitle: string;
  onUploaded: (image: EventImage | null) => void;
  compact?: boolean;
}

const EventPhotoDrop: React.FC<Props> = ({ planId, eventId, eventTitle, onUploaded, compact = false }) => {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const take = async (file: File | undefined) => {
    if (!file || busy) return;
    if (!PHOTO_TYPES.includes(file.type)) { setError('JPEG・PNG・WebP の画像を入れてください'); return; }
    setBusy(true);
    setError(null);
    try {
      onUploaded(await uploadEventPhoto(planId, eventId, file, eventTitle));
    } catch {
      setError('写真を取り込めませんでした(大きさ・形式を確かめてください)');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label data-testid="event-photo-drop"
        className={`tc-focus-ring grid cursor-pointer place-items-center rounded-xl border-2 border-dashed text-center ${compact ? 'min-h-24 p-3' : 'min-h-32 p-4'} ${over ? 'tc-drop-over' : 'border-cloud-200 bg-cloud-50'}`}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files[0]); }}>
        <span className="grid place-items-center gap-1 text-sm text-ink-900">
          <ImagePlus size={compact ? 22 : 28} aria-hidden="true" />
          <b>{busy ? '取り込んでいます…' : '写真をここにドラッグ&ドロップ'}</b>
          <span className="text-xs text-ink-700">または押してファイルを選ぶ(JPEG・PNG・WebP。自分だけに保存)</span>
        </span>
        <input ref={input} type="file" accept={PHOTO_TYPES.join(',')} className="sr-only" aria-label="予定の写真のファイルを選ぶ"
          disabled={busy} data-testid="event-photo-file" onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
};

export default EventPhotoDrop;
