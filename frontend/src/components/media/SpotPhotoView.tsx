/**
 * [Gate SpotInfo] 行きたい場所の写真(Wikimedia Commons の 1 枚)。画像はサーバーが中継し(ブラウザから外部へ直接読まない)、
 * 作者・ライセンス・出典のページを写真と一緒に出す(ライセンスの条件)。読めない時は代わりの絵(fallback)を出す。
 */
import React, { useEffect, useState } from 'react';
import { getExternalThumb } from '@/services/api/g11discover';
import { getSpotPhotoMedia } from '@/services/api/spotIntake';
import { safeExternalUrl } from '@/utils/safeNavigation';

export interface SpotPhoto {
  provider: string; provider_id: string; title?: string | null; author?: string | null; license?: string | null;
  license_url?: string | null; source_page_url?: string | null;
}

/**
 * [Gate SpotOwnPhoto] provider=own は自分で入れた写真(spotId の写真の本文を読む)。file を渡すと保存の前の確認(その画像を出す)
 */
const SpotPhotoView: React.FC<{ photo: SpotPhoto | null; alt: string; fallback: React.ReactNode; className?: string;
  spotId?: string; file?: File | null }> = ({ photo, alt, fallback, className = '', spotId, file = null }) => {
  const own = !file && photo?.provider === 'own';
  const provider = photo?.provider ?? null;
  const providerId = photo?.provider_id ?? null;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    if (file) {
      objectUrl = URL.createObjectURL(file);
      setUrl(objectUrl);
      return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }
    if (!provider || !providerId || (provider === 'own' && !spotId)) {
      setFailed(true);
      return undefined;
    }
    const load = provider === 'own' ? getSpotPhotoMedia(spotId as string) : getExternalThumb(provider, providerId);
    load.then((b) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(b);
      setUrl(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [provider, providerId, spotId, file]);
  if (failed) return <>{fallback}</>;
  const page = safeExternalUrl(!file && !own ? photo?.source_page_url ?? null : null);
  const credit = !file && !own ? [photo?.author, photo?.license].filter(Boolean).join(' · ') : '';
  return (
    <figure className={`tc-spot-photo ${className}`.trim()} data-testid="spot-photo">
      {url ? <img src={url} alt={alt} /> : <span className="tc-spot-photo-wait" aria-hidden="true" />}
      <figcaption>
        {file || own ? <span>{file ? '保存すると入ります' : '自分の写真'}</span>
          : page ? <a href={page} target="_blank" rel="noopener noreferrer">{credit || 'Wikimedia Commons'}<span className="sr-only">(写真の出典を新しいタブで開く)</span></a>
            : <span>{credit || 'Wikimedia Commons'}</span>}
      </figcaption>
    </figure>
  );
};

export default SpotPhotoView;
