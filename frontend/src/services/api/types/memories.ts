/**
 * 写真・メモ・旅行記(FR-037)APIの型
 *
 * [Gate P12] backend/app/api/v1/memories.py・app/services/memories.py に対応する。
 * 予定・日・日時・場所へ、文章のメモ・写真・音声メモ・動画の参照(URL)を紐付ける。
 * 公開範囲は既定で「自分だけ」(private)。他人の「自分だけ」の記録はAPIから返らない。
 */
export type MemoryKind = 'note' | 'photo' | 'audio' | 'video';
export type MemoryVisibility = 'private' | 'members';

export interface TravelMemory {
  id: string;
  plan_id: string;
  kind: MemoryKind;
  body: string | null;
  event_id: string | null;
  day_id: string | null;
  occurred_at: string | null;
  place_name: string | null;
  latitude: number | null;
  longitude: number | null;
  video_url: string | null;
  has_media: boolean;
  mime_type: string | null;
  size: number | null;
  visibility: MemoryVisibility;
  include_in_journal: boolean;
  author_name: string;
  by_me: boolean;
  can_edit: boolean;
  can_delete: boolean;
  revision: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface MemoryList {
  memories: TravelMemory[];
  can_create: boolean;
  max_upload_bytes: number;
}

/** 文章のメモ・動画の参照を記録する時の入力(写真・音声は MemoryUploadInput) */
export interface MemoryInput {
  kind?: 'note' | 'video';
  body?: string | null;
  event_id?: string | null;
  day_id?: string | null;
  occurred_at?: string | null;
  place_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  video_url?: string | null;
  visibility?: MemoryVisibility;
  include_in_journal?: boolean;
}

export interface MemoryUploadInput {
  kind: 'photo' | 'audio';
  file: File;
  body?: string | null;
  event_id?: string | null;
  day_id?: string | null;
  occurred_at?: string | null;
  place_name?: string | null;
  visibility?: MemoryVisibility;
  include_in_journal?: boolean;
}

export type MemoryUpdateInput = Omit<MemoryInput, 'kind'>;

export interface JournalOptions {
  include_locations?: boolean;
  include_media?: boolean;
  include_others?: boolean;
}

export interface JournalMemory {
  id: string;
  kind: MemoryKind;
  body: string | null;
  occurred_at: string | null;
  place_name: string | null;
  has_media: boolean;
  video_url: string | null;
  latitude: number | null;
  longitude: number | null;
  by_me: boolean;
}

export interface JournalEntry {
  event_id: string;
  title: string | null;
  planned_time: string | null;
  status: 'recorded' | 'no_record';
  memories: JournalMemory[];
}

export type JournalCheckCode =
  | 'member_name' | 'reservation_like' | 'phone_like' | 'photo_people' | 'location_included'
  | 'location_excluded' | 'others_included';

export interface JournalCheck {
  code: JournalCheckCode;
  severity: 'warning' | 'info';
  memory_id: string | null;
  message: string;
}

export interface JournalDraft {
  title: string;
  algorithm_version: string;
  generated_at: string | null;
  options: Required<JournalOptions>;
  days: Array<{ day_id: string; date: string; title: string | null; entries: JournalEntry[];
    day_memories: JournalMemory[] }>;
  other_memories: JournalMemory[];
  summary: { planned_events: number; recorded_events: number; memories: number; photos: number };
  checks: JournalCheck[];
  markdown: string;
}
