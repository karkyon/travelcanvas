/** [FR-062] ヘッダーに置く ♡ ボタン(ログインしている時は全画面に出る)。ゲストは「ログインすると残せます」 */
import React from 'react';
import { toast } from 'react-hot-toast';
import { Heart } from 'lucide-react';
import { openWishSheet } from './wishEvents';
import type { WishSheetOptions } from './wishEvents';

export const WishHeartButton: React.FC<{ isGuest: boolean; className?: string; options?: WishSheetOptions; label?: string }> = (
  { isGuest, className, options, label }) => (
  <button type="button" className={className ?? 'tc-focus-ring tc-top-icon'} aria-label="今度行きたいに残す" title="今度行きたいに残す"
    onClick={() => { if (isGuest) toast('ログインすると残せます'); else openWishSheet(options); }}>
    <Heart size={18} aria-hidden="true" />{label && <span>{label}</span>}
  </button>
);

export default WishHeartButton;
