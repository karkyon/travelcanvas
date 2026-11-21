/**
 * [Gate② UX P0] 値の「確からしさ」の共通の語(設計: docs/ux/certainty_display.md)。
 * 画面ごとにばらばらだった出どころの言葉を 1 つの語彙にまとめる。語は DOC-13 §16(当日の移動の出どころ)と §3(情報品質)に合わせる。
 * **根拠はデータ(API の値)から渡す。** 画面の都合で「実データ」を付けない(取った提供元と時刻がある時だけ live)。
 */
export type CertaintyKind =
  | 'live'        // 実データ: 提供元(API)から取った値。取得時刻とともに出す(DOC-13 §3 IMPORTED/FRESH)
  | 'manual'      // 手入力: 利用者が入れた値(USER_ENTERED)
  | 'registered'  // 登録した値: 移動区間・経路の候補などに保存した値(USER_ENTERED。DOC-13 §16「登録した移動」)
  | 'estimate'    // 概算: 距離や規則から計算した目安(INFERRED)
  | 'unknown'     // 不明: 出どころが無い(0 として扱わない)
  | 'unqueried'   // 未照会: まだ提供元に聞いていない(聞けば分かる)
  | 'unconnected' // 未接続: 提供元がつながっていない(設定・契約が無い)
  | 'failed';     // 取得失敗: 聞いたが取れなかった(UNAVAILABLE。0 件と区別する)

export const CERTAINTY_WORD: Record<CertaintyKind, string> = {
  live: '実データ', manual: '手入力', registered: '登録した値', estimate: '概算', unknown: '不明',
  unqueried: '未照会', unconnected: '未接続', failed: '取得失敗',
};

/** 色に頼らないための 1 文字の印(読み上げでは使わない。aria-hidden) */
export const CERTAINTY_LETTER: Record<CertaintyKind, string> = {
  live: '実', manual: '手', registered: '登', estimate: '概', unknown: '?', unqueried: '未', unconnected: '外', failed: '!',
};

/** 利用者が値をそのまま信じてよいか(実データ・手入力・登録した値)。概算・不明・未照会・未接続・取得失敗は確かめが要る */
export function certaintyNeedsCheck(kind: CertaintyKind): boolean {
  return !(kind === 'live' || kind === 'manual' || kind === 'registered');
}

/** 取得時刻つきの読み上げの文(「出どころ: 実データ(10:05 取得)」) */
export function certaintyLabel(kind: CertaintyKind, word?: string, at?: string | null): string {
  return `出どころ: ${word ?? CERTAINTY_WORD[kind]}${at ? `(${at} 取得)` : ''}`;
}
