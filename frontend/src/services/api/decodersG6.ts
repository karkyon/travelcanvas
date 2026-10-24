/**
 * [Gate G6] 端末の一覧・守る範囲・旅行記の公開・記録の削除の取り消しの応答の decoder
 * (使う画面が g6.ts 経由で読む。最初に読む JS に入れない)。
 */
import type {
  JournalDay, MemoryPublication, MemoryTrashItem, OfflineDevice, OfflineDeviceList, PrivacyZone, PrivacyZoneList,
  PublicJournal, PublicationPreview, RoutePoint,
} from './types/g6';
import { arrayOf, bool, decodeResponse, nonNegativeInt, nullable, num, object, oneOf, optional, str, type Decoder } from './decode';
import { journalMemory } from './decoders';

export const offlineDevice: Decoder<OfflineDevice> = object<OfflineDevice>({
  id: str, label: str, created_at: nullable(str), last_key_at: nullable(str), revoked_at: nullable(str), is_current: bool,
});

const offlineDeviceList: Decoder<OfflineDeviceList> = object<OfflineDeviceList>({
  devices: arrayOf(offlineDevice), max_devices: nonNegativeInt,
});

export const privacyZone: Decoder<PrivacyZone> = object<PrivacyZone>({
  id: str, label: str, radius_m: nonNegativeInt, latitude: nullable(num), longitude: nullable(num), readable: bool,
  created_at: nullable(str),
});

const privacyZoneList: Decoder<PrivacyZoneList> = object<PrivacyZoneList>({
  zones: arrayOf(privacyZone), max_zones: nonNegativeInt, radius_range: arrayOf(num),
});

const level = oneOf('none', 'area');
const journalDay: Decoder<JournalDay> = object<JournalDay>({
  day_id: str, date: str, title: nullable(str),
  entries: arrayOf(object({
    event_id: str, title: nullable(str), planned_time: nullable(str), status: oneOf('recorded', 'no_record'),
    memories: arrayOf(journalMemory),
  })),
  day_memories: arrayOf(journalMemory),
});
const summary = object({
  planned_events: nonNegativeInt, recorded_events: nonNegativeInt, memories: nonNegativeInt, photos: nonNegativeInt,
});
const routePoint: Decoder<RoutePoint> = object<RoutePoint>({ lat: num, lng: num });

const publicationPreview: Decoder<PublicationPreview> = object<PublicationPreview>({
  title: str, location_level: level, hidden_places: nonNegativeInt, days: arrayOf(journalDay),
  other_memories: arrayOf(journalMemory), summary, route: optional(arrayOf(routePoint)), photo_ids: arrayOf(str),
  required_acknowledgements: arrayOf(object({ code: str, message: str })),
});

export const memoryPublication: Decoder<MemoryPublication> = object<MemoryPublication>({
  id: str, plan_id: str, title: str, location_level: level, include_photos: bool, photos: nonNegativeInt,
  view_count: nonNegativeInt, created_at: nullable(str), revoked_at: nullable(str), is_active: bool, token_prefix: str,
  url: nullable(str),
});

const memoryTrashItem: Decoder<MemoryTrashItem> = object<MemoryTrashItem>({
  memory_id: str, kind: nullable(str), summary: str, deleted_at: nullable(str), restore_until: nullable(str),
});

const publicJournal: Decoder<PublicJournal> = object<PublicJournal>({
  title: str, published_at: nullable(str), location_level: level, days: arrayOf(journalDay),
  other_memories: arrayOf(journalMemory), summary, route: arrayOf(routePoint), photo_ids: arrayOf(str),
});

export interface G6Types {
  offlineDevice: OfflineDevice;
  offlineDevices: OfflineDeviceList;
  privacyZone: PrivacyZone;
  privacyZones: PrivacyZoneList;
  publicationPreview: PublicationPreview;
  publication: MemoryPublication;
  publications: MemoryPublication[];
  trash: MemoryTrashItem[];
  publicJournal: PublicJournal;
}

const G6: { [K in keyof G6Types]: [Decoder<G6Types[K]>, string] } = {
  offlineDevice: [offlineDevice, 'POST /offline-pack/devices/{device_ref}/revoke'],
  offlineDevices: [offlineDeviceList, 'GET /offline-pack/devices'],
  privacyZone: [privacyZone, 'POST /privacy-zones'],
  privacyZones: [privacyZoneList, 'GET /privacy-zones'],
  publicationPreview: [publicationPreview, 'POST /plans/{plan_id}/memories/publications/preview'],
  publication: [memoryPublication, 'POST /plans/{plan_id}/memories/publications'],
  publications: [arrayOf(memoryPublication), 'GET /plans/{plan_id}/memories/publications'],
  trash: [arrayOf(memoryTrashItem), 'GET /plans/{plan_id}/memories/trash'],
  publicJournal: [publicJournal, 'GET /public/journal/{token}'],
};

export function decodeG6<K extends keyof G6Types>(key: K, data: unknown): G6Types[K] {
  const [decoder, label] = G6[key];
  return decodeResponse(data, decoder, label);
}
