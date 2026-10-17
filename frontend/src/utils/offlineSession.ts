/**
 * [Gate K1] 端末内の暗号化保存で使う「今のログイン」(利用者 ID とログインの区別)。
 *
 * 会員は user.id、ゲストは guestId(= backend の users.id)。sessionTag はログインごとに変わる値で、
 * 鍵のメモを同じログインの間だけ使い回すために使う(保存はしない)。
 * legacyToken は Gate #36 の旧形式(トークンから鍵を作っていた)のパックを読み替えるためだけに使う。
 */
import { useAuthStore } from '@/store/authStore';
import type { OfflineSession } from './offlineVault';

export interface CurrentOfflineSession extends OfflineSession {
  legacyToken: string | null;
}

export function currentOfflineSession(): CurrentOfflineSession | null {
  const s = useAuthStore.getState();
  if (s.isGuest && s.guestId && s.guestToken) {
    return { userId: String(s.guestId), sessionTag: s.guestToken, legacyToken: s.guestToken };
  }
  if (s.user?.id && s.token) {
    return { userId: String(s.user.id), sessionTag: s.token, legacyToken: s.token };
  }
  return null;
}
