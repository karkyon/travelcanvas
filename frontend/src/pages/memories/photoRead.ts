/**
 * [Gate PhotoMap] 写真のファイルから撮影位置と日時を端末の中で読む。サーバーは保存前に撮影情報を消すので、ここで読んで送る。
 * スマホのブラウザは位置(時には日時も)を消して渡すことがある。読めない時は null のまま送り、サーバーが推定または未配置にする。
 */
import { exifTimeToIso, readExifInfo } from '@/components/search/findModel';
import type { PhotoFields } from '@/services/api/photoFeatures';

export interface PhotoInfo { latitude: number | null; longitude: number | null; occurredAt: string | null }

export async function readPhotoInfo(file: File): Promise<PhotoInfo> {
  try {
    // 撮影情報は先頭にあるので、大きな写真でも全部は読まない
    const head = await file.slice(0, 256 * 1024).arrayBuffer();
    const { gps, takenAt } = readExifInfo(head);
    return { latitude: gps?.latitude ?? null, longitude: gps?.longitude ?? null, occurredAt: exifTimeToIso(takenAt) };
  } catch {
    return { latitude: null, longitude: null, occurredAt: null };
  }
}

export function fieldsFromInfo(info: PhotoInfo): PhotoFields {
  return {
    occurred_at: info.occurredAt, latitude: info.latitude, longitude: info.longitude,
    location_source: info.latitude !== null ? 'exif' : null,
  };
}

export const newUploadId = (): string =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`).replace(/[^A-Za-z0-9_-]/g, '-');
