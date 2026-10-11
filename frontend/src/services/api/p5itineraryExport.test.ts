/**
 * [Gate P5] カレンダー・地図・表計算への書き出し(FR-036)APIのクライアント。
 * 形式ごとのURL・クエリ・Blob応答・件数ヘッダーの読み取りを固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import { api, downloadItineraryExport } from './index';
import type { MinimalHttpClient } from './types';

type Call = { url: string; config?: AxiosRequestConfig };

function respondWith(data: unknown, headers?: Record<string, string>): Call[] {
  const calls: Call[] = [];
  api.setHttpClientForTesting({
    get: async (url: string, config?: AxiosRequestConfig) => {
      calls.push({ url, config });
      return { data, headers } as { data: unknown };
    },
  } as Partial<MinimalHttpClient>);
  return calls;
}

describe('書き出しAPIクライアント (Gate P5)', () => {
  it('形式ごとに固定のURLへ、選択をクエリとしてBlobで要求する', async () => {
    const blob = new Blob(['BEGIN:VCALENDAR'], { type: 'text/calendar' });
    const cases = [
      ['ics', '/plans/p1/exports/calendar.ics', { include_addresses: true }],
      ['gpx', '/plans/p1/exports/places.gpx', { precision: 'exact', exclude_accommodation: false }],
      ['kml', '/plans/p1/exports/places.kml', { precision: 'approx', exclude_accommodation: true }],
      ['csv', '/plans/p1/exports/itinerary.csv', {}],
    ] as const;
    for (const [format, url, options] of cases) {
      const calls = respondWith(blob, { 'x-export-count': '3', 'x-export-skipped': '1', 'x-export-excluded': '2' });
      const file = await downloadItineraryExport('p1', format, options);
      expect(calls[0]).toEqual({ url, config: { params: options, responseType: 'blob' } });
      expect(file).toMatchObject({ blob, count: 3, skipped: 1, excluded: 2 });
      expect(url.endsWith(file.filename)).toBe(true);
    }
  });

  it('件数ヘッダーが無い・不正なら0として扱い、ファイルでない応答は拒否する', async () => {
    respondWith(new Blob(['x']), { 'x-export-count': '-1', 'x-export-skipped': 'abc' });
    await expect(downloadItineraryExport('p1', 'csv')).resolves.toMatchObject({ count: 0, skipped: 0, excluded: 0 });
    respondWith({ detail: 'error' });
    await expect(downloadItineraryExport('p1', 'ics')).rejects.toThrow(/ファイルではありません/);
  });
});
