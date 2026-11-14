/**
 * [Gate Receipt] 画像を入れる場所。枠へドラッグ&ドロップするか、押してファイルを選ぶ。選んだ画像は小さく確認できる。
 * [Gate HomeLive] camera: スマホ・タブレット(指で操作する端末)では「カメラで撮る」を出す(後ろのカメラを優先)。
 * PC では出さない(capture が効かずファイルの選択と同じになるため)。撮り直し・別の画像・貼り付けは結果の後もできる。
 * maxBytes: 大きすぎる画像は理由を出して受け付けない。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus } from 'lucide-react';
import PasteImageButton from '@/components/media/PasteImageButton';

interface Props {
  label: string;
  hint: string;
  file: File | null;
  onFile: (file: File) => void;
  disabled?: boolean;
  /** 画像の隣に出す内容(読み取った項目など) */
  children?: React.ReactNode;
  /** [Gate PhotoPasteAll] クリップボードから貼り付け(既定は出す)。同じ画面に 2 つある時は片方だけ global にする */
  paste?: boolean;
  pasteGlobal?: boolean;
  pasteTestId?: string;
  camera?: boolean;
  maxBytes?: number;
}

/** 指で操作する端末か(カメラで撮るを出すか) */
function touchDevice(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

const ImageDropzone: React.FC<Props> = ({ label, hint, file, onFile, disabled = false, children, paste = true,
  pasteGlobal = true, pasteTestId = 'image-dropzone-paste', camera = false, maxBytes }) => {
  const [canShoot] = useState(() => camera && touchDevice());
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const take = (f: File | undefined) => {
    if (!f) return;
    if (!ACCEPT.includes(f.type)) {
      setError(/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name)
        ? 'HEIC の画像は読めません。カメラの設定を「互換性優先(JPEG)」にするか、JPEG・PNG・WebP で入れてください'
        : 'JPEG・PNG・WebP の画像を入れてください');
      return;
    }
    if (maxBytes && f.size > maxBytes) {
      setError(`画像が大きすぎます(${Math.round(maxBytes / 1024 / 1024)}MB まで)。小さくするか、写す範囲を狭めて入れ直してください`);
      return;
    }
    setError(null);
    onFile(f);
  };
  const handlers = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (!disabled) setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer.files[0]); },
  };
  const field = (
    <input ref={input} type="file" accept={ACCEPT.join(',')} className="sr-only" aria-label={label} disabled={disabled}
      data-testid="image-dropzone-input" onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
  );
  const shoot = canShoot ? (
    <label className="tc-focus-ring tc-mbtn tc-mbtn--sm cursor-pointer justify-center" data-testid="image-dropzone-camera">
      <Camera size={15} aria-hidden="true" />{file ? '撮り直す' : 'カメラで撮る'}
      <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label={`${label}(カメラで撮る)`}
        disabled={disabled} data-testid="image-dropzone-camera-input"
        onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
    </label>
  ) : null;
  return (
    <div>
      {file && preview ? (
        <div className={`grid gap-3 grid-cols-[7rem_minmax(0,1fr)] rounded-xl border-2 p-3 ${over ? 'tc-drop-over' : 'border-cloud-200'}`} {...handlers} data-testid="image-dropzone-result">
          <div>
            <img src={preview} alt="取り込んだ画像" className="w-28 max-h-40 object-contain rounded-lg border border-cloud-200 bg-cloud-0" data-testid="image-dropzone-thumb" />
            <label className="tc-focus-ring tc-mbtn tc-mbtn--sm mt-2 w-full cursor-pointer justify-center">別の画像{field}</label>
            {shoot && <div className="mt-2 grid">{shoot}</div>}
          </div>
          <div className="min-w-0">{children}</div>
        </div>
      ) : (
        <label className={`tc-focus-ring grid min-h-44 cursor-pointer place-items-center rounded-xl border-2 border-dashed p-5 text-center ${over ? 'tc-drop-over' : 'border-cloud-200 bg-cloud-50'}`} {...handlers} data-testid="image-dropzone">
          <span className="grid place-items-center gap-1 text-ink-900">
            <ImagePlus size={36} aria-hidden="true" />
            <b className="text-base">ここに画像をドラッグ&ドロップ</b>
            <span className="text-sm">または</span>
            <span className="tc-mbtn tc-mbtn--sm tc-mbtn--primary">ファイルを選ぶ</span>
            <span className="mt-1 text-xs text-ink-700">{hint}</span>
          </span>
          {field}
        </label>
      )}
      {!(file && preview) && shoot && <div className="mt-2 flex" data-testid="image-dropzone-ways">{shoot}</div>}
      {paste && <PasteImageButton onImage={(f) => take(f)} disabled={disabled} global={pasteGlobal} testId={pasteTestId} />}
      {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
};

export default ImageDropzone;
