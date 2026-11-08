/**
 * [Gate G11] 全日程の横断チャート(docs/ux/G11_UIUX全範囲_実装仕様.md §3.2、UIX-M06。画面の正本のモックの「全日程」)。
 *
 * - 各日が1列(幅に応じて 3列 → 2列 → 1列。4日を超えると横に流し、流せることを示す)
 * - 全ての列で同じ時刻の物差し(その旅行で最も早い開始〜最も遅い終わり)。予定は時刻の位置に帯で置く
 * - 列の見出しに日付・曜日・時刻帯・要約(予定の数・最初と最後・移動の合計・空き時間・固定の数)
 * - 予定・列を押すとその日の日別へ戻る。時刻の無い予定は列の下に並べる
 * - [Gate EventMoveDay] 予定を別の日の列へドラッグ&ドロップすると、その日へ移す(時刻はそのまま・固定の予定は動かさない)
 * - [Gate TimelineDrag] 時刻の物差しの上に落とすと、落とした位置の時刻(15分単位)へ変える(同じ日でも・別の日でも。長さは保つ)。
 *   見出しなど物差しの外に落とすと、日だけを変える。帯は種類ごとの色で見分ける(凡例つき)
 * 空き時間・移動の合計は重なりを二重に数えない(plannerModel.unionMinutes)。
 */
import React, { useMemo, useState } from 'react';
import TransportIcon from '../common/TransportIcon';
import type { DaySchedule } from '@/types';
import type { TravelSegment } from '@/services/api/types/segments';
import { SNAP_MINUTES, buildChart, minutesToHm, snapMinutes, type ChartDay } from './plannerModel';
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
  /** [Gate EventMoveDay][Gate TimelineDrag] 予定を別の日・別の時刻へ移す(ドラッグ&ドロップ)。start は物差しの上に落とした時の
   * 新しい開始(HH:MM・15分単位)。無ければドラッグできない */
  onMoveEvent?: (eventId: string, fromIndex: number, toIndex: number, start?: string) => void;
}

const DRAG_TYPE = 'application/x-tc-event';
interface DragState { id: string; from: number; start: number | null; grab: number }

const CATEGORY_NAME: Record<string, string> = {
  accommodation: '宿', dining: '食事', sightseeing: '観光', activity: '体験', shopping: '買い物', transportation: '移動', other: 'その他',
};
const catClass = (c?: string) => `tc-cat tc-cat--${c && CATEGORY_NAME[c] ? c : 'other'}`;

const DayColumn: React.FC<{ day: ChartDay; scaleStart: number; scaleEnd: number; current: boolean;
  onOpen: () => void; locked: Set<string>; drag: DragState | null; setDrag: (d: DragState | null) => void;
  onDropEvent?: (d: DragState, start?: number) => void }> = ({ day, scaleStart, scaleEnd, current, onOpen, locked, drag, setDrag, onDropEvent }) => {
  const height = ((scaleEnd - scaleStart) / 60) * PX_PER_HOUR;
  const label = `${day.date}(${weekday(day.date)})`;
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const canDrop = !!onDropEvent && !!drag && drag.from !== day.index;
  const readDrag = (ev: React.DragEvent): DragState | null => {
    try {
      const raw = ev.dataTransfer.getData(DRAG_TYPE);
      if (raw) return JSON.parse(raw) as DragState;
    } catch { /* 同じ画面の中は drag の値を使う */ }
    return drag;
  };
  // 物差しの上の位置 → 開始の時刻(つかんだ所の分を引き、15分単位)
  const minuteAt = (ev: React.DragEvent, d: DragState | null): number => {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const raw = scaleStart + ((ev.clientY - rect.top) / PX_PER_HOUR) * 60 - (d?.grab ?? 0);
    return snapMinutes(Number.isFinite(raw) ? raw : d?.start ?? scaleStart);
  };
  const dragProps = (id: string, start: number | null) => (onDropEvent && !locked.has(id) ? {
    draggable: true,
    onDragStart: (ev: React.DragEvent) => {
      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      const grab = start !== null && rect.height > 0 ? Math.max(0, ((ev.clientY - rect.top) / PX_PER_HOUR) * 60) : 0;
      const d: DragState = { id, from: day.index, start, grab: Number.isFinite(grab) ? grab : 0 };
      ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify(d));
      ev.dataTransfer.effectAllowed = 'move';
      setDrag(d);
    },
    onDragEnd: () => { setDrag(null); setPreview(null); },
    title: 'ドラッグして時刻の位置(15分単位)や別の日の列に落とすと、その時刻・日へ移せます',
  } : { title: locked.has(id) ? '固定の予定は動かせません' : undefined });
  return (
    <section aria-labelledby={`chart-day-${day.id}`} data-testid={`chart-day-${day.index}`}
      onDragOver={(ev) => { if (canDrop) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(ev) => {
        setOver(false);
        if (!onDropEvent) return;
        ev.preventDefault();
        const d = readDrag(ev);
        setDrag(null);
        if (d && d.from !== day.index) onDropEvent(d);
      }}
      data-drop={over && canDrop ? 'over' : undefined}
      className={`flex min-w-[15rem] flex-col rounded-xl border bg-surface p-3 ${over && canDrop ? 'border-accent ring-2 ring-accent/40 bg-cloud-50'
        : current ? 'border-accent' : 'border-cloud-200'}`}>
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
      <div className="relative mt-2" style={{ height }} aria-hidden="false" data-testid={`chart-scale-${day.index}`}
        onDragOver={(ev) => {
          if (!onDropEvent || !drag) return;
          ev.preventDefault();
          ev.stopPropagation();
          ev.dataTransfer.dropEffect = 'move';
          setOver(drag.from !== day.index);
          setPreview(minuteAt(ev, drag));
        }}
        onDragLeave={() => setPreview(null)}
        onDrop={(ev) => {
          if (!onDropEvent) return;
          ev.preventDefault();
          ev.stopPropagation();
          const d = readDrag(ev);
          const at = minuteAt(ev, d);
          setOver(false);
          setPreview(null);
          setDrag(null);
          if (d && (d.from !== day.index || d.start !== at)) onDropEvent(d, at);
        }}>
        {preview !== null && (
          <div className="tc-drop-line" style={{ top: ((preview - scaleStart) / 60) * PX_PER_HOUR }} data-testid={`chart-drop-${day.index}`}>
            <span>{`${minutesToHm(preview)} から`}</span>
          </div>
        )}
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
                <button type="button" onClick={onOpen} data-testid={`chart-event-${e.id}`} {...dragProps(e.id, e.start)}
                  data-category={e.category}
                  className={`h-full w-full overflow-hidden rounded-md border border-cloud-200 ${catClass(e.category)} px-2 py-1 text-left text-xs text-ink-900${
                    onDropEvent && !locked.has(e.id) ? ' cursor-grab active:cursor-grabbing' : ''}${drag?.id === e.id ? ' opacity-50' : ''}`}>
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
          {day.untimed.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={onOpen} data-testid={`chart-event-${e.id}`} {...dragProps(e.id, null)}
                data-category={e.category}
                className={`w-full rounded-md border border-cloud-200 ${catClass(e.category)} px-1 text-left${onDropEvent && !locked.has(e.id) ? ' cursor-grab' : ''}`}>
                {`時刻未定 · ${e.title}`}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={onOpen} className="mt-3 self-start text-sm font-semibold text-accent underline"
        data-testid={`chart-open-${day.index}`}>
        この日を編集する
      </button>
    </section>
  );
};

const AllDaysChart: React.FC<Props> = ({ days, segments, currentDay, onOpenDay, onMoveEvent }) => {
  const locked = useMemo(() => new Set(days.flatMap((d) => d.events.filter((e) => e.locked).map((e) => e.id))), [days]);
  const model = useMemo(() => buildChart(days, segments, locked), [days, segments, locked]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const many = days.length > 3;
  const cats = Object.keys(CATEGORY_NAME).filter((c) => model.days.some((d) => [...d.events, ...d.untimed].some((e) => (e.category ?? 'other') === c)));
  return (
    <section aria-labelledby="all-days-title" data-testid="all-days-chart" className="mb-4">
      <h2 id="all-days-title" className="text-base font-semibold text-ink-900">全日程の横断チャート</h2>
      <p className="text-xs text-ink-700">日ごとの予定の密度と空き時間を、同じ時刻の物差しで見比べられます。予定を押すとその日の編集に戻ります。
        {onMoveEvent && ` 予定をドラッグして時刻の位置に落とすと${SNAP_MINUTES}分単位で時刻を、別の日の列に落とすと日を変えられます(長さはそのまま。見出しに落とすと時刻はそのまま。スマホでは予定の編集で変えられます)。`}</p>
      {cats.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-700" aria-label="帯の色(種類)" data-testid="chart-legend">
          {cats.map((c) => (
            <li key={c} className="inline-flex items-center gap-1"><span className={`tc-cat-dot ${catClass(c)}`} aria-hidden="true" />{CATEGORY_NAME[c]}</li>
          ))}
        </ul>
      )}
      {many && <p className="mt-1 text-xs text-ink-700" data-testid="all-days-scroll-hint">横に流すと他の日も見られます →</p>}
      <div className={`mt-3 gap-3 ${many ? 'flex overflow-x-auto pb-2' : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}
        tabIndex={many ? 0 : undefined} aria-label={many ? '全日程(横に流せます)' : undefined}
        role={many ? 'region' : undefined}>
        {model.days.map((d) => (
          <DayColumn key={d.id} day={d} scaleStart={model.scaleStart} scaleEnd={model.scaleEnd}
            current={d.index === currentDay} onOpen={() => onOpenDay(d.index)} locked={locked} drag={drag} setDrag={setDrag}
            onDropEvent={onMoveEvent ? (x, start) => (start === undefined ? onMoveEvent(x.id, x.from, d.index)
              : onMoveEvent(x.id, x.from, d.index, minutesToHm(start))) : undefined} />
        ))}
      </div>
    </section>
  );
};

export default AllDaysChart;
