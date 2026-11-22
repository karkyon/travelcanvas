/** [FR-062] ♡ のシートを開く出来事と、ヘッダーの ♡ ボタン(シートの本体は開いた時だけ読み込む) */
import type { PlaceDraft } from '@/components/search/PlaceFinder';
import type { WishKind, WishSource } from '@/services/api/spotIntake';

export const WISH_SHEET_EVENT = 'tc:wish-sheet';

export interface WishSheetOptions {
  kind?: WishKind;
  sourceKind?: WishSource;
  planId?: string | null;
  /** 当日の時だけ: 今の予定の場所 */
  currentPlace?: PlaceDraft | null;
}

/** どこからでも開く(ヘッダーの ♡・当日の画面・スポットモード) */
export function openWishSheet(opts: WishSheetOptions = {}): void {
  window.dispatchEvent(new CustomEvent<WishSheetOptions>(WISH_SHEET_EVENT, { detail: opts }));
}

