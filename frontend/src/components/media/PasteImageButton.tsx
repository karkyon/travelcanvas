/**
 * [Gate PhotoPaste] 「クリップボードから貼り付け」の押しボタンと、スマホの長押しの貼り付けの欄。
 * 画面のどこでも Ctrl+V で貼れる(usePasteImage)ことも案内する。
 */
import React, { useState } from 'react';
import { ClipboardPaste } from 'lucide-react';
import { imageFromClipboard, onlyTextInClipboard, readClipboardImage, usePasteImage } from '@/hooks/usePasteImage';

export const PASTE_TEXT_ONLY = 'コピーされているのは文字(画像の URL など)でした。Web の画像は右クリック(長押し)→「画像をコピー」してから貼ってください';

interface Props {
  onImage: (file: File) => void;
  disabled?: boolean;
  /** 画面のどこでも Ctrl+V を受け取るか(同じ画面に 2 つ出す時は片方だけ) */
  global?: boolean;
  testId?: string;
}

const PasteImageButton: React.FC<Props> = ({ onImage, disabled = false, global = true, testId = 'paste-image' }) => {
  const [note, setNote] = useState<string | null>(null);
  const take = (file: File) => { setNote(null); onImage(file); };
  usePasteImage(take, global && !disabled, () => setNote(PASTE_TEXT_ONLY));
  const press = async () => {
    const got = await readClipboardImage();
    if ('file' in got) { take(got.file); return; }
    setNote(got.error === 'no_image' ? 'クリップボードに画像がありません。Web の画像は右クリック(長押し)→「画像をコピー」してください'
      : got.error === 'denied' ? 'クリップボードを読むのが許可されませんでした。Ctrl+V(⌘V)で貼ってください'
        : 'このページではボタンでクリップボードを読めません。Ctrl+V(⌘V)・下の欄の長押し →「ペースト」で貼ってください');
  };
  return (
    <div className="mt-2 space-y-1" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" disabled={disabled} onClick={() => void press()}
          data-testid={`${testId}-button`}>
          <ClipboardPaste size={14} aria-hidden="true" />クリップボードから貼り付け
        </button>
        <input type="text" inputMode="none" readOnly={false} value="" onChange={() => undefined} disabled={disabled}
          aria-label="画像を貼り付ける欄(長押し → ペースト)" placeholder="ここに貼り付け(Ctrl+V・長押し)"
          className="min-h-9 w-48 rounded-lg border border-dashed border-cloud-200 bg-cloud-0 px-2 text-xs"
          data-testid={`${testId}-field`}
          onPaste={(e) => {
            const file = imageFromClipboard(e.clipboardData);
            e.preventDefault();
            e.stopPropagation();
            if (file) take(file);
            else if (onlyTextInClipboard(e.clipboardData)) setNote(PASTE_TEXT_ONLY);
          }} />
      </div>
      <p className="text-xs text-ink-700">Web で見つけた画像は「画像をコピー」して、この画面で Ctrl+V(⌘V)で貼れます。</p>
      {note && <p role="status" className="text-xs text-ink-700" data-testid={`${testId}-note`}>{note}</p>}
    </div>
  );
};

export default PasteImageButton;
