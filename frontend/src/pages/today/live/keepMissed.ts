import { keepForNextTrip } from '@/services/api/travelDay';
import { quickSaveWish } from '@/services/api/spotIntake';
import { newClientId } from '@/utils/wishQueue';

/** [FR-062] 「次の旅の候補に」の 2 択: 今度行きたい(行きたい場所。既定)/ この旅行の候補箱(今までと同じ) */
export type KeepTarget = 'wish' | 'box';
export async function keepMissed(planId: string, input: { title: string; address: string | null; latitude: number | null;
  longitude: number | null }, target: KeepTarget): Promise<void> {
  if (target === 'box') { await keepForNextTrip(planId, input); return; }
  await quickSaveWish({ name: input.title, address: input.address, latitude: input.latitude, longitude: input.longitude,
    wish_kind: 'next', wish_note: '旅の当日に行けなかった場所', source_kind: 'today', source_plan_id: planId,
    client_id: newClientId() });
}

