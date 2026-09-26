/**
 * [Gate B-012] 削除済みプラン(ゴミ箱)の表示整形。純粋関数。
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 完全削除までの残り日数(切り上げ)。期限を過ぎていれば0。日時が不正ならnull。 */
export function daysUntilPurge(purgeAfter: string, now: Date = new Date()): number | null {
  const t = new Date(purgeAfter).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - now.getTime()) / DAY_MS));
}

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

export function purgeNotice(purgeAfter: string, now: Date = new Date()): string {
  const days = daysUntilPurge(purgeAfter, now);
  if (days === null) return '完全削除の予定日時が不明です';
  if (days === 0) return 'まもなく完全に削除されます(復元できません)';
  return `${formatDate(purgeAfter)}に完全に削除されます(あと${days}日)`;
}
