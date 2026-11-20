/**
 * [Gate②] E2E の旅行の日付を「試験を走らせる日」から決める(日本時間)。
 * 以前は 2026-11-21・11-29 など固定の日付で、その日が近づく・来る・過ぎると見出し・旅行の段階(旅行前→旅行中→旅行後)・
 * 「当日」の表示が変わり、CI が日付で落ちた(CI #793。2026-11-21 以降は gate-g9 の「旅行前」も落ちる)。
 */
export function tokyoDateAfter(days: number, from: Date = new Date()): string {
  const d = new Date(from.getTime() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
