/**
 * [Gate MemoryReel] 旅の思い出リールの API(GET /plans/{id}/memory-reel)。
 * 最初に読む JS を小さく保つため、CompleteTravelAPI には足さず、後から読む画面がここを直接 import する。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

/** 写真 1 枚(撮った順)。位置は見せてよい時だけ */
export interface ReelSlide {
  memory_id: string;
  title: string | null;
  place_name: string | null;
  /** 旅先の時刻 "YYYY-MM-DDTHH:MM" */
  local_at: string | null;
  body: string | null;
  latitude: number | null;
  longitude: number | null;
}
/** 写真が無い旅の代わり(予定の名前) */
export interface ReelFallbackEvent { title: string; local_date: string | null; local_time: string | null }

export interface MemoryReelData {
  plan_id: string;
  title: string;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  day_count: number;
  photo_count: number;
  note_count: number;
  place_count: number;
  member_count: number;
  slides: ReelSlide[];
  fallback_events: ReelFallbackEvent[];
  /** 最後のひとこと(最後に書かれたメモ) */
  quote: string | null;
}

export async function getMemoryReel(planId: string): Promise<MemoryReelData> {
  return (await api.get(`/plans/${planId}/memory-reel`, SILENT)).data as MemoryReelData;
}
