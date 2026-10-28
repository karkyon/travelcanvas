/**
 * [Gate G11] 外部の写真を探して取り込む(docs/ux/G11_UIUX全範囲_実装仕様.md §3.3・§5.3、UIX-M14)。
 *
 * - 候補ごとに作者・ライセンス・出典のページ・取得日を出す。ライセンスが許さないもの(非商用・改変禁止・不明)は取り込めない
 * - 縮小画像はサーバーが提供元から取り直して中継する(ブラウザから外部へ直接読みに行かない)
 * - 「この写真を使う」でサーバーが取り込み、この旅行内に非公開(自分だけ)の記録として保存する(撮影情報の除去・暗号化)
 * - 提供元が止めてある・つながらない時は、取れたように見せない
 */
import React, { useEffect, useId, useState } from 'react';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import { getExternalThumb, importExternalImage, searchExternalImages } from '@/services/api/g11discover';
import type { ExternalImage } from '@/services/api/types/g11discover';
import type { TravelMemory } from '@/services/api/types/memories';
import { safeExternalUrl } from '@/utils/safeNavigation';

export interface ExternalPhotoPickerProps {
  isOpen: boolean;
  onClose: () => void;
  planId: string;
  initialQuery?: string;
  near?: { latitude: number; longitude: number } | null;
  eventId?: string | null;
  /** 取り込んだ記録(非公開の写真) */
  onImported: (memory: TravelMemory) => void;
  purposeLabel: string;
}

function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (detail && typeof detail === 'object' && typeof (detail as { message?: unknown }).message === 'string') {
    return (detail as { message: string }).message;
  }
  if ((e as { response?: unknown })?.response === undefined) return '通信できませんでした。接続を確かめてからもう一度お試しください';
  return fallback;
}

const Thumb: React.FC<{ image: ExternalImage }> = ({ image }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    getExternalThumb(image.provider, image.provider_id).then((b) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(b);
      setUrl(objectUrl);
    }).catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image.provider, image.provider_id]);
  return (
    <span className="block aspect-[4/3] overflow-hidden rounded-md bg-cloud-100">
      {url ? <img src={url} alt={image.title ?? ''} className="h-full w-full object-cover" />
        : <span className="flex h-full items-center justify-center text-xs text-ink-700">{failed ? '縮小画像を読めません' : '読み込み中'}</span>}
    </span>
  );
};

const ExternalPhotoPicker: React.FC<ExternalPhotoPickerProps> = ({
  isOpen, onClose, planId, initialQuery = '', near = null, eventId = null, onImported, purposeLabel,
}) => {
  const qid = useId();
  const [query, setQuery] = useState(initialQuery);
  const [useNear, setUseNear] = useState(Boolean(near));
  const [images, setImages] = useState<ExternalImage[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery(initialQuery);
    setUseNear(Boolean(near));
    setImages(null);
    setError(null);
    setUnavailable(null);
  }, [isOpen, initialQuery, near]);

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy('search');
    setError(null);
    try {
      const r = await searchExternalImages(useNear ? null : query.trim() || null,
        useNear && near ? near.latitude : null, useNear && near ? near.longitude : null);
      setImages(r.images);
      setUnavailable(r.unavailable.length ? '一部の提供元につながりませんでした(見つかった分だけ出しています)' : null);
    } catch (err) {
      setImages([]);
      setError(errorMessage(err, '外部の写真を探せませんでした'));
    } finally {
      setBusy(null);
    }
  };

  const choose = async (img: ExternalImage) => {
    setBusy(img.provider_id);
    setError(null);
    try {
      const m = await importExternalImage(planId, img.provider, img.provider_id, eventId);
      onImported(m);
      onClose();
    } catch (err) {
      setError(errorMessage(err, '写真を取り込めませんでした'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`外部の写真を探す(${purposeLabel})`} size="xl">
      <div className="space-y-4" data-testid="external-photo-picker">
        <p className="text-xs text-ink-700">
          Wikimedia Commons などの、作者・ライセンスが分かる写真だけを出します。使う写真は、この旅行内に非公開(自分だけ)の記録として
          取り込み、撮影情報を取り除きます。作者・ライセンスは写真と一緒に表示します。
        </p>
        <form className="flex flex-wrap items-end gap-2" onSubmit={search} aria-label="外部の写真を探す">
          <div className="min-w-0 flex-1">
            <label htmlFor={qid} className="block text-sm text-ink-700">探す言葉</label>
            <input id={qid} value={query} onChange={(e) => setQuery(e.target.value)} disabled={useNear}
              className="mt-1 w-full rounded-md border border-cloud-200 bg-surface px-3 py-2 text-ink-900" />
          </div>
          {near && (
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" checked={useNear} onChange={(e) => setUseNear(e.target.checked)} />
              この場所の近くで撮られた写真
            </label>
          )}
          <Button type="submit" loading={busy === 'search'} disabled={Boolean(busy) || (!useNear && !query.trim())}>探す</Button>
        </form>
        {error && <p role="alert" className="rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</p>}
        {unavailable && <p role="status" className="text-xs text-warning">{unavailable}</p>}
        {images && images.length === 0 && !error && (
          <p className="text-sm text-ink-700" role="status">見つかりませんでした。言葉を変えて探してください。</p>
        )}
        {images && images.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-label="外部の写真の候補">
            {images.map((img) => {
              const page = safeExternalUrl(img.source_page_url);
              return (
                <li key={`${img.provider}:${img.provider_id}`} className="rounded-lg border border-cloud-200 p-2 text-xs"
                  data-testid={`external-image-${img.provider_id}`}>
                  <Thumb image={img} />
                  <p className="mt-1 font-semibold text-ink-900 break-words">{img.title ?? img.provider_id}</p>
                  <p className="text-ink-700">{`作者: ${img.author ?? '不明'}`}</p>
                  <p className="text-ink-700">{`ライセンス: ${img.license ?? '不明'}`}</p>
                  <p className="text-ink-700">{`取得: ${img.retrieved_at.slice(0, 10)}・Wikimedia Commons`}</p>
                  {page && <a href={page} target="_blank" rel="noopener noreferrer" className="text-accent underline">出典のページ</a>}
                  <div className="mt-2">
                    {img.importable ? (
                      <Button type="button" size="sm" onClick={() => choose(img)} loading={busy === img.provider_id}
                        disabled={Boolean(busy)} data-testid={`external-use-${img.provider_id}`}>この写真を使う</Button>
                    ) : (
                      <span className="text-danger" data-testid={`external-blocked-${img.provider_id}`}>使えないライセンス(取り込めません)</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
};

export default ExternalPhotoPicker;
