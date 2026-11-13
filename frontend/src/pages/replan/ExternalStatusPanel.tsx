/**
 * [Gate Remaining-2] FR-030 外の情報(気象庁の警報・注意報、鍵がある時は鉄道の運行情報)。
 *
 * 押した時だけ取りに行く(画面を開くたびに外へ送らない)。今日・明日の予定の場所の市区町村が対象。
 * 登録はしない: 「状況として登録」で下の欄に入れ、利用者が確かめて登録する。取れない時は手で登録する欄のまま。
 */
import React, { useState } from 'react';
import { CloudRain } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { getExternalStatus, type ExternalStatus } from '@/services/api/remaining2';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { formatObserved, formFromTransit, formFromWarnings, type AlertForm } from './replanModel';

const LEVEL_CLASS: Record<string, string> = {
  special: 'bg-purple-100 text-purple-900', warning: 'bg-red-100 text-red-900', advisory: 'bg-amber-100 text-amber-900',
};

const ExternalStatusPanel: React.FC<{
  planId: string;
  canEdit: boolean;
  onUse: (form: AlertForm, message: string) => void;
}> = ({ planId, canEdit, onUse }) => {
  const [data, setData] = useState<ExternalStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await getExternalStatus(planId));
    } catch (e) {
      setError(errorDetailMessage(e, '外の情報を取れませんでした。状況は下の欄から手で登録できます'));
    } finally {
      setBusy(false);
    }
  };

  const withWarnings = data?.weather.filter((w) => w.warnings.length > 0) ?? [];
  const quiet = data ? data.weather.filter((w) => w.warnings.length === 0) : [];

  return (
    <section aria-labelledby="external-heading" className="mt-6" data-testid="external-status">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 id="external-heading" className="font-semibold text-ink-900">外の情報(気象庁の警報・注意報・運行情報)</h2>
        <Button variant="outline" size="sm" loading={busy} onClick={check}
          icon={<CloudRain size={16} aria-hidden="true" />}>{data ? 'もう一度確かめる' : '外の情報を確かめる'}</Button>
      </div>
      <p className="text-xs text-ink-700">
        今日と明日の予定の場所(市区町村)について、気象庁が発表中の警報・注意報を取ります。送るのは地域の番号だけです。
        {data && !data.providers.odpt.configured && ' 鉄道の運行情報は提供元の設定が無いため、手で登録してください。'}
      </p>
      {error && <p className="mt-2 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</p>}
      {data && data.unavailable.length > 0 && (
        <p className="mt-2 p-3 rounded-lg bg-amber-50 text-amber-900 text-sm" role="status">
          {data.unavailable.includes('jma') && '気象庁の情報を取れませんでした。'}
          {data.unavailable.includes('odpt') && '運行情報を取れませんでした。'}
          状況は下の欄から手で登録できます。
        </p>
      )}
      {data && data.days.length === 0 && (
        <p className="mt-2 text-sm text-ink-700" role="status">今日・明日の予定がありません(警報・注意報は今の発表だけです)。</p>
      )}
      {data && data.days.length > 0 && data.weather.length === 0 && data.unavailable.length === 0 && (
        <p className="mt-2 text-sm text-ink-700" role="status">場所(地図の位置)のある日本の予定が無いため、警報・注意報は調べていません。</p>
      )}
      {data && (withWarnings.length > 0 || data.transit.length > 0 || quiet.length > 0) && (
        <ul className="mt-2 space-y-2" aria-label="外の情報">
          {withWarnings.map((w) => (
            <li key={`${w.day_id}-${w.office}-${w.area_name}`}>
              <Card padding="md" className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">{`${w.local_date} ${w.area_name ?? ''}`}</p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {w.warnings.map((x) => (
                      <span key={x.code} className={`text-xs px-1.5 py-0.5 rounded-sm ${LEVEL_CLASS[x.level]}`}>{x.name}</span>
                    ))}
                  </p>
                  <p className="text-xs text-ink-700 mt-1">{`${w.source} ・ ${formatObserved(w.report_at)} の発表`}</p>
                </div>
                {canEdit && (
                  <Button variant="outline" size="sm" onClick={() => onUse(formFromWarnings(w),
                    `${w.local_date} の警報・注意報を下の欄に入れました。確かめて登録してください`)}>状況として登録</Button>
                )}
              </Card>
            </li>
          ))}
          {quiet.map((w) => (
            <li key={`${w.day_id}-${w.office}-${w.area_name}-q`} className="text-sm text-ink-700">
              {`${w.local_date} ${w.area_name ?? ''}: 発表中の警報・注意報はありません(${w.source} ・ ${formatObserved(w.report_at)})`}
            </li>
          ))}
          {data.transit.map((t) => (
            <li key={`${t.railway}-${t.observed_at}`}>
              <Card padding="md" className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">{`${t.railway}: ${t.status}`}</p>
                  {t.text && <p className="text-sm text-ink-900 mt-1 wrap-break-word">{t.text}</p>}
                  <p className="text-xs text-ink-700 mt-1">{`${t.source} ・ ${formatObserved(t.observed_at)}`}</p>
                </div>
                {canEdit && (
                  <Button variant="outline" size="sm" onClick={() => onUse(formFromTransit(t),
                    `${t.railway}の運行情報を下の欄に入れました。影響を受ける予定と遅れの見込みを確かめて登録してください`)}>
                    状況として登録
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default ExternalStatusPanel;
