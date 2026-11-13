/**
 * [Gate TDay-Mock] 旅の当日で開く画面の枠(画面全体に重ねる。戻るボタン・Esc で閉じる)。
 * 画面の部品の変形(transform)の影響を受けないよう body の直下に出す。開いた時は戻るボタンに焦点を置く。
 */
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, X } from 'lucide-react';

export const ScreenFrame: React.FC<{
  title: string;
  /** 見出しを見せない(画像の上など)時は true。読み上げには出す */
  hideTitle?: boolean;
  onClose: () => void;
  closeLabel?: string;
  /** × で閉じる(下から出す画面・書く画面) */
  closeIcon?: 'back' | 'x';
  right?: React.ReactNode;
  tone?: string;
  testId?: string;
  footer?: React.ReactNode;
  wide?: boolean;
  sheet?: boolean;
  children: React.ReactNode;
}> = ({ title, hideTitle, onClose, closeLabel = '今日へ戻る', closeIcon = 'back', right, tone, testId, footer, wide, sheet, children }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);
  const id = `tl-screen-${title.replace(/[^\p{L}\p{N}]/gu, '')}`;
  return createPortal(
    <div className={`tl-screen${sheet ? ' tl-screen--sheet' : ''}`} data-tone={tone} role="dialog" aria-modal="true"
      aria-labelledby={id} data-testid={testId}>
      {sheet && <button type="button" className="tl-screen__scrim" aria-hidden="true" tabIndex={-1} onClick={onClose} />}
      <div className={`tl-screen__panel${wide ? ' is-wide' : ''}`}>
        <header className="tl-screen__head">
          {closeIcon === 'back' && (
            <button ref={closeRef} type="button" className="tc-focus-ring tl-back" aria-label={closeLabel} onClick={onClose}>
              <ArrowLeft size={20} aria-hidden="true" /><span className="tl-back__text">{closeLabel}</span>
            </button>
          )}
          <h2 id={id} className={hideTitle ? 'sr-only' : 'tl-screen__title'}>{title}</h2>
          <div className="tl-screen__right">
            {right}
            {closeIcon === 'x' && (
              <button ref={closeRef} type="button" className="tc-focus-ring tl-back" aria-label={closeLabel} onClick={onClose}>
                <X size={20} aria-hidden="true" />
              </button>
            )}
          </div>
        </header>
        <div className="tl-screen__body">{children}</div>
        {footer && <div className="tl-screen__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

export default ScreenFrame;
