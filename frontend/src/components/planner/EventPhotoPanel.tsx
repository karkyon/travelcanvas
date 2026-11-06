/**
 * [Gate PlanSpotEdit] スポットの編集の画面の写真(課題 #3-⑦・③)。
 * 写真があれば上に出し(出典つき)、「写真を変える」で旅行の写真・外部の写真・ファイルから選べる。
 * 無ければドラッグ&ドロップかファイルの選択で入れる枠を出す。写真を変えたら onChanged(旅程の予定のカードも読み直す)。
 */
import React, { useEffect, useState } from 'react';
import Button from '@/components/common/Button';
import { getEventImageMedia, getEventImages, getMediaProviderStatus } from '@/services/api/g11discover';
import type { EventImage } from '@/services/api/types/g11discover';
import { creditOf } from '@/hooks/useCoverPhoto';
import EventPhotoDialog from './EventPhotoDialog';
import EventPhotoDrop from './EventPhotoDrop';

interface Props {
  planId: string;
  eventId: string;
  eventTitle: string;
  near: { latitude: number; longitude: number } | null;
  onChanged: () => void;
}

const EventPhotoPanel: React.FC<Props> = ({ planId, eventId, eventTitle, near, onChanged }) => {
  const [image, setImage] = useState<EventImage | null | undefined>(undefined);
  const [url, setUrl] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(false);
  const [external, setExternal] = useState(false);

  useEffect(() => {
    let alive = true;
    getEventImages(planId).then((m) => { if (alive) setImage(m[eventId] ?? null); }).catch(() => { if (alive) setImage(null); });
    return () => { alive = false; };
  }, [planId, eventId, version]);
  useEffect(() => {
    if (!image) { setUrl(null); return undefined; }
    let alive = true;
    let made: string | null = null;
    getEventImageMedia(planId, eventId).then((b) => {
      made = URL.createObjectURL(b);
      if (alive) setUrl(made); else URL.revokeObjectURL(made);
    }).catch(() => undefined);
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [planId, eventId, image]);
  useEffect(() => {
    let alive = true;
    getMediaProviderStatus().then((s) => { if (alive) setExternal(s.image_providers.length > 0); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const changed = () => { setVersion((v) => v + 1); onChanged(); };
  if (image === undefined) return null;
  const credit = image ? creditOf(image.source) : null;
  return (
    <section aria-label="予定の写真" data-testid="edit-photo">
      {image ? (
        <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-3">
          <div className="aspect-[4/3] overflow-hidden rounded-lg border border-cloud-200 bg-cloud-100">
            {url && <img src={url} alt={`${eventTitle}の写真`} className="h-full w-full object-cover" data-testid="edit-photo-img" />}
          </div>
          <div className="space-y-2 text-xs text-ink-700">
            {credit && <p>{credit}</p>}
            <Button type="button" size="sm" variant="outline" onClick={() => setDialog(true)} data-testid="edit-photo-change">写真を変える</Button>
          </div>
        </div>
      ) : (
        <EventPhotoDrop planId={planId} eventId={eventId} eventTitle={eventTitle} compact onUploaded={() => changed()} />
      )}
      {dialog && (
        <EventPhotoDialog isOpen onClose={() => setDialog(false)} planId={planId} eventId={eventId} eventTitle={eventTitle}
          near={near} current={image} externalEnabled={external} onChanged={() => changed()} />
      )}
    </section>
  );
};

export default EventPhotoPanel;
