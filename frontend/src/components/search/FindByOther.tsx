/**
 * [Gate SpotFind] 写真・声・SNS から場所を探す入力(スポット検索と、旅行をつくる時の場所の検索で共有する)。
 *
 * - 写真から探す: 写真(JPEG)の撮影場所(Exif の GPS)を端末の中で読み、その周りの場所を探す。写真はサーバーへ送らない。
 *   位置の無い写真(位置情報を切って撮った・SNS から保存した・HEIC など)は、その旨を示し、ほかの探し方へ案内する
 * - 声で探す: 端末の音声認識(Web Speech API)で話した言葉を文字にして、その言葉で探す。録音は保存しない
 * - SNS から探す: 投稿の文(ハッシュタグ・「」・📍など)を貼ると探す言葉を拾う。URL の中身は取りに行かない
 */
import React, { useEffect, useState } from 'react';
import PasteImageButton from '@/components/media/PasteImageButton';
import { ImagePlus } from 'lucide-react';
import { VoiceInput } from '@/pages/consult/ConsultInputs';
import { FIND_MODE_HELP, readExifGps, snsKeywords, type GpsPoint } from './findModel';

export type FindMode = 'image' | 'voice' | 'sns';

interface Props {
  mode: FindMode;
  /** 言葉で探す(声・SNS から拾った言葉) */
  onKeyword: (q: string) => void;
  /** 写真の撮影場所の周りを探す */
  onPhotoPlace: (p: GpsPoint) => void;
  busy?: boolean;
}


function readBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

const PhotoFinder: React.FC<{ onPhotoPlace: Props['onPhotoPlace']; busy?: boolean }> = ({ onPhotoPlace, busy }) => {
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [point, setPoint] = useState<GpsPoint | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const onFile = async (file: File | undefined) => {
    setNote(null);
    setPoint(null);
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    if (!/jpe?g$/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) {
      setNote('位置情報を読めるのは JPEG の写真です(HEIC・PNG・SNS から保存した写真は、撮った場所を持っていないことが多いです)。'
        + '「声で探す」「SNS から探す」か、場所の名前で探してください。');
      return;
    }
    let gps: GpsPoint | null = null;
    try {
      gps = readExifGps(await readBuffer(file));
    } catch {
      gps = null;
    }
    if (!gps) {
      setNote('この写真には撮った場所(位置情報)がありません。カメラの位置情報を入れて撮った写真か、場所の名前で探してください。');
      return;
    }
    setPoint(gps);
    onPhotoPlace(gps);
  };
  return (
    <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]" data-testid="find-photo">
      <label className="tc-focus-ring grid min-h-32 cursor-pointer place-items-center overflow-hidden rounded-xl border-2 border-dashed border-cloud-200 bg-cloud-0 text-center text-sm text-ink-700">
        {preview ? <img src={preview} alt="選んだ写真" className="h-32 w-full object-cover" />
          : <span className="grid place-items-center gap-1 p-3"><ImagePlus size={28} aria-hidden="true" />写真を選ぶ</span>}
        <input type="file" accept="image/jpeg,image/*" className="sr-only" aria-label="探す写真を選ぶ" disabled={busy}
          onChange={(e) => void onFile(e.target.files?.[0])} data-testid="find-photo-input" />
      </label>
      {/* [Gate PhotoPasteAll] 写真を入れる所は、どこでもクリップボードから貼れる */}
      <div className="sm:col-span-2 -mt-1"><PasteImageButton onImage={(f) => void onFile(f)} disabled={busy} testId="find-photo-paste" /></div>
      <div className="text-sm text-ink-900" aria-live="polite">
        <p className="text-ink-700">{FIND_MODE_HELP.image}</p>
        {point && (
          <p className="mt-2 font-semibold" data-testid="find-photo-point">
            {`撮った場所: 緯度 ${point.latitude.toFixed(4)}・経度 ${point.longitude.toFixed(4)}`}
            {point.takenAt && <span className="ml-1 font-normal text-ink-700">{`(${point.takenAt.slice(0, 10).replace(/:/g, '/')} 撮影)`}</span>}
            <span className="block font-normal text-ink-700">この周りの場所を探しました。</span>
          </p>
        )}
        {note && <p className="mt-2 text-warning" role="status" data-testid="find-photo-note">{note}</p>}
      </div>
    </div>
  );
};

const SnsFinder: React.FC<{ onKeyword: Props['onKeyword']; busy?: boolean }> = ({ onKeyword, busy }) => {
  const [text, setText] = useState('');
  const [result, setResult] = useState<ReturnType<typeof snsKeywords> | null>(null);
  return (
    <div data-testid="find-sns">
      <label htmlFor="find-sns-text" className="text-sm font-semibold text-ink-900">投稿の文を貼る</label>
      <textarea id="find-sns-text" rows={3} value={text} onChange={(e) => { setText(e.target.value); setResult(null); }}
        placeholder="例: 伊勢神宮にお参り #おかげ横丁 #赤福 場所: 伊勢市"
        className="tc-focus-ring mt-1 block w-full rounded-xl border border-cloud-200 bg-cloud-0 px-3 py-2 text-sm text-ink-900" />
      <p className="mt-1 text-xs text-ink-700">{FIND_MODE_HELP.sns}</p>
      <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary mt-2" disabled={!text.trim() || busy}
        onClick={() => setResult(snsKeywords(text))} data-testid="find-sns-pick">場所の言葉を拾う</button>
      {result && (
        result.keywords.length === 0 ? (
          <p className="mt-2 text-sm text-warning" role="status" data-testid="find-sns-none">
            {result.urlOnly ? 'URL だけでは中身を読めません。投稿の文(場所の名前・ハッシュタグ)をコピーして貼ってください。'
              : '場所の名前らしい言葉を見つけられませんでした。ハッシュタグか場所の名前を含む文を貼ってください。'}
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="拾った言葉(押すと探す)">
            {result.keywords.map((k) => (
              <button key={k} type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" disabled={busy}
                onClick={() => onKeyword(k)} data-testid={`find-sns-word-${k}`}>{`「${k}」で探す`}</button>
            ))}
          </div>
        )
      )}
    </div>
  );
};

const FindByOther: React.FC<Props> = ({ mode, onKeyword, onPhotoPlace, busy }) => {
  if (mode === 'image') return <PhotoFinder onPhotoPlace={onPhotoPlace} busy={busy} />;
  if (mode === 'sns') return <SnsFinder onKeyword={onKeyword} busy={busy} />;
  return (
    <div data-testid="find-voice">
      <p className="mb-2 text-sm text-ink-700">{FIND_MODE_HELP.voice}</p>
      <VoiceInput onAdd={(t) => { const q = t.trim(); if (q) onKeyword(q); }} />
    </div>
  );
};

export default FindByOther;
