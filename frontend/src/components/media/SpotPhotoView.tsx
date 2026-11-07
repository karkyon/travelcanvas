/**
 * [Gate SpotInfo] 行きたい場所の写真(Wikimedia Commons の 1 枚)。画像はサーバーが中継し(ブラウザから外部へ直接読まない)、
 * 作者・ライセンス・出典のページを写真と一緒に出す(ライセンスの条件)。読めない時は代わりの絵(fallback)を出す。
 */
import React, { useEffect, useState } from 'react';
import { getExternalThumb } from '@/services/api/g11discover';
import { safeExternalUrl } from '@/utils/safeNavigation';

export interface SpotPhoto {
  provider: string; provider_id: string; title?: string | null; author?: string | null; license?: string | null;
  license_url?: string | null; source_page_url?: string | null;
}

const SpotPhotoView: React.FC<{ photo: SpotPhoto; alt: string; fallback: React.ReactNode; className?: string }> = ({
  photo, alt, fallback, className = '',
}) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    getExternalThumb(photo.provider, photo.provider_id).then((b) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(b);
      setUrl(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.provider, photo.provider_id]);
  if (failed) return <>{fallback}</>;
  const page = safeExternalUrl(photo.source_page_url ?? null);
  const credit = [photo.author, photo.license].filter(Boolean).join(' · ');
  return (
    <figure className={`tc-spot-photo ${className}`.trim()} data-testid="spot-photo">
      {url ? <img src={url} alt={alt} /> : <span className="tc-spot-photo-wait" aria-hidden="true" />}
      <figcaption>
        {page ? <a href={page} target="_blank" rel="noopener noreferrer">{credit || 'Wikimedia Commons'}<span className="sr-only">(写真の出典を新しいタブで開く)</span></a>
          : <span>{credit || 'Wikimedia Commons'}</span>}
      </figcaption>
    </figure>
  );
};

export default SpotPhotoView;
