/**
 * [Gate G11] 全日程の横断チャート(docs/ux/G11_UIUX全範囲_実装仕様.md §3.2、UIX-M06。画面の正本のモックの「全日程」)。
 *
 * - 各日が1列(幅に応じて 3列 → 2列 → 1列。4日を超えると横に流し、流せることを示す)
 * - 全ての列で同じ時刻の物差し(その旅行で最も早い開始〜最も遅い終わり)。予定は時刻の位置に帯で置く
 * - 列の見出しに日付・曜日・時刻帯・要約(予定の数・最初と最後・移動の合計・空き時間・固定の数)
 * - 予定・列を押すとその日の日別へ戻る。時刻の無い予定は列の下に並べる
 * 空き時間・移動の合計は重なりを二重に数えない(plannerModel.unionMinutes)。
 */
import React, { useMemo } from 'react';
import TransportIcon from '../common/TransportIcon';
import type { DaySchedule } from '@/types';
import type { TravelSegment } from '@/services/api/types/segments';
import { buildChart, type ChartDay } from './plannerModel';
import { durationLabel } from '@/utils/transportModes';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const PX_PER_HOUR = 44;

function weekday(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return '';
  return WEEK[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()] ?? '';
}

function hm(v: number): string {
  return `${String(Math.floor(v / 60) % 24).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

interface Props {
  days: DaySchedule[];
  segments: TravelSegment[];
  currentDay: number;
  onOpenDay: (index: number) => void;
}

const DayColumn: React.FC<{ day: ChartDay; scaleStart: number; scaleEnd: number; current: boolean;
  onOpen: () => void }> = ({ day, scaleStart, scaleEnd, current, onOpen }) => {
  const height = ((scaleEnd - scaleStart) / 60) * PX_PER_HOUR;
  const label = `${day.date}(${weekday(day.date)})`;
  return (
    <section aria-labelledby={`chart-day-${day.id}`} data-testid={`chart-day-${day.index}`}
      className={`flex min-w-[15rem] flex-col rounded-xl border bg-surface p-3 ${current ? 'border-accent' : 'border-cloud-200'}`}>
      <header className="border-b border-cloud-200 pb-2">
        <p className="text-xs font-semibold text-ink-700">{`DAY ${day.index + 1}`}</p>
        <h3 id={`chart-day-${day.id}`} className="font-semibold text-ink-900">{label}</h3>
        <p className="text-xs text-ink-700">{`現地時間 · ${day.timezone ?? '時刻帯未確認'}`}</p>
        <p className="mt-1 text-xs text-ink-700" data-testid={`chart-summary-${day.index}`}>
          {[
            `予定 ${day.events.length + day.untimed.length}件`,
            day.first && day.last ? `${day.first}〜${day.last}` : null,
            `移動 ${durationLabel(day.travelMinutes)}`,
            day.freeMinutes !== null ? `空き ${durationLabel(day.freeMinutes)}` : null,
            day.lockedCount ? `固定 ${day.lockedCount}件` : null,
          ].filter(Boolean).join('・')}
        </p>
      </header>
      <div className="relative mt-2" style={{ height }} aria-hidden="false">
        {Array.from({ length: (scaleEnd - scaleStart) / 60 + 1 }, (_, i) => (
          <span key={i} className="absolute left-0 right-0 border-t border-dashed border-cloud-200 text-[10px] text-ink-700"
            style={{ top: i * PX_PER_HOUR }} aria-hidden="true">{hm(scaleStart + i * 60)}</span>
        ))}
        <ol className="absolute inset-0 left-10" aria-label={`${label}の予定(時刻順)`}>
          {day.events.map((e) => {
            const top = (((e.start ?? scaleStart) - scaleStart) / 60) * PX_PER_HOUR;
            const h = Math.max(30, ((((e.end ?? e.start ?? scaleStart) - (e.start ?? scaleStart)) / 60) * PX_PER_HOUR));
            return (
              <li key={e.id} className="absolute left-0 right-0" style={{ top, height: h }}>
                <button type="button" onClick={onOpen} data-testid={`chart-event-${e.id}`}
                  className="h-full w-full overflow-hidden rounded-md border border-cloud-200 bg-cloud-100 px-2 py-1 text-left text-xs text-ink-900">
                  <span className="font-semibold">{hm(e.start ?? 0)}</span>{' '}
                  <span>{e.title}</span>
                  {!e.endKnown && <span className="text-ink-700">(終了未設定)</span>}
                  {e.modeText && <span className="block text-ink-700"><TransportIcon mode={e.mode} size={12} /> {e.modeText}</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      {day.untimed.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-ink-700" aria-label={`${label}の時刻の無い予定`}>
          {day.untimed.map((e) => <li key={e.id}>{`時刻未定 · ${e.title}`}</li>)}
        </ul>
      )}
      <button type="button" onClick={onOpen} className="mt-3 self-start text-sm font-semibold text-accent underline"
        data-testid={`chart-open-${day.index}`}>
        この日を編集する
      </button>
    </section>
  );
};

const AllDaysChart: React.FC<Props> = ({ days, segments, currentDay, onOpenDay }) => {
  const model = useMemo(() => buildChart(days, segments, new Set(days.flatMap((d) => d.events.filter((e) => e.locked)
    .map((e) => e.id)))), [days, segments]);
  const many = days.length > 3;
  return (
    <section aria-labelledby="all-days-title" data-testid="all-days-chart" className="mb-4">
      <h2 id="all-days-title" className="text-base font-semibold text-ink-900">全日程の横断チャート</h2>
      <p className="text-xs text-ink-700">日ごとの予定の密度と空き時間を、同じ時刻の物差しで見比べられます。予定を押すとその日の編集に戻ります。</p>
      {many && <p className="mt-1 text-xs text-ink-700" data-testid="all-days-scroll-hint">横に流すと他の日も見られます →</p>}
      <div className={`mt-3 gap-3 ${many ? 'flex overflow-x-auto pb-2' : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}
        tabIndex={many ? 0 : undefined} aria-label={many ? '全日程(横に流せます)' : undefined}
        role={many ? 'region' : undefined}>
        {model.days.map((d) => (
          <DayColumn key={d.id} day={d} scaleStart={model.scaleStart} scaleEnd={model.scaleEnd}
            current={d.index === currentDay} onOpen={() => onOpenDay(d.index)} />
        ))}
      </div>
    </section>
  );
};

export default AllDaysChart;
