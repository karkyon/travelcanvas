/**
 * [Gate TDay-Mock] 旅の当日の画面(今日・地図・旅帖・旅程と、開く画面)が共有する値。
 * TodayPage が計算し、各カード・画面へ渡す(画面ごとに同じ計算を繰り返さない)。
 */
import type { TodayEvent, TodayResponse } from '@/services/api';
import type {
  DetourCandidate, GuideEvent, GuideGap, GuideLodging, GuideStamp, TodayGuide,
} from '@/services/api/travelDay';
import type { TodayFlow } from '../todayModel';
import type { GoNowView, LiveSettings, SkyHour, TrailPoint } from './todayLive';
import type { SkyState } from './useTodayLive';

/** 開く画面(URL の ?v= に入れる。戻るボタンで閉じられる) */
export type TodayScreen =
  | 'go' | 'place' | 'map' | 'tabicho' | 'timeline' | 'ticket' | 'memo' | 'stamp' | 'detour' | 'rain' | 'delay'
  | 'crew' | 'help' | 'checkin' | 'home' | 'prepare' | 'photoqr' | 'settings' | 'transit';
export const TODAY_SCREENS: TodayScreen[] = ['go', 'place', 'map', 'tabicho', 'timeline', 'ticket', 'memo', 'stamp',
  'detour', 'rain', 'delay', 'crew', 'help', 'checkin', 'home', 'prepare', 'photoqr', 'settings', 'transit'];
/** 下の「当日の画面」の切り替え(今日・地図・旅帖・旅程) */
export const TAB_SCREENS: TodayScreen[] = ['map', 'tabicho', 'timeline'];

export interface TodayCtx {
  planId: string;
  data: TodayResponse;
  events: TodayEvent[];
  timeZone: string | null;
  nowMs: number;
  nowLocal: string | null;
  nowEv: TodayEvent | null;
  nextEv: TodayEvent | null;
  flow: TodayFlow | null;
  go: GoNowView | null;
  guide: TodayGuide | null;
  gEvents: Record<string, GuideEvent>;
  stamps: Record<string, GuideStamp>;
  doneIds: Set<string>;
  visitedIds: Set<string>;
  rainIds: Set<string>;
  sky: SkyState | null;
  hours: SkyHour[];
  nowHour: number;
  upcomingRain: TodayEvent | null;
  gap: GuideGap | null;
  lodging: GuideLodging | null;
  lodgingEvent: TodayEvent | null;
  dayLabel: string | null;
  dayTitle: string;
  tripTitle: string | null;
  destination: string | null;
  stale: boolean;
  fetchedAt: number | null;
  delayed: boolean;
  settings: LiveSettings;
  setSettings: (s: LiveSettings) => void;
  simple: boolean;
  toggleSimple: () => void;
  detourPins: DetourCandidate[];
  setDetourPins: (c: DetourCandidate[]) => void;
  trail: TrailPoint[];
  pendingCount: number;
  /** [Gate Remaining-1] 送信待ちの写真・ひとこと */
  memoPending: number;
  onMemoQueued: (count: number) => void;
  open: (screen: TodayScreen, eventId?: string | null) => void;
  close: () => void;
  refresh: () => void;
  reloadGuide: () => void;
}
