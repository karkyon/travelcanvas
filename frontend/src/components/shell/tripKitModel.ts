/**
 * [Gate TripKit] 旅行箱の中の画面の一覧と、今の URL がどの画面か。
 */
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
export const KIT_ITEMS = [
  { key: 'kit', suffix: '/kit', label: '概要', short: '概要', primary: true },
  { key: 'reservations', suffix: '/reservations', label: '予約・チケット', short: '予約', primary: true },
  { key: 'preparation', suffix: '/preparation', label: '準備・持ち物', short: '準備', primary: true },
  { key: 'expenses', suffix: '/expenses', label: '予算・費用', short: '費用', primary: true },
  { key: 'documents', suffix: '/documents', label: '文書', short: '文書', primary: false },
  { key: 'imports', suffix: '/imports', label: '予約の取込', short: '取込', primary: false },
] as const;

export type KitKey = (typeof KIT_ITEMS)[number]['key'] | 'search';

export function md(d: string | null): string | null {
  return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : null;
}

/** 今の URL が旅行箱のどの画面か(概要の /kit と検索の /kit/search を分ける) */
export function currentKit(pathname: string, planId: string): KitKey | null {
  const base = `/planner/${planId}`;
  if (pathname.startsWith(`${base}/kit/search`)) return 'search';
  for (const k of KIT_ITEMS) {
    const to = `${base}${k.suffix}`;
    if (pathname === to || pathname.startsWith(`${to}/`)) return k.key;
  }
  return null;
}

/**
 * [Gate TripKit] 画面の中の条件(検索語・絞り込み・並び・タブ)を URL の query に置く。
 * 更新・共有・ブラウザの戻る/進むで同じ条件に戻る。値を変える時は履歴を増やさず置き換える(戻るで条件を 1 つずつ戻らない)。
 * 既定値と同じ時は query から消す(URL を短く保つ)。
 */
export function useQueryState<K extends string>(defaults: Record<K, string>) {
  const [params, setParams] = useSearchParams();
  const get = (k: K): string => params.get(k) ?? defaults[k];
  const values = Object.fromEntries((Object.keys(defaults) as K[]).map((k) => [k, get(k)])) as Record<K, string>;
  const set = useCallback((patch: Partial<Record<K, string>>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch) as [K, string | undefined][]) {
        if (v == null || v === '' || v === defaults[k]) next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 既定値は呼び出し側の定数
  }, [setParams]);
  return [values, set] as const;
}

/**
 * [Gate TripKitUI] 旅行箱のナビの「要確認」の数(準備状況 readiness の分類から)。
 * 画面が読み込んだ準備状況を prime で渡すと、ナビは聞き直さない(同じ旅行で 30 秒まで使う)。
 */
export interface KitAttention { reservations: number; preparation: number; expenses: number }
type ReadinessCounts = { counts: { by_category: Record<string, number> } };
const ATTN_TTL_MS = 30_000;
const attnCache = new Map<string, { at: number; value: KitAttention }>();
const attnListeners = new Set<() => void>();

export function attentionFromReadiness(r: ReadinessCounts): KitAttention {
  const c = r.counts.by_category;
  const n = (k: string) => (typeof c[k] === 'number' ? c[k]! : 0);
  return {
    reservations: n('unreserved') + n('unconfirmed') + n('unpaid') + n('deadline'),
    preparation: n('packing') + n('unassigned'),
    expenses: n('budget'),
  };
}
export function primeKitAttention(planId: string, r: ReadinessCounts): void {
  attnCache.set(planId, { at: Date.now(), value: attentionFromReadiness(r) });
  attnListeners.forEach((f) => f());
}
export function cachedKitAttention(planId: string): KitAttention | null {
  const hit = attnCache.get(planId);
  return hit && Date.now() - hit.at < ATTN_TTL_MS ? hit.value : null;
}
export function onKitAttention(f: () => void): () => void {
  attnListeners.add(f);
  return () => { attnListeners.delete(f); };
}
/** 試験用 */
export function resetKitAttentionForTests(): void { attnCache.clear(); }

/** [Gate TripKitUI] 文書の種類(保存した英字の値)を日本語にする。知らない値はそのまま */
export const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  receipt: '領収書', ticket: 'チケット', boarding_pass: '搭乗券', booking: '予約確認', confirmation: '予約確認',
  reservation: '予約確認', invoice: '請求書', passport: 'パスポート', visa: 'ビザ', insurance: '保険',
  id: '身分証', itinerary: '旅程表', voucher: 'バウチャー', other: 'その他',
};
export const documentTypeLabel = (t: string | null | undefined): string | null =>
  t ? (DOCUMENT_TYPE_LABEL[t.toLowerCase()] ?? t) : null;
