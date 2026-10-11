/**
 * カレンダー・地図・表計算への書き出し(FR-036)APIの型
 *
 * [Gate P5] backend/app/api/v1/itinerary_export.py に対応する。応答はファイル(ICS/GPX/KML/CSV)。
 * 予約番号・チケット・メモ・参加者名はどの形式にも含まれない。
 */
export type ItineraryExportFormat = 'ics' | 'gpx' | 'kml' | 'csv';
export type LocationPrecision = 'approx' | 'exact';

export interface ItineraryExportOptions {
  /** ICS・CSV: 住所を含める(既定 false) */
  include_addresses?: boolean;
  /** GPX・KML: 位置の精度(既定 approx = 約1km単位) */
  precision?: LocationPrecision;
  /** GPX・KML: 宿泊場所を除外する(既定 true) */
  exclude_accommodation?: boolean;
}

export interface ItineraryExportFile {
  blob: Blob;
  filename: string;
  /** 書き出した件数 */
  count: number;
  /** 時刻・位置が無い等で書き出さなかった件数 */
  skipped: number;
  /** 利用者の選択(宿泊場所の除外)で除外した件数 */
  excluded: number;
}
