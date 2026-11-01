/**
 * [Gate ConsultAI] 旅行相談で AI と Google を使う画面の部品(押した時だけ送る・結果は保存しない)。
 *
 * - AiReadPanel: 希望の入力の下。AI の利用の同意・会員のクラス・鍵の確認の状態・この相談の利用枠を示し、
 *   「AI で読み取る」を押した時だけ送る。使えない時は理由を出し、AI を使わない読み取りで続けられると書く
 * - SuggestedAreasPanel: 確認の画面。AI が挙げた方面の案(未確認)を、利用者が足した時だけ比較に入れる
 * - ConsultLookupPanel: 方面の詳細。「Google で場所を探す」「出発地からの経路を調べる」(明示の操作・出典と取得時刻つき)
 * - 試験用の模擬の提供元の時は、実の AI・Google ではないことを帯で示す
 */
import React, { useId, useState } from 'react';
import Button from '@/components/common/Button';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import {
  consultPlaces, consultRoute, newIdempotencyKey, type ConsultAiStatus, type ConsultPlace,
  type ConsultRouteMode, type ConsultRouteResult, type ConsultUsage,
} from '@/services/api/consultAi';
import { retrievedLabel } from './consultModel';
import { operationBlocker, usageLabel } from './consultAiModel';

export const StubBanner: React.FC<{ status: ConsultAiStatus | null }> = ({ status }) => (status?.stub ? (
  <p role="note" data-testid="consult-stub" className="rounded-lg border border-warning bg-warning-soft p-2 text-xs text-ink-900">
    試験用の模擬の提供元です(実の AI・Google へは送っていません。結果は試験用の決まった答えです)
  </p>
) : null);

// ------------------------------------------------------------------ 希望の入力: AI で読み取る

export const AiReadPanel: React.FC<{
  status: ConsultAiStatus | null; statusError: string | null; busy: boolean; consentBusy: boolean;
  usage: ConsultUsage | null; textLength: number;
  onConsent: (on: boolean) => void; onRead: () => void;
}> = ({ status, statusError, busy, consentBusy, usage, textLength, onConsent, onRead }) => {
  const id = useId();
  const blocker = operationBlocker(status, 'ai.generate', true);
  const tooLong = status ? textLength > status.max_text_chars : false;
  const canRead = !busy && !blocker && !tooLong && textLength > 0;
  return (
    <section aria-labelledby={`${id}-h`} data-testid="consult-ai-panel"
      className="rounded-xl border border-accent bg-accent-soft/40 p-3 text-sm text-ink-900">
      <h3 id={`${id}-h`} className="font-semibold">AI で読み取る(押した時だけ・未確認として示します)</h3>
      <p className="mt-1 text-xs text-ink-700">
        相談の文章を AI(OpenAI)へ送り、条件を整理します。結果は「AI の読み取り · 未確認」と示し、あなたが確かめた行だけを条件に使います。
        営業時間・料金・混み具合は AI に作らせません。文章と結果は保存しません。
      </p>
      <StubBanner status={status} />
      {statusError && <p role="alert" className="mt-2 text-xs text-danger">{statusError}</p>}
      {status && status.class !== 'guest' && (
        <label className="mt-2 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={status.consent.ai_processing} disabled={consentBusy}
            onChange={(e) => onConsent(e.target.checked)} data-testid="consult-ai-consent" />
          相談の文章を AI へ送ることに同意する(設定のプライバシーでいつでも撤回できます)
        </label>
      )}
      <dl className="mt-2 grid gap-1 text-xs text-ink-700 sm:grid-cols-2">
        <div><dt className="inline font-semibold text-ink-900">会員のクラス: </dt><dd className="inline">{status?.class_label ?? '…'}</dd></div>
        <div><dt className="inline font-semibold text-ink-900">AI の状態: </dt>
          <dd className="inline" data-testid="consult-ai-state">{blocker ?? (status ? `使えます(${status.model})` : '…')}</dd></div>
        {usageLabel(usage) && <div className="sm:col-span-2" data-testid="consult-ai-usage">{usageLabel(usage)}</div>}
      </dl>
      {tooLong && <p className="mt-1 text-xs text-warning">AI へ送る文章は {status?.max_text_chars} 文字までです</p>}
      <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-ink-700">使えない時も、下の「入力内容を整理する」(AI を使わない読み取り)で続けられます。</span>
        <Button type="button" onClick={onRead} loading={busy} disabled={!canRead} data-testid="consult-ai-extract">
          {busy ? 'AI が読み取っています…' : 'AI で読み取る →'}
        </Button>
      </div>
    </section>
  );
};

// ------------------------------------------------------------------ 確認: AI の方面の案

export const SuggestedAreasPanel: React.FC<{
  suggestions: Array<{ name: string; reason: string }>; unknowns: string[]; areaNames: string[];
  onToggle: (name: string, on: boolean) => void;
}> = ({ suggestions, unknowns, areaNames, onToggle }) => {
  const id = useId();
  if (suggestions.length === 0 && unknowns.length === 0) return null;
  return (
    <section aria-labelledby={`${id}-h`} data-testid="consult-ai-suggestions"
      className="mt-4 rounded-2xl border border-cloud-200 bg-surface p-4 text-sm">
      <h3 id={`${id}-h`} className="font-semibold text-ink-900">AI の方面の案(未確認)</h3>
      <p className="text-xs text-ink-700">
        足した方面だけを比べます。位置は比較の時に地名の照会で確かめます。距離・時間・料金は AI の値を使いません。
      </p>
      {suggestions.length > 0 && (
        <ul className="mt-2 space-y-2">
          {suggestions.map((s) => {
            const on = areaNames.includes(s.name);
            return (
              <li key={s.name} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cloud-200 p-2">
                <span className="min-w-0"><b>{s.name}</b><span className="block text-xs text-ink-700">{s.reason}</span></span>
                <button type="button" aria-pressed={on} onClick={() => onToggle(s.name, !on)}
                  className="tc-focus-ring min-h-11 rounded-lg border border-cloud-200 px-3 text-xs" data-testid={`consult-suggest-${s.name}`}>
                  {on ? '比較から外す' : '比較に足す'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {unknowns.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-ink-900">まだ決まっていないこと(AI の指摘)</p>
          <ul className="list-disc pl-5 text-xs text-ink-700">{unknowns.map((u) => <li key={u}>{u}</li>)}</ul>
        </div>
      )}
    </section>
  );
};

// ------------------------------------------------------------------ 方面の詳細: Google で調べる

const MODE_LABEL: Record<ConsultRouteMode, string> = { driving: '車', walking: '徒歩', bicycling: '自転車', transit: '公共交通' };
type Point = { latitude: number; longitude: number };

export const ConsultLookupPanel: React.FC<{
  status: ConsultAiStatus | null; ensureSession: () => Promise<string>; areaName: string; originLabel: string;
  origin: Point | null; area: Point | null; urls: string[]; onUrls: (urls: string[]) => void;
  onUsage: (u: ConsultUsage) => void; initialMode: ConsultRouteMode;
}> = ({ status, ensureSession, areaName, originLabel, origin, area, urls, onUrls, onUsage, initialMode }) => {
  const id = useId();
  const [query, setQuery] = useState(`${areaName} 観光`);
  const [mode, setMode] = useState<ConsultRouteMode>(initialMode);
  const [busy, setBusy] = useState<'places' | 'route' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [places, setPlaces] = useState<{ results: ConsultPlace[]; at: string; attribution: string } | null>(null);
  const [route, setRoute] = useState<ConsultRouteResult | null>(null);
  const placesBlocker = operationBlocker(status, 'places.search');
  const routeBlocker = operationBlocker(status, 'routes.element') ?? (!origin ? '出発地の位置が照会できていません'
    : !area ? 'この方面の位置が照会できていません' : null);

  const run = async (kind: 'places' | 'route', fn: (sid: string, key: string) => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      await fn(await ensureSession(), newIdempotencyKey());
    } catch (e) {
      setError(`${errorDetailMessage(e, '送れませんでした')}。手で候補を足して続けられます`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby={`${id}-h`} data-testid="consult-lookup"
      className="mt-4 rounded-2xl border border-cloud-200 bg-surface p-4 text-sm text-ink-900">
      <h3 id={`${id}-h`} className="font-semibold">Google で調べる(押した時だけ・この相談の利用枠から)</h3>
      <p className="text-xs text-ink-700">結果は保存しません。場所は「参考の出典に足す」で下書きの候補(未確認)にできます。</p>
      <StubBanner status={status} />
      {error && <p role="alert" className="mt-2 text-sm text-danger" data-testid="consult-lookup-error">{error}</p>}

      <form className="mt-3" aria-label="Google で場所を探す" onSubmit={(e) => {
        e.preventDefault();
        void run('places', async (sid, key) => {
          const r = await consultPlaces(sid, query.trim(), area, key);
          setPlaces({ results: r.results, at: r.retrieved_at, attribution: r.attribution });
          onUsage(r.usage);
        });
      }}>
        <label htmlFor={`${id}-q`} className="block text-xs font-semibold">Google で場所を探す({areaName} の近く)</label>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input id={`${id}-q`} value={query} maxLength={120} onChange={(e) => setQuery(e.target.value)}
            className="tc-focus-ring min-h-11 w-full rounded-lg border border-cloud-200 bg-cloud-0 px-3" />
          <Button type="submit" loading={busy === 'places'} disabled={busy !== null || !query.trim() || Boolean(placesBlocker)}
            data-testid="consult-places-search">
            {busy === 'places' ? '探しています…' : '探す'}
          </Button>
        </div>
        {placesBlocker && <p className="mt-1 text-xs text-ink-700">使えません: {placesBlocker}</p>}
        {places && (
          <div className="mt-2" data-testid="consult-places-result">
            <ul className="space-y-1">
              {places.results.map((p) => {
                const added = Boolean(p.maps_uri && urls.includes(p.maps_uri));
                return (
                  <li key={p.place_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cloud-200 p-2">
                    <span className="min-w-0"><b>{p.name}</b>{p.address ? <span className="block text-xs text-ink-700">{p.address}</span> : null}</span>
                    {p.maps_uri && (
                      <button type="button" disabled={added || urls.length >= 10} aria-pressed={added}
                        onClick={() => onUrls([...urls, p.maps_uri as string])}
                        className="tc-focus-ring min-h-11 rounded-lg border border-cloud-200 px-3 text-xs">
                        {added ? '出典に足しました' : '参考の出典に足す'}
                      </button>
                    )}
                  </li>
                );
              })}
              {places.results.length === 0 && <li>見つかりませんでした</li>}
            </ul>
            <p className="mt-1 text-xs text-ink-700">{`提供: ${places.attribution} · ${retrievedLabel(places.at)} · 営業時間・料金は未確認`}</p>
          </div>
        )}
      </form>

      <form className="mt-4" aria-label="Google で経路を調べる" onSubmit={(e) => {
        e.preventDefault();
        if (!origin || !area) return;
        void run('route', async (sid, key) => {
          const r = await consultRoute(sid, origin, area, mode, key);
          setRoute(r);
          onUsage(r.usage);
        });
      }}>
        <p className="text-xs font-semibold">{`Google で経路を調べる(${originLabel || '出発地'} → ${areaName})`}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <label className="text-xs">手段
            <select value={mode} onChange={(e) => setMode(e.target.value as ConsultRouteMode)}
              className="tc-focus-ring ml-1 min-h-11 rounded-lg border border-cloud-200 bg-cloud-0 px-2">
              {(Object.keys(MODE_LABEL) as ConsultRouteMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
            </select>
          </label>
          <Button type="submit" loading={busy === 'route'} disabled={busy !== null || Boolean(routeBlocker)}
            data-testid="consult-route">
            {busy === 'route' ? '調べています…' : '経路を調べる'}
          </Button>
        </div>
        {routeBlocker && <p className="mt-1 text-xs text-ink-700">使えません: {routeBlocker}</p>}
        {route && (
          <p className="mt-2" data-testid="consult-route-result">
            {route.result
              ? `${MODE_LABEL[route.mode as ConsultRouteMode] ?? route.mode}: 約 ${route.result.duration_minutes ?? '—'} 分 · ${route.result.distance_km ?? '—'} km`
              : '経路が見つかりませんでした'}
            <span className="block text-xs text-ink-700">{`提供: ${route.attribution} · ${retrievedLabel(route.retrieved_at)} · 出発の時刻・渋滞は考えていません`}</span>
          </p>
        )}
      </form>
    </section>
  );
};
