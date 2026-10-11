/**
 * カレンダー・地図・表計算への書き出し(FR-036)
 *
 * [Gate P5] backend/app/api/v1/itinerary_export.py。/plans/{planId}/exports/*。
 * 応答はファイル(Blob)。件数は応答ヘッダー X-Export-Count / X-Export-Skipped / X-Export-Excluded。
 */
import { BookletApi } from './booklet';
import type { ItineraryExportFile, ItineraryExportFormat, ItineraryExportOptions } from '../types';

const FILE_NAME: Record<ItineraryExportFormat, string> = {
  ics: 'calendar.ics', gpx: 'places.gpx', kml: 'places.kml', csv: 'itinerary.csv',
};

function headerCount(headers: Record<string, unknown> | undefined, name: string): number {
  const raw = headers?.[name] ?? headers?.[name.toLowerCase()];
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export class ItineraryExportApi extends BookletApi {
  async downloadItineraryExport(
    planId: string, format: ItineraryExportFormat, options: ItineraryExportOptions = {}
  ): Promise<ItineraryExportFile> {
    const config = { params: options, responseType: 'blob' as const };
    // URLは形式ごとに固定の文字列で書く(実在ルートの検査 c2b3.test.ts が走査できるように)
    const response = format === 'ics'
      ? await this.client.get(`/plans/${planId}/exports/calendar.ics`, config)
      : format === 'gpx'
        ? await this.client.get(`/plans/${planId}/exports/places.gpx`, config)
        : format === 'kml'
          ? await this.client.get(`/plans/${planId}/exports/places.kml`, config)
          : await this.client.get(`/plans/${planId}/exports/itinerary.csv`, config);
    if (!(response.data instanceof Blob)) {
      throw new Error(`書き出しの応答がファイルではありません: GET /plans/{plan_id}/exports/${FILE_NAME[format]}`);
    }
    const headers = (response as { headers?: Record<string, unknown> }).headers;
    return {
      blob: response.data,
      filename: FILE_NAME[format],
      count: headerCount(headers, 'X-Export-Count'),
      skipped: headerCount(headers, 'X-Export-Skipped'),
      excluded: headerCount(headers, 'X-Export-Excluded'),
    };
  }
}
