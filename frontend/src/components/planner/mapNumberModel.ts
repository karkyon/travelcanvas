/**
 * [Gate TimelineRedesign] 地図のピンの番号(PlanMap と同じ決まり)。
 * 位置(緯度・経度)のある予定だけに、日の予定の順で 1 から番号を付ける。旅程のカードの番号もこれを使う。
 */
interface HasCoords {
  id: string;
  latitude?: number | null;
  longitude?: number | null;
}

export const hasCoords = (e: HasCoords): boolean => e.latitude !== undefined && e.longitude !== undefined
  && e.latitude !== null && e.longitude !== null;

export function mapNumbers(events: ReadonlyArray<HasCoords>): Record<string, number> {
  const out: Record<string, number> = {};
  let n = 0;
  for (const e of events) {
    if (hasCoords(e)) {
      n += 1;
      out[e.id] = n;
    }
  }
  return out;
}
