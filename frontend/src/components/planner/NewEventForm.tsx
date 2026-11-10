/**
 * [Gate AddEventForm] 予定を追加の「手で入力」。スポットを編集と同じ入れ方にそろえる:
 * 時刻(30 分ごとの候補・分は手で)と滞在時間、場所・住所の自動取得(候補を選んで入れる・出典つき)、電話、URL(5 件まで)、
 * 地図の位置(住所から探す・印を動かして直す)、メモ。値は親(DayView)が持ち、保存も親が行う。
 */
import React, { useState } from 'react';
import { Globe, LocateFixed, Plus, X } from 'lucide-react';
import Input from '../common/Input';
import PlaceSourcesCredit from '@/components/places/PlaceSourcesCredit';
import { geocodeAddress, type PlaceInfoResult } from '@/services/api/planEdit';
import { applyCandidate, endFrom, lookupPlace, type NewEventData } from './newEventLookup';
import { candidateHint } from '@/components/places/placeHelpers';
import { usePlanStore } from '@/store/planStore';

const SpotMiniMap = React.lazy(() => import('./SpotMiniMap'));

const NEW_EVENT_CATEGORIES: Array<[string, string]> = [
  ['sightseeing', '観光・神社・寺'], ['activity', '体験・アクティビティ'], ['dining', '食事・カフェ'], ['shopping', '買い物'],
  ['accommodation', '宿'], ['transportation', '交通・移動'], ['area', 'エリア(中に予定を入れる)'], ['other', 'その他'],
];
const HALF = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const field = 'mt-1 block w-full rounded-lg border border-cloud-200 bg-cloud-0 px-3 py-2 text-sm text-ink-900';

interface Props {
  data: NewEventData;
  setData: React.Dispatch<React.SetStateAction<NewEventData>>;
  urlRows: string[];
  setUrlRows: React.Dispatch<React.SetStateAction<string[]>>;
  stay: { h: string; m: string };
  setStay: (s: { h: string; m: string }) => void;
  near: { latitude: number; longitude: number } | null;
  /** 親が自動取得した時の結果(名前で検索から来た時など) */
  lookupState: { busy: boolean; result: PlaceInfoResult | null; error: string | null };
  setLookupState: (s: { busy: boolean; result: PlaceInfoResult | null; error: string | null }) => void;
  /** [Gate EventArea] この日のエリア(中へ入れる先の候補) */
  areas?: { id: string; title: string }[];
}

const NewEventForm: React.FC<Props> = ({ data, setData, urlRows, setUrlRows, stay, setStay, near, lookupState, setLookupState, areas = [] }) => {
  const [geo, setGeo] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  const set = (p: NewEventData) => setData((d) => ({ ...d, ...p }));
  const runLookup = async () => {
    const name = (data.title || data.location_name || '').trim();
    if (!name) { setLookupState({ busy: false, result: null, error: '先にタイトル(場所の名前)を入れてください' }); return; }
    setLookupState({ busy: true, result: null, error: null });
    try {
      const { result } = await lookupPlace(name, near, data.address);
      setLookupState({ busy: false, result, error: result.unavailable ? '場所の情報の提供元が応答しませんでした'
        : result.candidates.length ? null : '場所の情報が見つかりませんでした。正式名称にするか、住所を入れて試してください' });
    } catch {
      setLookupState({ busy: false, result: null, error: '場所の情報を読めませんでした' });
    }
  };
  const findPosition = async () => {
    const q = (data.address || data.location_name || data.title || '').trim();
    if (!q) return;
    setGeo({ busy: true, note: null });
    try {
      const r = await geocodeAddress(q, { ...(near ?? {}), plan_id: usePlanStore.getState().currentPlan?.id ?? null });
      const c = r.candidates[0];
      if (c) { set({ latitude: c.latitude, longitude: c.longitude }); setGeo({ busy: false, note: `「${c.address ?? q}」の位置にしました` }); }
      else setGeo({ busy: false, note: 'この住所の位置が見つかりませんでした。住所の書き方を確かめてください' });
    } catch {
      setGeo({ busy: false, note: '位置を読めませんでした' });
    }
  };
  const hasPos = typeof data.latitude === 'number' && typeof data.longitude === 'number';
  return (
    <div className="space-y-4" data-testid="new-event-form">
      <datalist id="tc-new-half-hours">{HALF.map((v) => <option key={v} value={v} />)}</datalist>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_12rem]">
        <Input label="タイトル *" value={data.title || ''} onChange={(e) => set({ title: e.target.value })} placeholder="例: 伊勢神宮 内宮" fullWidth />
        <label className="block text-sm font-medium text-ink-700">種類
          <select value={data.category || 'sightseeing'} onChange={(e) => set({ category: e.target.value as NewEventData['category'] })} className={field}>
            {NEW_EVENT_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      {/* [Gate EventArea] エリアは大きな枠(おかげ横丁など)。中の予定は枠の中に字下げで並び、中の移動は数えない */}
      {data.category === 'area' && (
        <p className="text-xs text-ink-700" data-testid="new-area-hint">
          エリアは、おかげ横丁のような歩いて回る範囲です。開始・終了を滞在の時間にし、中の店などはこのエリアに入れて追加してください。
        </p>
      )}
      {data.category !== 'area' && areas.length > 0 && (
        <label className="block text-sm font-medium text-ink-700">エリアの中に入れる(任意)
          <select value={data.parent_event_id ?? ''} onChange={(e) => set({ parent_event_id: e.target.value || null })} className={field}
            data-testid="new-event-area">
            <option value="">入れない</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </label>
      )}
      <fieldset className="rounded-xl border border-cloud-200 p-3">
        <legend className="px-1 text-sm font-semibold text-ink-900">時間(任意)</legend>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium text-ink-700">開始時刻
            <input type="time" list="tc-new-half-hours" className={field} value={data.start_time || ''} data-testid="new-start"
              onChange={(e) => set({ start_time: e.target.value, end_time: endFrom(e.target.value, stay.h, stay.m) })} />
          </label>
          <span className="pb-2 text-ink-700" aria-hidden="true">〜</span>
          <fieldset disabled={!data.start_time}>
            <legend className="text-sm font-medium text-ink-700">この場所での時間</legend>
            <div className="mt-1 flex items-center gap-1 text-sm">
              <input type="number" min={0} max={23} aria-label="滞在(時間)" className="w-16 rounded-lg border border-cloud-200 bg-cloud-0 px-2 py-2"
                value={stay.h} onChange={(e) => { setStay({ ...stay, h: e.target.value }); set({ end_time: endFrom(data.start_time || '', e.target.value, stay.m) }); }} />
              <span>時間</span>
              <input type="number" min={0} max={59} step={15} aria-label="滞在(分)" className="w-16 rounded-lg border border-cloud-200 bg-cloud-0 px-2 py-2"
                value={stay.m} onChange={(e) => { setStay({ ...stay, m: e.target.value }); set({ end_time: endFrom(data.start_time || '', stay.h, e.target.value) }); }} />
              <span>分</span>
            </div>
          </fieldset>
        </div>
        <p className="mt-1 text-xs text-ink-700">{data.end_time ? `終わり ${data.end_time}` : '開始時刻と滞在時間を入れると、終わりの時刻を決めます(30 分ごとの候補・分は手で入れられます)'}</p>
      </fieldset>
      <div>
        <label htmlFor="new-address" className="block text-sm font-medium text-ink-700">場所・住所</label>
        <div className="mt-1 flex gap-2">
          <input id="new-address" className={field + ' mt-0'} value={data.address || ''} placeholder="例: 三重県伊勢市宇治館町1"
            onChange={(e) => set({ address: e.target.value })} />
          <button type="button" className="tc-focus-ring tc-mbtn shrink-0" onClick={() => void runLookup()} disabled={lookupState.busy}
            data-testid="new-lookup" title="タイトル(場所の名前)・住所・旅行の位置から、住所・電話・公式サイト・種類・地図の位置を調べます">
            <Globe size={15} aria-hidden="true" />自動取得</button>
        </div>
        {lookupState.busy && <p className="mt-1 text-xs text-ink-700" role="status">調べています…</p>}
        {lookupState.error && <p className="mt-1 text-xs text-ink-700" role="status" data-testid="new-lookup-note">{lookupState.error}</p>}
        {lookupState.result && lookupState.result.candidates.length > 0 && (
          <div className="mt-2 rounded-xl border border-cloud-200 p-2" data-testid="new-lookup-result">
            <ul className="divide-y divide-cloud-200">
              {lookupState.result.candidates.map((c, i) => (
                <li key={`${c.name}-${i}`} className="flex items-start gap-2 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink-900">{c.name ?? '名前なし'}</p>
                    <p className="text-xs text-ink-700">{[c.address, c.phone && `TEL ${c.phone}`, c.website].filter(Boolean).join(' · ')}</p>
                    {c.notes?.map((n) => <p key={n} className="text-xs text-ink-700">{n}</p>)}
                    {candidateHint(c, lookupState.result?.area) && (
                      <p className="text-[11px] text-ink-600" data-testid={`new-lookup-hint-${i}`}>{candidateHint(c, lookupState.result?.area)}</p>)}
                  </div>
                  <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary shrink-0" aria-label={`「${c.name ?? ''}」を入れる`}
                    onClick={() => { const r = applyCandidate(data, urlRows, c); setData(r.data); setUrlRows(r.urlRows); setLookupState({ busy: false, result: null, error: null }); }}>入れる</button>
                </li>
              ))}
            </ul>
            <PlaceSourcesCredit sources={lookupState.result.sources} className="mt-1 text-[11px] text-ink-700" />
          </div>
        )}
      </div>
      <Input label="電話番号" type="tel" value={data.phone || ''} onChange={(e) => set({ phone: e.target.value })} maxLength={40} fullWidth />
      <div>
        <p className="text-sm font-medium text-ink-700">URL(公式サイト・予約・SNS など。5 件まで)</p>
        {urlRows.map((u, i) => (
          <div key={i} className="mt-1 flex items-center gap-2">
            <input type="url" className={field + ' mt-0'} value={u} placeholder="https://" aria-label={`URL ${i + 1}`}
              onChange={(e) => setUrlRows((rows) => rows.map((r, j) => (j === i ? e.target.value : r)))} />
            {urlRows.length > 1 && (
              <button type="button" className="tc-focus-ring rounded-lg p-2" aria-label={`URL ${i + 1} を外す`}
                onClick={() => setUrlRows((rows) => rows.filter((_, j) => j !== i))}><X size={14} aria-hidden="true" /></button>
            )}
          </div>
        ))}
        {urlRows.length < 5 && (
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm mt-1" onClick={() => setUrlRows((rows) => [...rows, ''])}>
            <Plus size={14} aria-hidden="true" />URL を追加</button>
        )}
      </div>
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-ink-700">地図の位置</p>
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => void findPosition()} disabled={geo.busy}
            data-testid="new-geocode"><LocateFixed size={14} aria-hidden="true" />住所から位置を探す</button>
        </div>
        {geo.note && <p className="mt-1 text-xs text-ink-700" role="status">{geo.note}</p>}
        {hasPos ? (
          <React.Suspense fallback={<p className="text-xs text-ink-700">地図を読み込み中…</p>}>
            <div className="mt-2 overflow-hidden rounded-xl border border-cloud-200">
              <SpotMiniMap latitude={data.latitude!} longitude={data.longitude!} label={data.title || '予定の場所'}
                onMove={(lat, lng) => set({ latitude: lat, longitude: lng })} height={200} />
            </div>
            <p className="mt-1 text-xs text-ink-700">印を動かすと位置を直せます</p>
          </React.Suspense>
        ) : <p className="mt-1 text-xs text-ink-700" data-testid="new-map-empty">位置はまだありません(自動取得か「住所から位置を探す」で入ります)</p>}
      </div>
      <label className="block text-sm font-medium text-ink-700">メモ(見どころ・予約の要否・持ち物など)
        <textarea rows={3} className={field} value={data.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium text-ink-700">優先度
          <select value={data.priority ?? 3} onChange={(e) => set({ priority: Number(e.target.value) })} className={field}>
            <option value={1}>低</option><option value={3}>中</option><option value={5}>高</option>
          </select>
        </label>
        <Input label="費用 (円)" type="number" value={data.cost || 0} onChange={(e) => set({ cost: Number(e.target.value) })} fullWidth />
      </div>
    </div>
  );
};

export default NewEventForm;
