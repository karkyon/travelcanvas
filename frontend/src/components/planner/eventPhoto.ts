/**
 * [Gate PlanSpotEdit] 予定の写真をこの端末のファイルから入れる(課題 #3-③)。
 * 写真は旅行の記録(写真)として「自分だけ」・旅行記に入れない設定で取り込み、その写真を予定の写真にする。
 * 位置などの撮影情報(EXIF)はサーバーが保存の前に外す(既存の記録の取り込みと同じ)。
 */
import { uploadMemory } from '@/services/api';
import { setEventImage } from '@/services/api/g11discover';
import type { EventImage } from '@/services/api/types/g11discover';

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function uploadEventPhoto(planId: string, eventId: string, file: File, title: string): Promise<EventImage | null> {
  if (!PHOTO_TYPES.includes(file.type)) throw new Error('JPEG・PNG・WebP の画像を入れてください');
  const memory = await uploadMemory(planId, {
    kind: 'photo', file, event_id: eventId, body: title.slice(0, 200), visibility: 'private', include_in_journal: false,
  });
  return (await setEventImage(planId, eventId, memory.id)).image;
}
