import type { ExternalImage } from '@/services/api/types/g11discover';
import type { SpotPhoto } from '@/components/media/SpotPhotoView';
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

/** [Gate SpotInfo] 自動取得で埋めた項目の表示名 */
export const FILLED_LABEL: Record<string, string> = {
  address: '住所', location: '地図の位置', phone: '電話', urls: '公式サイト', category: '種類', dining: '食事の情報', photo: '写真',
};

/** 外部の写真の候補を、行きたい場所に保存する写真の出典へ */
export function toSpotPhoto(img: ExternalImage): SpotPhoto {
  return {
    provider: img.provider, provider_id: img.provider_id, title: img.title, author: img.author, license: img.license,
    license_url: img.license_url, source_page_url: img.source_page_url,
  };
}

/** [Gate SpotInfo] 検索・候補の種類を行きたい場所の種類へ(分からなければ other にして、自動取得で決める) */
export function wishCategory(c: string | null | undefined): string {
  const v = (c ?? '').toLowerCase();
  if (!v) return 'other';
  if (['sightseeing', 'restaurant', 'accommodation', 'shopping', 'other'].includes(v)) return v;
  if (/rest|food|dining|cafe|meal|gourmet|食/.test(v)) return 'restaurant';
  if (/hotel|lodging|accom|stay|宿/.test(v)) return 'accommodation';
  if (/shop|store|market|買/.test(v)) return 'shopping';
  if (/sight|tour|museum|temple|shrine|park|view|観光|絶景/.test(v)) return 'sightseeing';
  return 'other';
}
