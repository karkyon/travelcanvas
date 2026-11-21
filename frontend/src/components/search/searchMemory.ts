/**
 * [Gate② UX P0] 全体の検索から旅程などへ移って戻った時に、検索語と結果を出し直す(同じ検索を外へ送り直さない)。
 * - 画面のメモリだけに持つ(localStorage・sessionStorage に書かない。再読み込み・タブを閉じると消える)
 * - 持ち主(ログインの利用者。ゲストは null)が変わったら出さない(同じタブで別の人がログインした時に前の人の検索を見せない)
 * - 古くなった結果は出さない(30 分)
 */
export const SEARCH_MEMORY_TTL_MS = 30 * 60 * 1000;

interface Remembered<T> { owner: string | null; query: string; results: T[]; at: number }

let remembered: Remembered<unknown> | null = null;

export function rememberSearch<T>(owner: string | null, query: string, results: T[], now = Date.now()): void {
  remembered = { owner, query, results, at: now };
}

export function recallSearch<T>(owner: string | null, now = Date.now()): { query: string; results: T[] } | null {
  const r = remembered;
  if (!r || r.owner !== owner || now - r.at > SEARCH_MEMORY_TTL_MS) return null;
  return { query: r.query, results: r.results as T[] };
}

export function forgetSearch(): void {
  remembered = null;
}
