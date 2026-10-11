/**
 * ExportsPage - カレンダー・地図・表計算への書き出し(SC-27 連携・入出力 / FR-036)。
 *
 * [Gate P5] backend/app/api/v1/itinerary_export.py の画面。
 *   - カレンダー(ICS): 予定と移動。Google・Apple・Outlookのカレンダーへ取り込める
 *   - 地図(GPX・KML): 訪問地点と日ごとの順路。既定は約1km単位に丸め、宿泊場所を除外する(FC-092)
 *   - 表計算(CSV): 予定の一覧
 * 予約番号・チケット・メモ・参加者名はどの形式にも含めない。書き出さなかった件数は必ず表示する。
 * 外部カレンダーからの取込は今後のGateで扱う。
 */
import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Calendar, FileSpreadsheet, Map as MapIcon } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { downloadItineraryExport } from '@/services/api';
import type { ItineraryExportFormat, ItineraryExportOptions, LocationPrecision } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { FORMAT_LABEL, describeResult, saveFile } from './exports/exportModel';

const ExportsPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [icsAddresses, setIcsAddresses] = useState(false);
  const [csvAddresses, setCsvAddresses] = useState(false);
  const [precision, setPrecision] = useState<LocationPrecision>('approx');
  const [excludeLodging, setExcludeLodging] = useState(true);
  const [busy, setBusy] = useState<ItineraryExportFormat | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (format: ItineraryExportFormat, options: ItineraryExportOptions) => {
    if (!planId) return;
    setBusy(format);
    setError(null);
    setMessage(null);
    try {
      const file = await downloadItineraryExport(planId, format, options);
      saveFile(file);
      setMessage(describeResult(format, file));
    } catch (e) {
      setError(errorDetailMessage(e, `${FORMAT_LABEL[format]}の書き出しに失敗しました`));
    } finally {
      setBusy(null);
    }
  };

  if (!planId) return <div className="p-8 text-center text-gray-700">プランが選択されていません。</div>;

  const geo = { precision, exclude_accommodation: excludeLodging };
  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">← プランへ戻る</Button>
        <h1 className="text-2xl font-bold text-gray-900">書き出し</h1>
        <p className="text-sm text-gray-700 mt-1">
          旅程をカレンダー・地図アプリ・表計算ソフトで使える形式で保存します。予約番号・チケット・メモ・参加者名は含めません。
        </p>
      </div>

      <div aria-live="polite">
        {message && <div className="mb-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status" data-testid="export-result">{message}</div>}
      </div>
      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}

      <div className="space-y-4">
        <Card padding="md">
          <section aria-labelledby="export-ics">
            <h2 id="export-ics" className="font-semibold text-gray-900 flex items-center gap-2"><Calendar size={18} aria-hidden="true" />カレンダー(ICS)</h2>
            <p className="text-sm text-gray-700 mt-1">
              予定と移動をGoogle・Apple・Outlookのカレンダーへ取り込めます。同じ予定を再度取り込むと、新しい内容で更新されます。
              時刻が未定の予定は「(時刻未定)」の終日予定になります。
            </p>
            <label className="flex items-center gap-2 text-sm mt-2">
              <input type="checkbox" checked={icsAddresses} onChange={(e) => setIcsAddresses(e.target.checked)} />
              住所を含める(カレンダーを共有している場合は他の人にも見えます)
            </label>
            <Button variant="primary" size="sm" className="mt-3" loading={busy === 'ics'}
              onClick={() => run('ics', { include_addresses: icsAddresses })}>ICSを書き出す</Button>
          </section>
        </Card>

        <Card padding="md">
          <section aria-labelledby="export-geo">
            <h2 id="export-geo" className="font-semibold text-gray-900 flex items-center gap-2"><MapIcon size={18} aria-hidden="true" />地図(GPX・KML)</h2>
            <p className="text-sm text-gray-700 mt-1">
              訪れる場所と日ごとの順路を、地図アプリ(Googleマイマップ・Google Earth・登山/GPSアプリ等)で開けます。
              位置が登録されていない予定は含まれません。
            </p>
            <fieldset className="mt-2">
              <legend className="text-sm font-medium text-gray-800">位置の精度</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="export-precision" checked={precision === 'approx'} onChange={() => setPrecision('approx')} />
                約1km単位に丸める(おすすめ)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="export-precision" checked={precision === 'exact'} onChange={() => setPrecision('exact')} />
                正確な位置(約1m単位)
              </label>
            </fieldset>
            {precision === 'exact' && (
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-2 mt-1" role="note">
                正確な位置を含むファイルを共有すると、訪問先や行動が特定されるおそれがあります。
              </p>
            )}
            <label className="flex items-center gap-2 text-sm mt-2">
              <input type="checkbox" checked={excludeLodging} onChange={(e) => setExcludeLodging(e.target.checked)} />
              宿泊場所を除外する
            </label>
            <div className="flex gap-2 mt-3">
              <Button variant="primary" size="sm" loading={busy === 'gpx'} onClick={() => run('gpx', geo)}>GPXを書き出す</Button>
              <Button variant="outline" size="sm" loading={busy === 'kml'} onClick={() => run('kml', geo)}>KMLを書き出す</Button>
            </div>
          </section>
        </Card>

        <Card padding="md">
          <section aria-labelledby="export-csv">
            <h2 id="export-csv" className="font-semibold text-gray-900 flex items-center gap-2"><FileSpreadsheet size={18} aria-hidden="true" />表計算(CSV)</h2>
            <p className="text-sm text-gray-700 mt-1">予定の一覧をExcel・Googleスプレッドシート等で開けます。</p>
            <label className="flex items-center gap-2 text-sm mt-2">
              <input type="checkbox" checked={csvAddresses} onChange={(e) => setCsvAddresses(e.target.checked)} />
              住所を含める
            </label>
            <Button variant="primary" size="sm" className="mt-3" loading={busy === 'csv'}
              onClick={() => run('csv', { include_addresses: csvAddresses })}>CSVを書き出す</Button>
          </section>
        </Card>
      </div>
    </div>
  );
};

export default ExportsPage;
