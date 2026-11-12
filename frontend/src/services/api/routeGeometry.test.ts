import { describe, expect, it } from 'vitest';
import { api } from './index';
import { getRouteGeometry } from './routeGeometry';
import type { MinimalHttpClient } from './types';

describe('[Gate RoadRoute] getRouteGeometry', () => {
  it('POST /plans/{id}/route-geometry に区間を送り、道の線を受け取る', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    api.setHttpClientForTesting({
      post: async (url: string, body?: unknown) => {
        calls.push({ url, body });
        return { data: { provider: 'osrm', available: true, legs: [
          { index: 0, mode: 'walking', kind: 'road', profile: 'foot', coordinates: [[34.45, 136.72], [34.46, 136.72]], distance_km: 1.2, duration_minutes: 15 },
        ] } };
      },
    } as Partial<MinimalHttpClient>);
    const legs = [{ from_lat: 34.45, from_lng: 136.72, to_lat: 34.46, to_lng: 136.72, mode: 'walking' }];
    const r = await getRouteGeometry('p1', legs);
    expect(calls[0]!.url).toBe('/plans/p1/route-geometry');
    expect(calls[0]!.body).toEqual({ legs });
    expect(r.legs[0]!.kind).toBe('road');
    expect(r.available).toBe(true);
  });

  it('形の違う応答は受け付けない', async () => {
    api.setHttpClientForTesting({ post: async () => ({ data: { legs: [{ index: 'x' }] } }) } as Partial<MinimalHttpClient>);
    await expect(getRouteGeometry('p1', [])).rejects.toThrow();
  });
});
