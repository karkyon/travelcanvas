/**
 * [Gate G11] 旅行の表紙の写真を選ぶ・取り込む・位置を整える(docs/ux/G11_UIUX全範囲_実装仕様.md §3.1、
 * 画面の正本 docs/ux/references/TravelCanvas_UIUX_Mock_2026-10-28.html のホーム・記録の表紙)。
 *
 * - 「この旅行の写真から選ぶ」: 見える写真の記録(自分の記録と、メンバーに公開された記録)。公開範囲を並べて出す
 * - 「写真を取り込む」: この旅行内に非公開(自分だけ)の記録として保存する(撮影情報はサーバーが取り除く)
 * - 位置の調整: 横・縦(0〜100 %)・拡大(100〜300 %)。hero・header・card の3つの大きさで同じ見え方を確かめる
 * - 非公開の写真を表紙にした時は、他の人にはこれまでの色の表紙が見えることを明示する
 * 表紙の参照だけを変える(記録の公開範囲は変えない。写真を消すのは記録の画面)。
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import TripCover from './TripCover';
import { getMemories, getMemoryMedia, uploadMemory } from '@/services/api';
import { clearPlanCover, setPlanCover } from '@/services/api/g11';
import type { PlanCover } from '@/services/api/types/g11';
import type { TravelMemory } from '@/services/api/types/memories';
import { bumpCover, creditOf } from '@/hooks/useCoverPhoto';
import ExternalPhotoPicker from '@/components/media/ExternalPhotoPicker';
import { getMediaProviderStatus } from '@/services/api/g11discover';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

export interface CoverPhotoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  planId: string;
  tripTitle: string;
  destination?: string | null;
  startDate?: string | null;
  current: PlanCover | null;
  onSaved: (cover: PlanCover | null) => void;
}

/** バイト数の表示(1MB 未満は KB) */
function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.floor(bytes / (1024 * 1024))}MB` : `${Math.max(1, Math.floor(bytes / 1024))}KB`;
}

function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (detail && typeof detail === 'object' && typeof (detail as { message?: unknown }).message === 'string') {
    return (detail as { message: string }).message;
  }
  if (typeof detail === 'string') return detail;
  if ((e as { response?: unknown })?.response === undefined) return '通信できませんでした。接続を確かめてからもう一度お試しください';
  return fallback;
}

/** 記録の写真の一時の URL(一覧・プレビュー用)。読めなければ null */
function useMemoryThumb(planId: string, memoryId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!memoryId) return undefined;
    let active = true;
    let objectUrl: string | null = null;
    getMemoryMedia(planId, memoryId).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [planId, memoryId]);
  return url;
}

const PhotoChoice: React.FC<{ planId: string; memory: TravelMemory; selected: boolean; onSelect: () => void }> = ({
  planId, memory, selected, onSelect,
}) => {
  const url = useMemoryThumb(planId, memory.id);
  const label = memory.body || memory.place_name || '写真';
  return (
    <li>
      <button type="button" onClick={onSelect} aria-pressed={selected}
        data-testid={`cover-choice-${memory.id}`}
        className={`w-full rounded-lg border-2 p-1 text-left text-xs ${selected ? 'border-accent' : 'border-transparent'}`}>
        <span className="block aspect-[4/3] overflow-hidden rounded-md bg-cloud-100">
          {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <span className="sr-only">読み込み中</span>}
        </span>
        <span className="mt-1 block truncate text-ink-900">{label}</span>
        <span className="block text-ink-700">
          {memory.visibility === 'private' ? '自分だけ' : 'メンバー'}{memory.source ? '・外部の写真' : ''}
          {selected ? '・選択中' : ''}
        </span>
      </button>
    </li>
  );
};

const Range: React.FC<{ label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void;
  testId: string }> = ({ label, value, min, max, unit, onChange, testId }) => {
  const id = useId();
  const step = max - min > 100 ? 10 : 5;
  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor={id} className="w-20 shrink-0 text-ink-700">{label}</label>
      <Button type="button" variant="outline" size="sm" aria-label={`${label}を減らす`}
        onClick={() => onChange(Math.max(min, value - step))}>−</Button>
      <input id={id} type="range" min={min} max={max} step={1} value={value} data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1" />
      <Button type="button" variant="outline" size="sm" aria-label={`${label}を増やす`}
        onClick={() => onChange(Math.min(max, value + step))}>＋</Button>
      <output htmlFor={id} className="w-14 text-right tabular-nums text-ink-900">{`${value}${unit}`}</output>
    </div>
  );
};

const CoverPhotoDialog: React.FC<CoverPhotoDialogProps> = ({
  isOpen, onClose, planId, tripTitle, destination, startDate, current, onSaved,
}) => {
  const [photos, setPhotos] = useState<TravelMemory[] | null>(null);
  const [maxBytes, setMaxBytes] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(current?.memory_id ?? null);
  const [pos, setPos] = useState({ focus_x: current?.focus_x ?? 50, focus_y: current?.focus_y ?? 50, zoom: current?.zoom ?? 100 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // [Gate G11] 外部の写真(provider が止めてあれば項目ごと出さない)
  const [externalEnabled, setExternalEnabled] = useState(false);
  const [picker, setPicker] = useState(false);
  useEffect(() => {
    if (!isOpen) return undefined;
    let active = true;
    getMediaProviderStatus().then((s) => { if (active) setExternalEnabled(s.image_providers.length > 0); })
      .catch(() => { if (active) setExternalEnabled(false); });
    return () => { active = false; };
  }, [isOpen]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await getMemories(planId);
      setPhotos(list.memories.filter((m) => m.kind === 'photo' && m.has_media));
      setMaxBytes(list.max_upload_bytes);
    } catch (e) {
      setPhotos([]);
      setError(errorMessage(e, '写真の一覧を読み込めませんでした'));
    }
  }, [planId]);

  useEffect(() => {
    if (!isOpen) return;
    setSelected(current?.memory_id ?? null);
    setPos({ focus_x: current?.focus_x ?? 50, focus_y: current?.focus_y ?? 50, zoom: current?.zoom ?? 100 });
    setNotice(null);
    void load();
  }, [isOpen, current, load]);

  const chosen = useMemo(() => photos?.find((m) => m.id === selected) ?? null, [photos, selected]);
  const previewUrl = useMemoryThumb(planId, selected);
  const previewPhoto = previewUrl
    ? { src: previewUrl, focusX: pos.focus_x, focusY: pos.focus_y, zoom: pos.zoom, credit: creditOf(chosen?.source ?? null) }
    : null;

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (maxBytes && file.size > maxBytes) {
      setError(`ファイルが大きすぎます(上限 ${sizeLabel(maxBytes)})`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const m = await uploadMemory(planId, { kind: 'photo', file, visibility: 'private', include_in_journal: false });
      setPhotos((prev) => [...(prev ?? []), m]);
      setSelected(m.id);
      setPos({ focus_x: 50, focus_y: 50, zoom: 100 });
      setNotice('写真をこの旅行内に非公開(自分だけ)で保存しました。撮影情報(撮影位置など)は取り除いてあります');
    } catch (err) {
      setError(errorMessage(err, '写真を取り込めませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const r = await setPlanCover(planId, selected, pos);
      bumpCover(planId);
      onSaved(r.cover);
      onClose();
    } catch (e) {
      setError(errorMessage(e, '表紙を保存できませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      await clearPlanCover(planId);
      bumpCover(planId);
      onSaved(null);
      onClose();
    } catch (e) {
      setError(errorMessage(e, '表紙を外せませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const limit = maxBytes ? sizeLabel(maxBytes) : null;
  return (
    <>
    <ExternalPhotoPicker isOpen={isOpen && picker} onClose={() => setPicker(false)} planId={planId}
      initialQuery={destination || tripTitle} purposeLabel="旅行の表紙"
      onImported={(m) => {
        setPhotos((prev) => [...(prev ?? []), m]);
        setSelected(m.id);
        setPos({ focus_x: 50, focus_y: 50, zoom: 100 });
        setNotice('外部の写真をこの旅行内に非公開(自分だけ)で取り込みました。作者・ライセンスは表紙に表示します');
      }} />
    <Modal isOpen={isOpen && !picker} onClose={onClose} title="旅行の表紙の写真" size="xl">
      <div className="space-y-5" data-testid="cover-photo-dialog">
        {error && <p role="alert" className="rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</p>}
        {notice && <p role="status" className="rounded-md bg-success-soft p-3 text-sm text-success">{notice}</p>}

        <section aria-labelledby="cover-pick-title">
          <h3 id="cover-pick-title" className="text-sm font-semibold text-ink-900">この旅行の写真から選ぶ</h3>
          {photos === null && <p className="mt-2 text-sm text-ink-700" role="status">読み込み中…</p>}
          {photos && photos.length === 0 && (
            <p className="mt-2 text-sm text-ink-700">まだ選べる写真がありません。下の「写真を取り込む」から追加できます。</p>
          )}
          {photos && photos.length > 0 && (
            <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="表紙にできる写真">
              {photos.map((m) => (
                <PhotoChoice key={m.id} planId={planId} memory={m} selected={m.id === selected}
                  onSelect={() => { setSelected(m.id); setNotice(null); }} />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="cover-upload-title">
          <h3 id="cover-upload-title" className="text-sm font-semibold text-ink-900">写真を取り込む</h3>
          <p className="mt-1 text-xs text-ink-700">
            {`JPEG・PNG・WebP・GIF${limit ? `、${limit} まで` : ''}。この旅行内に非公開(自分だけ)で保存します。撮影情報(撮影位置など)は取り除きます。`}
          </p>
          <input ref={fileRef} type="file" accept={ACCEPT} className="sr-only" onChange={onFile}
            data-testid="cover-upload-input" aria-label="表紙にする写真のファイル" />
          <Button type="button" variant="outline" size="sm" className="mt-2" disabled={busy}
            onClick={() => fileRef.current?.click()}>写真のファイルを選ぶ</Button>
        </section>

        {externalEnabled && (
          <section aria-labelledby="cover-external-title">
            <h3 id="cover-external-title" className="text-sm font-semibold text-ink-900">外部の写真を探す</h3>
            <p className="mt-1 text-xs text-ink-700">作者・ライセンスが分かる写真(CC0・パブリックドメイン・CC BY・CC BY-SA)だけを取り込めます。</p>
            <Button type="button" variant="outline" size="sm" className="mt-2" disabled={busy}
              onClick={() => setPicker(true)} data-testid="cover-external">外部の写真を探す</Button>
          </section>
        )}

        {selected && (
          <section aria-labelledby="cover-adjust-title" className="space-y-3">
            <h3 id="cover-adjust-title" className="text-sm font-semibold text-ink-900">見せる位置と拡大</h3>
            <Range label="横の位置" value={pos.focus_x} min={0} max={100} unit="%" testId="cover-focus-x"
              onChange={(v) => setPos((p) => ({ ...p, focus_x: v }))} />
            <Range label="縦の位置" value={pos.focus_y} min={0} max={100} unit="%" testId="cover-focus-y"
              onChange={(v) => setPos((p) => ({ ...p, focus_y: v }))} />
            <Range label="拡大" value={pos.zoom} min={100} max={300} unit="%" testId="cover-zoom"
              onChange={(v) => setPos((p) => ({ ...p, zoom: v }))} />
            <div className="grid gap-3 md:grid-cols-3" aria-label="表紙のプレビュー(大・見出し・カード)">
              {(['hero', 'header', 'card'] as const).map((size) => (
                <figure key={size} className="m-0">
                  <TripCover size={size} tripTitle={tripTitle} destination={destination} startDate={startDate}
                    photo={previewPhoto} data-testid={`cover-preview-${size}`}>
                    <p className="font-semibold break-words">{tripTitle}</p>
                  </TripCover>
                  <figcaption className="mt-1 text-xs text-ink-700">
                    {size === 'hero' ? 'ダッシュボード' : size === 'header' ? '旅程の見出し' : '旅行のカード'}
                  </figcaption>
                </figure>
              ))}
            </div>
            {chosen?.visibility === 'private' && (
              <p className="text-xs text-ink-700" data-testid="cover-private-note">
                この写真は「自分だけ」の記録です。表紙はあなたにだけ写真で表示され、他のメンバーにはこれまでの色の表紙が表示されます。
              </p>
            )}
          </section>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-cloud-200 pt-4">
          {current && (
            <Button type="button" variant="ghost" onClick={clear} disabled={busy} data-testid="cover-clear">写真を外す</Button>
          )}
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>やめる</Button>
          <Button type="button" onClick={save} disabled={!selected || busy} loading={busy} data-testid="cover-save">
            この写真を旅行の表紙に使う
          </Button>
        </div>
      </div>
    </Modal>
    </>
  );
};

export default CoverPhotoDialog;
