/**
 * [Gate C1] FR-020 共同編集(準リアルタイム)の画面側の純粋関数。
 *
 * - 端末の印(client_id): タブごとの乱数(sessionStorage)。同じ人の別のタブは別の端末として数える
 * - 他の人の変更の文面: 「Bさんが「清水寺」を更新しました」。自分の変更・取り消された変更は数えない
 * - 編集中の他の人: 同じ予定を開いている人の名前
 */
import type { PresenceChange, PresenceViewer } from '@/services/api';

const CLIENT_KEY = 'tc_presence_client_id';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** このタブの端末の印(8〜64文字の英数字)。保存できない環境でも毎回作って続ける */
export function presenceClientId(): string {
  try {
    const saved = sessionStorage.getItem(CLIENT_KEY);
    if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved;
    const id = randomId().slice(0, 32);
    sessionStorage.setItem(CLIENT_KEY, id);
    return id;
  } catch {
    return randomId().slice(0, 32);
  }
}

const ACTION_LABEL: Record<string, string> = {
  create: '追加', update: '更新', delete: '削除', reorder: '並べ替え', move: '移動',
};

/** 1つの変更の文面 */
export function describeChange(change: PresenceChange): string {
  const who = `${change.actor_label}さん`;
  if (change.source === 'undo') return `${who}が直前の変更を元に戻しました`;
  if (change.count > 1) return `${who}が${change.count}件の予定・日程を変更しました`;
  const item = change.items[0];
  if (!item) return `${who}が旅程を変更しました`;
  const action = ACTION_LABEL[item.action] ?? '変更';
  const what = item.entity_type === 'travel_day' ? `${item.label ?? ''}の日程` : `「${item.label ?? '予定'}」`;
  return `${who}が${what}を${action}しました`;
}

/** 他の人の変更だけ(新しい順に最大 n 件) */
export function othersChanges(changes: PresenceChange[], n = 3): PresenceChange[] {
  return changes.filter((c) => !c.is_self).slice(-n).reverse();
}

/** この予定を編集中の他の人 */
export function othersEditing(viewers: PresenceViewer[], eventId: string | null | undefined): PresenceViewer[] {
  if (!eventId) return [];
  return viewers.filter((v) => !v.is_self && v.editing?.id === eventId);
}

export const ROLE_LABEL: Record<PresenceViewer['role'], string> = { owner: '所有者', editor: '編集者', viewer: '閲覧者' };
