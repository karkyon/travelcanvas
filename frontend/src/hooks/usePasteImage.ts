/**
 * [Gate PhotoPaste] クリップボードの画像を写真として受け取る(Web で見つけた画像を「画像をコピー」して貼る)。
 *
 * - 画面のどこでも Ctrl+V(Mac は ⌘V)で貼れる(この部品が出ている間だけ)
 * - 「クリップボードから貼り付け」の押しボタンは、ブラウザがクリップボードを読むのを許す時だけ使える
 *   (https のページ。http の LAN の画面では読めないので、Ctrl+V・長押しの貼り付けを案内する)
 * 画像の URL や Web ページの文字だけをコピーした時は画像が無いので、その旨を返す(外のサイトへは取りに行かない)。
 */
import { useEffect, useRef } from 'react';

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

function named(blob: Blob): File {
  const type = blob.type || 'image/png';
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return new File([blob], `clipboard-${stamp}.${EXT[type] ?? 'png'}`, { type });
}

/** 貼り付けの中の画像(無ければ null) */
export function imageFromClipboard(data: DataTransfer | null | undefined): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) return f.name && f.name !== 'image.png' ? f : named(f);
    }
  }
  const file = Array.from(data.files ?? []).find((f) => f.type.startsWith('image/'));
  return file ?? null;
}

/** 貼り付けに画像が無く、画像の URL・ページの文字だけだった */
export function onlyTextInClipboard(data: DataTransfer | null | undefined): boolean {
  if (!data) return false;
  const types = Array.from(data.types ?? []);
  return types.includes('text/plain') || types.includes('text/html') || types.includes('text/uri-list');
}

export type ClipboardRead = { file: File } | { error: 'unsupported' | 'denied' | 'no_image' };

/** 押しボタンから読む(navigator.clipboard.read)。https でない・許可が無い時は error */
export async function readClipboardImage(): Promise<ClipboardRead> {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clip || typeof clip.read !== 'function' || (typeof window !== 'undefined' && window.isSecureContext === false)) {
    return { error: 'unsupported' };
  }
  try {
    const items = await clip.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) return { file: named(await item.getType(type)) };
    }
    return { error: 'no_image' };
  } catch {
    return { error: 'denied' };
  }
}

/** 部品が出ている間、画面のどこでも Ctrl+V の画像を受け取る。文字だけの貼り付けは邪魔しない */
export function usePasteImage(onImage: (file: File) => void, enabled = true, onTextOnly?: () => void): void {
  const handler = useRef(onImage);
  const textOnly = useRef(onTextOnly);
  handler.current = onImage;
  textOnly.current = onTextOnly;
  useEffect(() => {
    if (!enabled) return undefined;
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFromClipboard(e.clipboardData);
      if (file) {
        e.preventDefault();
        handler.current(file);
        return;
      }
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (!typing && onlyTextInClipboard(e.clipboardData)) textOnly.current?.();
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [enabled]);
}
