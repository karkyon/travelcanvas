import { dateWithDay } from '@/components/trip/tripListModel';

/** [Gate TripsWish] 行きたい場所のメモを、本文と URL(出典)に分ける(URL の行は本文から外してリンクにする)。 */
export function splitNote(text: string | null): { memo: string; links: string[] } {
  const links: string[] = [];
  const lines: string[] = [];
  for (const line of (text ?? '').split(/\r?\n/)) {
    const t = line.trim();
    if (/^https?:\/\/\S+$/i.test(t)) links.push(t); else lines.push(line);
  }
  return { memo: lines.join('\n').trim(), links };
}

/** 保存した時刻(UTC)を、見る人の地域の日付で 2026/5/17(土) にする */
export function localDay(iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return dateWithDay(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}
