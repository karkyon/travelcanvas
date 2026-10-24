/**
 * [Gate G6] OFF-01 端末ごとのオフラインの鍵 / LOC-02 守る範囲(位置のぼかし) / MEM-01 旅行記の公開・記録の削除の取り消し の型。
 * backend/app/api/v1/offline_pack.py・privacy_zones.py・memory_publish.py に対応する。
 */
import type { JournalMemory } from './memories';

export interface OfflineDevice {
  id: string;
  /** ブラウザと OS の種類だけ(例: Chrome / Android)。端末を特定できる情報は持たない */
  label: string;
  created_at: string | null;
  last_key_at: string | null;
  revoked_at: string | null;
  is_current: boolean;
}

export interface OfflineDeviceList {
  devices: OfflineDevice[];
  max_devices: number;
}

export interface PrivacyZone {
  id: string;
  label: string;
  radius_m: number;
  /** 本人にだけ返る(暗号化して保存)。読めない時は null */
  latitude: number | null;
  longitude: number | null;
  readable: boolean;
  created_at: string | null;
}

export interface PrivacyZoneList {
  zones: PrivacyZone[];
  max_zones: number;
  radius_range: number[];
}

export interface PrivacyZoneInput {
  label: string;
  latitude: number;
  longitude: number;
  radius_m: number;
}

export type JournalLocationLevel = 'none' | 'area';
export type JournalAckCode = 'photo_people' | 'member_name' | 'reservation_like' | 'phone_like' | 'place_names';

export interface JournalAck {
  code: string;
  message: string;
}

export interface PublishOptions {
  location_level: JournalLocationLevel;
  include_photos?: boolean;
  title?: string;
  acknowledge?: string[];
}

export interface JournalDay {
  day_id: string;
  date: string;
  title: string | null;
  entries: Array<{ event_id: string; title: string | null; planned_time: string | null; status: 'recorded' | 'no_record';
    memories: JournalMemory[] }>;
  day_memories: JournalMemory[];
}

export interface JournalSummary {
  planned_events: number;
  recorded_events: number;
  memories: number;
  photos: number;
}

export interface RoutePoint {
  lat: number;
  lng: number;
}

/** 公開の前の確認(公開する内容そのもの。座標は含まない) */
export interface PublicationPreview {
  title: string;
  location_level: JournalLocationLevel;
  hidden_places: number;
  days: JournalDay[];
  other_memories: JournalMemory[];
  summary: JournalSummary;
  route?: RoutePoint[];
  photo_ids: string[];
  required_acknowledgements: JournalAck[];
}

export interface MemoryPublication {
  id: string;
  plan_id: string;
  title: string;
  location_level: JournalLocationLevel;
  include_photos: boolean;
  photos: number;
  view_count: number;
  created_at: string | null;
  revoked_at: string | null;
  is_active: boolean;
  token_prefix: string;
  /** 作った時だけ返る(/journal/<token>)。後からは分からない */
  url: string | null;
}

export interface MemoryTrashItem {
  memory_id: string;
  kind: string | null;
  summary: string;
  deleted_at: string | null;
  restore_until: string | null;
}

export interface PublicJournal {
  title: string;
  published_at: string | null;
  location_level: JournalLocationLevel;
  days: JournalDay[];
  other_memories: JournalMemory[];
  summary: JournalSummary;
  route: RoutePoint[];
  photo_ids: string[];
}
