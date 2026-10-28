/**
 * [Gate G11] 旅行相談の3: 方面を比較(地図と候補の一覧を並べる。2026-10-29 の統合ハンドオフ §3「3) 方面を比較」)。
 *
 * - 方面は利用者が書いた・足したものだけ(自動の方面の提案は未接続)。最初は3件、残りは「他の候補も見る」
 * - 地図は位置を照会できた方面だけ。線は直線で、道路の距離ではないと書く
 * - 各方面: 位置の照会の状態と出典・直線距離(計算値)・運転時間(未照会)・片道の条件との関係(下限の判定だけ)・
 *   宿(未照会)・静けさ(未確認)・営業時間(日付待ち)。根拠のない点数・料金・時間は出さない
 * - 行を押すと選ぶだけ(旅程にしない)。比較に残す・詳しく見る は別の操作
 */
import React, { Suspense, lazy, useId, useMemo, useState } from 'react';
import Button from '@/components/common/Button';
import { coverFor } from '@/styles/tokens';
import {
  GEOCODE_LABEL, LIMIT_LABEL, retrievedLabel, straightLabel, type ConsultState,
} from './consultModel';

const AreaMap = lazy(() => import('./AreaMap'));
const INITIAL = 3;

interface Props {
  state: ConsultState;
  busy: boolean;
  error: string | null;
  onEdit: () => void;
  onRetry: () => void;
  onAddArea: (name: string) => void;
  onRemoveArea: (name: string) => void;
  onSelect: (name: string) => void;
  onToggleSave: (name: string) => void;
  onOpen: (name: string) => void;
}

const AreasStep: React.FC<Props> = ({ state, busy, error, onEdit, onRetry, onAddArea, onRemoveArea, onSelect, onToggleSave,
  onOpen }) => {
  const id = useId();
  const [all, setAll] = useState(false);
  const [newArea, setNewArea] = useState('');
  const [mapView, setMapView] = useState(true);
  const r = state.review!;
  const result = state.areas;
  const rows = useMemo(() => result?.areas ?? [], [result]);
  const shown = all ? rows : rows.slice(0, INITIAL);
  const origin = result?.origin.status === 'ok' && result.origin.latitude !== null && result.origin.longitude !== null
    ? { label: result.origin.label ?? r.values.origin, latitude: result.origin.latitude, longitude: result.origin.longitude }
    : null;
  const pins = useMemo(() => rows.map((a, i) => ({ a, order: i + 1 }))
    .filter(({ a }) => a.geocode.status === 'ok' && a.geocode.latitude !== null && a.geocode.longitude !== null)
    .map(({ a, order }) => ({ name: a.name, order, latitude: a.geocode.latitude!, longitude: a.geocode.longitude!,
      selected: a.name === state.selectedArea })), [rows, state.selectedArea]);
  const conditions = [
    r.values.origin && `${r.values.origin}から`, r.values.nights !== null && (r.values.nights === 0 ? '日帰り' : `${r.values.nights}泊${r.values.nights + 1}日`),
    r.values.party_size && `大人${r.values.party_size}人`, r.values.transport === 'car' ? '自家用車' : r.values.transport === 'public' ? '公共交通' : null,
    r.values.one_way_hours && `片道${r.values.one_way_hours}時間(${r.confirmed.one_way ? (r.values.one_way_strength === 'required' ? '絶対条件' : '希望') : '未確認'})`,
  ].filter(Boolean).join(' · ');

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newArea.trim();
    if (!name || name.length > 40) return;
    setNewArea('');
    onAddArea(name);
    setAll(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink-700 break-words" data-testid="areas-conditions">{`適用中の条件: ${conditions || '未指定'}`}</p>
          <h2 className="mt-1 text-lg font-bold text-ink-900">どの方面が今回の旅に合いそう?</h2>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>条件を編集</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-cloud-200 pb-3">
        <span className="rounded-full bg-cloud-100 px-3 py-1 text-xs text-ink-900">{`候補の方面 ${rows.length || state.areaNames.length}件`}</span>
        <span className="rounded-full border border-warning px-3 py-1 text-xs text-warning" data-testid="areas-provider-note">
          位置だけ照会済み · 道路・宿・混み具合の提供元は未接続
        </span>
        <span aria-live="polite" className="text-xs text-ink-700">
          {busy ? '位置を照会しています(地名の照会は1秒に1件ずつ行います)…' : result ? retrievedLabel(result.retrieved_at) : ''}
        </span>
      </div>
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger">
          {error}<Button type="button" size="sm" variant="outline" onClick={onRetry}>もう一度照会する</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onEdit}>条件を戻す</Button>
        </div>
      )}
      {state.areaNames.length === 0 && (
        <div className="rounded-xl border border-dashed border-cloud-200 p-4 text-sm text-ink-700" data-testid="areas-empty">
          <p className="font-semibold text-ink-900">比べる方面がまだありません</p>
          <p>文章に「〇〇や△△が候補」と書くか、下で行ってみたい方面を足してください。方面を自動で提案する仕組みは未接続です(作り話の候補は出しません)。</p>
        </div>
      )}
      <div className="flex gap-2 lg:hidden" role="group" aria-label="表示の切り替え">
        <Button type="button" size="sm" variant={mapView ? 'primary' : 'outline'} aria-pressed={mapView} onClick={() => setMapView(true)}>地図</Button>
        <Button type="button" size="sm" variant={!mapView ? 'primary' : 'outline'} aria-pressed={!mapView} onClick={() => setMapView(false)}>一覧だけ</Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
        <section aria-labelledby={`${id}-map`} className={`${mapView ? '' : 'hidden lg:block'} overflow-hidden rounded-2xl border border-cloud-200 bg-surface`}>
          <div className="flex items-center justify-between border-b border-cloud-200 px-4 py-2">
            <div>
              <h3 id={`${id}-map`} className="text-sm font-semibold text-ink-900">位置関係</h3>
              <p className="text-xs text-ink-700">出発地からの位置 · 線は直線で、道路の距離・経路ではありません</p>
            </div>
          </div>
          <div className="tc-map-frame h-72 sm:h-96" data-testid="areas-map">
            {pins.length > 0 || origin ? (
              <Suspense fallback={<p className="p-4 text-sm text-ink-700">地図を読み込んでいます…</p>}>
                <AreaMap origin={origin} pins={pins} onSelect={onSelect} />
              </Suspense>
            ) : (
              <div className="grid h-full place-items-center p-4 text-center text-sm text-ink-700">
                {busy ? '位置を照会しています…' : '位置を照会できた方面がまだありません。一覧で照会の状態を確かめてください。'}
              </div>
            )}
          </div>
          <p className="px-4 py-2 text-xs text-ink-700">
            地図: © OpenStreetMap の協力者。運転時間・高速料金は道路の提供元が未接続のため照会していません。
          </p>
        </section>
        <section aria-labelledby={`${id}-list`} className="rounded-2xl border border-cloud-200 bg-surface">
          <h3 id={`${id}-list`} className="border-b border-cloud-200 px-4 py-2 text-sm font-semibold text-ink-900">
            {`方面の候補 · ${rows.length}件`}
          </h3>
          <ul aria-label="方面の候補" className="divide-y divide-cloud-200">
            {shown.map((a, i) => {
              const selected = a.name === state.selectedArea;
              const saved = state.savedAreas.includes(a.name);
              const pal = coverFor({ destination: a.name });
              const limit = a.limit_check.status;
              return (
                <li key={a.name} data-testid={`area-row-${a.name}`} data-selected={selected}
                  className={`grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 p-3 ${selected ? 'bg-accent-soft' : ''}`}>
                  <div aria-hidden="true" className="relative h-20 overflow-hidden rounded-lg"
                    style={{ background: `linear-gradient(135deg, ${pal.from}, ${pal.to})` }}>
                    <span className="absolute left-1 top-1 rounded bg-cloud-0 px-1 text-xs font-bold text-ink-900">{i + 1}</span>
                    <span className="absolute bottom-1 left-1 right-1 rounded bg-cloud-0 px-1 text-[10px] text-ink-900">イメージ</span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" aria-pressed={selected} onClick={() => onSelect(a.name)}
                        className="tc-focus-ring min-h-11 text-left">
                        <span className="block text-base font-bold text-ink-900">{selected ? '● ' : '○ '}{a.name}</span>
                        <span className="block text-[11px] text-ink-700">あなたが挙げた方面 · 選ぶだけでは旅程にしません</span>
                      </button>
                      <button type="button" aria-pressed={saved} onClick={() => onToggleSave(a.name)}
                        aria-label={saved ? `${a.name}を比較に残すのをやめる` : `${a.name}を比較に残す`}
                        className="tc-focus-ring min-h-11 min-w-11 rounded-lg text-lg text-ink-700">{saved ? '♥' : '♡'}</button>
                    </div>
                    <dl className="mt-1 grid gap-0.5 text-xs text-ink-700">
                      <div><dt className="inline font-semibold text-ink-900">位置: </dt>
                        <dd className="inline">{a.geocode.status === 'ok'
                          ? `${a.geocode.label ?? a.name} · OpenStreetMap ${retrievedLabel(a.geocode.retrieved_at)}`
                          : GEOCODE_LABEL[a.geocode.status]}</dd></div>
                      <div><dt className="inline font-semibold text-ink-900">距離: </dt>
                        <dd className="inline">{straightLabel(a.straight_km, r.values.origin)}</dd></div>
                      <div><dt className="inline font-semibold text-ink-900">🚗 運転: </dt><dd className="inline">実走行時間・高速料金は未照会</dd></div>
                      <div data-testid={`area-limit-${a.name}`}>
                        <dt className="inline font-semibold text-ink-900">片道の条件: </dt>
                        <dd className={`inline ${limit === 'exceeds' || limit === 'likely_exceeds' ? 'font-semibold text-warning' : ''}`}>
                          {`${limit === 'exceeds' || limit === 'likely_exceeds' ? '⚠ ' : ''}${LIMIT_LABEL[limit] ?? limit} · ${a.limit_check.note}`}
                        </dd>
                      </div>
                      <div><dt className="inline font-semibold text-ink-900">⌂ 宿: </dt><dd className="inline">料金・空室は未照会(宿の提供元が未接続)</dd></div>
                      <div><dt className="inline font-semibold text-ink-900">静けさ: </dt><dd className="inline">未確認(混み具合のデータ未接続)</dd></div>
                      <div><dt className="inline font-semibold text-ink-900">営業時間: </dt><dd className="inline">日付と場所が決まってから照会</dd></div>
                    </dl>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button type="button" size="sm" onClick={() => onOpen(a.name)} data-testid={`area-open-${a.name}`}>
                        この方面を詳しく見る →
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => onRemoveArea(a.name)}>比較から外す</Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {rows.length > INITIAL && (
            <div className="border-t border-cloud-200 p-3">
              <Button type="button" size="sm" variant="outline" onClick={() => setAll(!all)} aria-expanded={all}>
                {all ? '最初の3件だけ表示' : `他の候補も見る(+${rows.length - INITIAL})`}
              </Button>
            </div>
          )}
          <form onSubmit={add} className="flex flex-wrap items-end gap-2 border-t border-cloud-200 p-3" aria-label="方面を足す">
            <div className="min-w-0 flex-1">
              <label htmlFor={`${id}-add`} className="text-xs font-semibold text-ink-900">比べる方面を足す</label>
              <input id={`${id}-add`} value={newArea} maxLength={40} onChange={(e) => setNewArea(e.target.value)}
                placeholder="例: 淡路島" className="tc-focus-ring mt-1 min-h-11 w-full rounded-lg border border-cloud-200 bg-cloud-0 px-3 text-ink-900" />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={busy || !newArea.trim() || state.areaNames.length >= 10}>
              足して照会する
            </Button>
          </form>
        </section>
      </div>
      <p className="rounded-xl border border-warning bg-warning-soft p-3 text-xs text-ink-900">
        ⓘ <b>まだ宿・道路・営業時間の実データは照会していません。</b>この画面では方面の方向性を選びます。家族での投票は、
        旅程案を作った後の候補箱で行う機能が未対応のため、ここでは「比較に残す」で印を付けてください。
      </p>
    </div>
  );
};

export default AreasStep;
