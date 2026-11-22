/**
 * [FR-062] シートの置き場(ヘッダーに 1 つ)。openWishSheet() の出来事で開き、圏外で溜めた分を
 * つながった時(online の出来事・開いた時)に古い順に送る。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { WishSheet } from './WishSheet';
import { WISH_SHEET_EVENT } from './wishEvents';
import type { WishSheetOptions } from './wishEvents';
import { flushPendingWishes } from './wishSave';

const WishSheetHost: React.FC<{ enabled: boolean }> = ({ enabled }) => {
  const [opts, setOpts] = useState<WishSheetOptions | null>(null);
  const close = useCallback(() => setOpts(null), []);

  useEffect(() => {
    if (!enabled) return undefined;
    const onOpen = (e: Event) => setOpts((e as CustomEvent<WishSheetOptions>).detail ?? {});
    const onOnline = () => { void flushPendingWishes(); };
    window.addEventListener(WISH_SHEET_EVENT, onOpen);
    window.addEventListener('online', onOnline);
    if (typeof navigator === 'undefined' || navigator.onLine !== false) void flushPendingWishes();
    return () => {
      window.removeEventListener(WISH_SHEET_EVENT, onOpen);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled]);

  if (!enabled) return null;
  return <WishSheet open={opts !== null} options={opts ?? {}} onClose={close} />;
};

export default WishSheetHost;
