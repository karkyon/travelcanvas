/**
 * [Gate ProviderConnect] 旅行の中の有料の機能(AI の案・Google の場所の検索・Google の経路)。
 *
 * - 押した時だけ送る(ページを開いただけでは送らない)。1回の押下ごとに Idempotency-Key を1つ作る。送っている間は押せない
 * - 会員のクラス・1旅行 50円の枠・鍵の確認はサーバーが送る前に判定する。断られたら理由を出し、手で続けられると案内する
 * - 結果は旅行に保存しない(AI の案は「要確認」、Google の結果は帰属の表示を付ける)
 */
import React, { useState } from 'react';
import type { TravelPlan } from '@/types';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import {
  newIdempotencyKey, paidAiSuggest, paidPlacesSearch, paidRoute, type PaidAiResult, type PaidPlacesResult,
  type PaidRouteMode, type PaidRouteResult,
} from '@/services/api/paidActions';

interface Props {
  plan: TravelPlan;
  dayIndex: number;
  className?: string;
  onUsed?: () => void;
}

const MODE_LABEL: Record<PaidRouteMode, string> = { driving: '車', walking: '徒歩', bicycling: '自転車', transit: '公共交通' };

const PaidActionsPanel: React.FC<Props> = ({ plan, dayIndex, className = '', onUsed }) => {
  const [prompt, setPrompt] = useState('');
  const [query, setQuery] = useState('');
  const day = plan.days[dayIndex];
  const located = (day?.events ?? []).filter((e) => typeof e.latitude === 'number' && typeof e.longitude === 'number');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [mode, setMode] = useState<PaidRouteMode>('driving');
  const [busy, setBusy] = useState<'ai' | 'places' | 'route' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<PaidAiResult | null>(null);
  const [places, setPlaces] = useState<PaidPlacesResult | null>(null);
  const [route, setRoute] = useState<PaidRouteResult | null>(null);

  const run = async (kind: 'ai' | 'places' | 'route', fn: (key: string) => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      await fn(newIdempotencyKey());
      onUsed?.();
    } catch (e) {
      setError(`${errorDetailMessage(e, '送れませんでした')}。手で予定を作って続けられます`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby={`paid-actions-${plan.id}`} data-testid="paid-actions"
      className={`rounded-xl border border-cloud-200 bg-surface p-3 text-sm text-ink-900 ${className}`.trim()}>
      <h2 id={`paid-actions-${plan.id}`} className="text-sm font-semibold">AI と Google の機能(押した時だけ・この旅行の枠から)</h2>
      <p className="mt-1 text-xs text-ink-700">
        会員のクラスと、この旅行の 50円の枠の中で使えます。結果は旅行に保存しません。使えない時は理由を出し、手で続けられます。
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-danger" data-testid="paid-actions-error">{error}</p>}

      <form className="mt-3" aria-label="AI の案" onSubmit={(e) => {
        e.preventDefault();
        void run('ai', async (key) => setAi(await paidAiSuggest(plan.id, prompt.trim(), key)));
      }}>
        <label htmlFor={`paid-ai-${plan.id}`} className="block text-xs font-semibold">AI に案を聞く(条件を書く)</label>
        <textarea id={`paid-ai-${plan.id}`} value={prompt} maxLength={2000} rows={2} onChange={(e) => setPrompt(e.target.value)}
          className="mt-1 w-full rounded border border-cloud-200 p-2 text-sm" />
        <button type="submit" className="tc-focus-ring tc-mbtn tc-mbtn--sm mt-1" disabled={busy !== null || !prompt.trim()}>
          {busy === 'ai' ? '聞いています…' : 'AI に聞く'}
        </button>
        {ai && (
          <div className="mt-2 rounded border border-cloud-200 p-2" data-testid="paid-ai-result">
            <p className="text-xs font-semibold">AI の案(要確認・保存していません)</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{ai.result.text || '(案がありませんでした)'}</p>
            <p className="mt-1 text-xs text-ink-700">{ai.notice}</p>
          </div>
        )}
      </form>

      <form className="mt-3" aria-label="Google の場所の検索" onSubmit={(e) => {
        e.preventDefault();
        void run('places', async (key) => setPlaces(await paidPlacesSearch(plan.id, query.trim(), key)));
      }}>
        <label htmlFor={`paid-places-${plan.id}`} className="block text-xs font-semibold">Google で場所を探す</label>
        <input id={`paid-places-${plan.id}`} value={query} maxLength={120} onChange={(e) => setQuery(e.target.value)}
          className="mt-1 w-full rounded border border-cloud-200 p-2 text-sm" />
        <button type="submit" className="tc-focus-ring tc-mbtn tc-mbtn--sm mt-1" disabled={busy !== null || !query.trim()}>
          {busy === 'places' ? '探しています…' : '探す'}
        </button>
        {places && (
          <div className="mt-2" data-testid="paid-places-result">
            <ul className="space-y-1">
              {places.results.map((p) => (
                <li key={p.place_id}><b>{p.name}</b>{p.address ? ` · ${p.address}` : ''}</li>
              ))}
              {places.results.length === 0 && <li>見つかりませんでした</li>}
            </ul>
            <p className="mt-1 text-xs text-ink-700">{`提供: ${places.attribution} · ${places.notice}`}</p>
          </div>
        )}
      </form>

      <form className="mt-3" aria-label="Google の経路" onSubmit={(e) => {
        e.preventDefault();
        void run('route', async (key) => setRoute(await paidRoute(plan.id, fromId, toId, mode, key)));
      }}>
        <p className="text-xs font-semibold">Google で経路を調べる(この日の場所のある予定)</p>
        {located.length < 2 ? (
          <p className="mt-1 text-xs text-ink-700">場所(地図の位置)のある予定が2つ以上ある日に使えます</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-2">
            <label className="text-xs">出発
              <select value={fromId} onChange={(e) => setFromId(e.target.value)} className="ml-1 rounded border p-1">
                <option value="">選ぶ</option>
                {located.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
            </label>
            <label className="text-xs">到着
              <select value={toId} onChange={(e) => setToId(e.target.value)} className="ml-1 rounded border p-1">
                <option value="">選ぶ</option>
                {located.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
            </label>
            <label className="text-xs">手段
              <select value={mode} onChange={(e) => setMode(e.target.value as PaidRouteMode)} className="ml-1 rounded border p-1">
                {(Object.keys(MODE_LABEL) as PaidRouteMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </select>
            </label>
            <button type="submit" className="tc-focus-ring tc-mbtn tc-mbtn--sm"
              disabled={busy !== null || !fromId || !toId || fromId === toId}>
              {busy === 'route' ? '調べています…' : '調べる'}
            </button>
          </div>
        )}
        {route && (
          <p className="mt-2 text-sm" data-testid="paid-route-result">
            {route.result
              ? `${MODE_LABEL[route.mode as PaidRouteMode] ?? route.mode}: 約 ${route.result.duration_minutes ?? '—'} 分 · ${route.result.distance_km ?? '—'} km`
              : '経路が見つかりませんでした'}
            <span className="block text-xs text-ink-700">{`提供: ${route.attribution} · ${route.notice}`}</span>
          </p>
        )}
      </form>
    </section>
  );
};

export default PaidActionsPanel;
