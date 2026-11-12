/**
 * [Gate RoadRoute] 地図の線の区間(地図に出ている予定の順の2点ずつ)と、その移動手段。
 *
 * 手段の決め方(画面にある値だけから。推測した時は guess と分かるようにする):
 * 1. 移動区間(segments)が入っていればその手段(取り消しの区間は使わない) … source 'segment'
 * 2. 同じエリアの中(エリアとその中の予定・中の予定どうし)は歩き … source 'area'
 * 3. どちらでもない時は、直線で 1.2km 以内なら歩き・それより遠ければ車 … source 'guess'
 */
import { hasCoords } from './mapNumberModel';

export interface LegEvent {
  id: string;
  latitude?: number | null;
  longitude?: number | null;
  category?: string | null;
  parent_event_id?: string | null;
}

export interface LegSegment {
  from_event_id: string | null;
  to_event_id: string | null;
  mode: string;
  status?: string;
}

export type LegSource = 'segment' | 'area' | 'guess';

export interface MapLeg {
  key: string;
  fromId: string;
  toId: string;
  from: [number, number];
  to: [number, number];
  mode: string;
  source: LegSource;
}

export const WALK_GUESS_KM = 1.2;

export function straightKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function areaOf(e: LegEvent): string | null {
  if (e.parent_event_id) return e.parent_event_id;
  if (e.category === 'area') return e.id;
  return null;
}

export function buildMapLegs(events: ReadonlyArray<LegEvent>, segments: ReadonlyArray<LegSegment> = []): MapLeg[] {
  const pts = events.filter(hasCoords) as Array<LegEvent & { latitude: number; longitude: number }>;
  const legs: MapLeg[] = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const from: [number, number] = [a.latitude, a.longitude];
    const to: [number, number] = [b.latitude, b.longitude];
    const seg = segments.find((s) => s.from_event_id === a.id && s.to_event_id === b.id && s.status !== 'cancelled');
    let mode: string;
    let source: LegSource;
    const areaA = areaOf(a);
    if (seg) {
      mode = seg.mode;
      source = 'segment';
    } else if (areaA !== null && areaA === areaOf(b)) {
      mode = 'walking';
      source = 'area';
    } else {
      mode = straightKm(from, to) <= WALK_GUESS_KM ? 'walking' : 'driving';
      source = 'guess';
    }
    legs.push({ key: `${a.id}>${b.id}`, fromId: a.id, toId: b.id, from, to, mode, source });
  }
  return legs;
}

/** 同じ線を何度も聞かないための印(座標は 5 桁・手段) */
export function legsSignature(legs: ReadonlyArray<MapLeg>): string {
  return legs.map((l) => `${l.from[0].toFixed(5)},${l.from[1].toFixed(5)}>${l.to[0].toFixed(5)},${l.to[1].toFixed(5)}:${l.mode}`).join('|');
}
