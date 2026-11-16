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
