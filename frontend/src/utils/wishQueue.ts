/**
 * [FR-062] 圏外の時の「今度行きたい」の送信待ち(pending_wishes)。
 *
 * - 端末の暗号化した保存(offlineVault の snapshots)に置く。平文では置かない
 * - つながった時(online の出来事・アプリを開いた時)に古い順に送る。同じ client_id はサーバーが 1 件にまとめる
 * - サーバーが内容を断った物(400/422 など)は捨てる。通信の失敗・401/403/408/429/5xx は残して次に回す
 */
import { quickSaveWish } from '@/services/api/spotIntake';
import type { QuickWishInput } from '@/services/api/spotIntake';
import { loadSnapshot, saveSnapshot } from './offlineVault';
import type { OfflineSession } from './offlineVault';
import { isNetworkError } from './syncQueue';

export const WISH_QUEUE_MAX = 50;
const NAME = 'pending_wishes';

export interface QueuedWish extends QuickWishInput { queuedAt: number }

export function newClientId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID().replace(/-/g, '');
  } catch { /* 下へ */ }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.padEnd(16, '0');
}

export async function loadWishQueue(session: OfflineSession | null): Promise<QueuedWish[]> {
  const got = await loadSnapshot<QueuedWish[]>(session, NAME);
  return Array.isArray(got?.data) ? got!.data : [];
}

export async function queueWish(session: OfflineSession | null, wish: QuickWishInput): Promise<boolean> {
  const cur = await loadWishQueue(session);
  if (cur.some((w) => w.client_id === wish.client_id)) return true;
  if (cur.length >= WISH_QUEUE_MAX) return false;
  return saveSnapshot(session, NAME, [...cur, { ...wish, queuedAt: Date.now() }]);
}

export function keepForRetry(e: unknown): boolean {
  const status = (e as { response?: { status?: number } } | null)?.response?.status;
  return isNetworkError(e) || status === 401 || status === 403 || status === 408 || status === 429
    || (status !== undefined && status >= 500);
}

/** 送る。{送れた数, 断られて捨てた数, 残りの数} */
export async function flushWishQueue(session: OfflineSession | null): Promise<{ sent: number; dropped: number; left: number }> {
  const cur = await loadWishQueue(session);
  if (cur.length === 0) return { sent: 0, dropped: 0, left: 0 };
  const sorted = [...cur].sort((a, b) => a.queuedAt - b.queuedAt);
  let sent = 0;
  let dropped = 0;
  const rest: QueuedWish[] = [];
  let stopped = false;
  for (const w of sorted) {
    if (stopped) { rest.push(w); continue; }
    try {
      const { queuedAt: _q, ...input } = w;
      void _q;
      await quickSaveWish(input);
      sent += 1;
    } catch (e) {
      if (keepForRetry(e)) { stopped = true; rest.push(w); } else dropped += 1;
    }
  }
  await saveSnapshot(session, NAME, rest);
  return { sent, dropped, left: rest.length };
}
