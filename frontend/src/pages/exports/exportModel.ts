/**
 * [Gate P5] 書き出し画面(FR-036)の表示文言と保存処理。
 */
import type { ItineraryExportFile, ItineraryExportFormat } from '@/services/api';

export const FORMAT_LABEL: Record<ItineraryExportFormat, string> = {
  ics: 'カレンダー(ICS)', gpx: '地図(GPX)', kml: '地図(KML)', csv: '表計算(CSV)',
};

/** 書き出し結果の案内文。書き出さなかった・除外した件数を必ず伝える(黙って欠落させない)。 */
export function describeResult(format: ItineraryExportFormat, file: ItineraryExportFile): string {
  const unit = format === 'gpx' || format === 'kml' ? '地点' : '件';
  const parts = [`${file.filename} を書き出しました(${file.count}${unit})。`];
  if (file.skipped > 0) {
    parts.push(format === 'ics'
      ? `出発時刻のない移動${file.skipped}件は含めていません。`
      : `位置が登録されていない予定${file.skipped}件は含めていません。`);
  }
  if (file.excluded > 0) parts.push(`宿泊場所${file.excluded}件は選択により除外しました。`);
  if (file.count === 0) parts.push('書き出す内容がありません。予定や位置を登録してから書き出してください。');
  return parts.join('');
}

/** ブラウザにファイルとして保存させる */
export function saveFile(file: ItineraryExportFile): void {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `travelcanvas-${file.filename}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
