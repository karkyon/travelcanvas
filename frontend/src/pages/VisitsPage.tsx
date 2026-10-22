/**
 * VisitsPage - 訪問の地図(DOC-04 SC-39/40、FR-049 Visited Area Layer・FR-050 訪問判定・信頼度・FR-051 訪問訂正・
 * Privacy除外、DOC-15 CA-007〜009、DOC-14「v5.1 訪問判定」)。
 *
 * [Gate V2] backend/app/api/v1/visits.py の画面。
 * - 位置のある予定を、予定・通過・訪問・滞在・確認済み・非表示に分けて略図と一覧に重ねる(色だけでなく形と文字で区別)
 * - 「判定する」: サーバーに保存した軌跡と、この端末だけに置いた軌跡(座標は送らず数値だけ)から判定する
 * - 判定の信頼度・根拠を示し、低い時は確認を求める。自動では確定しない。予定・実績は変わらない
 * - 訂正: 行った(確定)/ 通過だった / 行っていない / 地図から隠す(Atlas にも出さない)/ 自動の判定に戻す
 * 判定はあなただけのもの(同じ旅行のほかの人には見えません)。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { assessVisits, correctVisit, getLocationTracks, getVisits, postDeviceVisitResults } from '@/services/api';
import type { DeviceVisitMetrics, VisitAction, VisitItem, VisitLayerState, VisitsOverview } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { loadLocalPoints } from '@/utils/trackRecorder';
import { deviceVisitMetrics } from '@/utils/visitMetrics';
import {
  ACTION_DONE, LAYER_LABEL, LAYER_ORDER, LAYER_SYMBOL, LEVEL_LABEL, SOURCE_LABEL, STATE_LABEL, actionsFor, pct, project,
  reasonText,
} from './visits/visitModel';

const MAP_W = 640;
const MAP_H = 360;

// 形・線で区別する(色だけに頼らない)。文字色は白地で WCAG AA のコントラストを満たす濃さにする
const MARK: Record<Exclude<VisitLayerState, 'HIDDEN'>, { fill: string; stroke: string; dash?: string; text: string }> = {
  VERIFIED: { fill: '#166534', stroke: '#14532d', text: '#ffffff' },
  STAYED: { fill: '#15803d', stroke: '#14532d', text: '#ffffff' },
  VISITED: { fill: '#4ade80', stroke: '#166534', text: '#052e16' },
  PASS_THROUGH: { fill: '#e0f2fe', stroke: '#0369a1', dash: '4 3', text: '#0c4a6e' },
  PLANNED: { fill: '#ffffff', stroke: '#4b5563', dash: '2 3', text: '#1f2937' },
};

const VisitsPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<VisitsOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Record<VisitLayerState, boolean>>({
    VERIFIED: true, STAYED: true, VISITED: true, PASS_THROUGH: true, PLANNED: true, HIDDEN: false,
  });
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      setData(await getVisits(planId));
    } catch (e) {
      setError(errorDetailMessage(e, '訪問の地図を取得できませんでした'));
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    load();
  }, [load]);

  const mapItems = useMemo(() => (data?.items ?? []).filter((i) => i.layer_state !== 'HIDDEN' && shown[i.layer_state]),
    [data, shown]);
  const listItems = useMemo(() => (data?.items ?? []).filter((i) => shown[i.layer_state]), [data, shown]);
  const positions = useMemo(() => project(mapItems, MAP_W, MAP_H), [mapItems]);

  if (!planId) return <div className="p-8 text-center text-gray-700">プランが選択されていません。</div>;

  const assess = async () => {
    if (!data) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // この端末だけに置いた軌跡: 予定の場所ごとの数値だけを計算して送る(座標は送らない)
      let deviceSent = 0;
      if (data.tracks.device > 0) {
        const list = await getLocationTracks(planId);
        const points = list.tracks.filter((t) => t.mode !== 'synced').flatMap((t) => loadLocalPoints(t.id));
        if (points.length) {
          const results: Array<{ event_id: string; metrics: DeviceVisitMetrics }> = data.items
            .map((i) => ({ event_id: i.event_id, metrics: deviceVisitMetrics(i, i.radius_m, points) }))
            .filter((r) => r.metrics.points_inside > 0);
          if (results.length) {
            await postDeviceVisitResults(planId, results);
            deviceSent = results.length;
          }
        }
      }
      const res = await assessVisits(planId);
      setData(res);
      const r = res.result;
      const parts = [`判定しました(新しい判定 ${r?.created ?? 0}件・変わった判定 ${r?.changed ?? 0}件)`];
      if (deviceSent) parts.push(`この端末の軌跡から ${deviceSent}件`);
      if (res.needs_confirmation) parts.push(`確認が必要な判定が ${res.needs_confirmation}件あります`);
      setMessage(parts.join('。'));
    } catch (e) {
      setError(errorDetailMessage(e, '判定できませんでした。時間をおいてもう一度お試しください'));
    } finally {
      setBusy(false);
    }
  };

  const correct = async (item: VisitItem, action: VisitAction) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await correctVisit(planId, item.event_id, action, item.assessment?.revision);
      setMessage(`${item.title}: ${ACTION_DONE[action]}`);
    } catch (e) {
      setError(errorDetailMessage(e, '直せませんでした。画面を読み込み直してください'));
    } finally {
      setBusy(false);
      await load();
    }
  };

  const toggle = (s: VisitLayerState) => setShown((v) => ({ ...v, [s]: !v[s] }));

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">← プランへ戻る</Button>
      <h1 className="text-2xl font-bold text-gray-900">訪問の地図</h1>
      <p className="text-sm text-gray-700 mt-1">
        位置のある予定に、あなたの位置の記録から判定した「通過・訪問・滞在」を重ねます。自動の判定は確定しません。
        予定そのものや振り返りの記録は変わりません。判定はあなただけのもので、同じ旅行のほかの人には見えません。
      </p>
      {error && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
      {message && <div className="mt-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{message}</div>}

      {isLoading ? (
        <div className="py-12 flex justify-center"><LoadingSpinner /></div>
      ) : data && (
        <>
          <Card className="mt-4 p-4">
            <section aria-label="訪問の判定">
              <h2 className="text-lg font-semibold text-gray-900">判定する</h2>
              <p className="text-sm text-gray-700 mt-1">
                {data.tracks.synced + data.tracks.device === 0
                  ? 'この旅行の位置の記録がありません。写真・予約・振り返りの「行った」だけから判定します。'
                  : `位置の記録: サーバーに保存 ${data.tracks.synced}件・この端末だけ ${data.tracks.device}件(端末の軌跡は座標を送らず、距離や時間だけを送ります)`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 items-center">
                <Button onClick={assess} disabled={busy}>判定する</Button>
                <Link className="text-sm text-indigo-800 underline" to={`/planner/${planId}/track`}>位置の記録・保護エリア</Link>
                <Link className="text-sm text-indigo-800 underline" to="/atlas">Atlas(旅行を横断した訪問地域)</Link>
              </div>
              <details className="mt-3 text-sm text-gray-800">
                <summary className="cursor-pointer">判定の規則({data.rules.algorithm_version})</summary>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>精度が{data.rules.max_accuracy_m}mより悪い位置は使いません</li>
                  <li>予定の場所の半径は種類ごとに50〜300m(この旅行の予定は一覧に表示)</li>
                  <li>訪問: 半径の中の位置が{data.rules.visit_min_points}件以上、{data.rules.visit_min_seconds / 60}分以上。
                    滞在: {data.rules.stay_min_seconds / 60}分以上</li>
                  <li>通過: 時速{data.rules.pass_speed_kmh}kmより速い、または{data.rules.visit_min_seconds / 60}分未満</li>
                  <li>信頼度: 距離35%・滞在25%・精度15%・証拠(写真・予約・手動の記録)25%。
                    {pct(data.rules.high)}以上は「高」、{pct(data.rules.review)}以上は「要確認」、それ未満は「候補」</li>
                  <li>「確認済みの訪問」は、あなたが確定した時か、強い証拠が2種類以上ある時だけです</li>
                </ul>
              </details>
            </section>
          </Card>

          <Card className="mt-4 p-4">
            <section aria-label="地図の凡例と表示する状態">
              <h2 className="text-lg font-semibold text-gray-900">表示する状態</h2>
              <ul className="mt-2 flex flex-wrap gap-3">
                {LAYER_ORDER.map((s) => (
                  <li key={s}>
                    <label className="inline-flex items-center gap-1 text-sm text-gray-900">
                      <input type="checkbox" checked={shown[s]} onChange={() => toggle(s)} />
                      <span aria-hidden="true">{LAYER_SYMBOL[s]}</span>
                      {LAYER_LABEL[s]}({data.counts[s]}件)
                    </label>
                  </li>
                ))}
              </ul>
              {data.events_without_location > 0 && (
                <p className="text-sm text-gray-700 mt-2">場所の無い予定 {data.events_without_location}件は判定できません。</p>
              )}
              {data.needs_confirmation > 0 && (
                <p className="text-sm text-amber-900 mt-2">確認が必要な判定が {data.needs_confirmation}件あります(一覧の「確認してください」)。</p>
              )}
            </section>
          </Card>

          {data.items.length === 0 ? (
            <p className="mt-6 text-gray-700">位置のある予定がありません。予定に場所を登録すると判定できます。</p>
          ) : (
            <>
              <Card className="mt-4 p-2">
                <svg
                  viewBox={`0 0 ${MAP_W} ${MAP_H}`}
                  className="w-full h-auto bg-slate-50 rounded-sm"
                  role="img"
                  aria-label={`訪問の地図(略図)。表示中 ${mapItems.length}件。内容は下の一覧と同じです`}
                >
                  {mapItems.map((it) => {
                    const pos = positions.get(it.event_id);
                    if (!pos || it.layer_state === 'HIDDEN') return null;
                    const m = MARK[it.layer_state];
                    const isSel = selected === it.event_id;
                    return (
                      <g key={it.event_id} data-layer-state={it.layer_state}>
                        <title>{`${it.title}: ${LAYER_LABEL[it.layer_state]}`}</title>
                        <circle cx={pos.x} cy={pos.y} r={pos.r} fill={m.fill} fillOpacity={0.15} stroke={m.stroke}
                          strokeOpacity={0.4} strokeDasharray={m.dash} />
                        {it.layer_state === 'STAYED' ? (
                          <rect x={pos.x - 9} y={pos.y - 9} width={18} height={18} transform={`rotate(45 ${pos.x} ${pos.y})`}
                            fill={m.fill} stroke={m.stroke} strokeWidth={isSel ? 3 : 1.5} />
                        ) : (
                          <circle cx={pos.x} cy={pos.y} r={10} fill={m.fill} stroke={m.stroke} strokeWidth={isSel ? 3 : 1.5}
                            strokeDasharray={m.dash} />
                        )}
                        <text x={pos.x} y={pos.y + 4} textAnchor="middle" fontSize={11} fill={m.text}>
                          {it.layer_state === 'VERIFIED' ? '✓' : ''}
                        </text>
                        <text x={pos.x + 14} y={pos.y + 4} fontSize={12} fill="#111827">{it.title}</text>
                      </g>
                    );
                  })}
                </svg>
              </Card>

              <section aria-label="訪問の一覧" className="mt-4 space-y-3">
                <h2 className="text-lg font-semibold text-gray-900">一覧</h2>
                {listItems.map((it) => {
                  const a = it.assessment;
                  const headingId = `visit-${it.event_id}`;
                  return (
                    <Card key={it.event_id} className="p-4">
                      <article aria-labelledby={headingId} onFocus={() => setSelected(it.event_id)}
                        onMouseEnter={() => setSelected(it.event_id)}>
                        <div className="flex flex-wrap items-baseline gap-2">
                          <h3 id={headingId} className="font-semibold text-gray-900">{it.title}</h3>
                          <span className="text-sm text-gray-700">{it.date}{it.planned_time ? ` ${it.planned_time}` : ''}</span>
                          <span className="text-sm font-medium text-gray-900" data-testid="layer-state">
                            <span aria-hidden="true">{LAYER_SYMBOL[it.layer_state]} </span>{LAYER_LABEL[it.layer_state]}
                          </span>
                          {a?.needs_confirmation && !a.hidden && (
                            <span className="text-xs px-2 py-0.5 rounded-sm bg-amber-100 text-amber-900">確認してください</span>
                          )}
                        </div>
                        {a ? (
                          <dl className="mt-2 text-sm text-gray-800 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                            <dt className="text-gray-700">判定</dt>
                            <dd>{STATE_LABEL[a.state]}{a.hidden ? '(地図と Atlas から隠しています)' : ''}</dd>
                            <dt className="text-gray-700">信頼度</dt>
                            <dd>{a.confidence === null ? '—' : `${pct(a.confidence)}(${a.level ? LEVEL_LABEL[a.level] : '—'})`}</dd>
                            <dt className="text-gray-700">根拠</dt>
                            <dd>{reasonText(a, it.radius_m)}</dd>
                            <dt className="text-gray-700">出どころ</dt>
                            <dd>{SOURCE_LABEL[a.source]}</dd>
                          </dl>
                        ) : (
                          <p className="mt-2 text-sm text-gray-700">まだ判定していません(半径{it.radius_m}m)</p>
                        )}
                        {a?.differs_from_auto && a.auto_state && (
                          <p className="mt-1 text-sm text-gray-800">自動の判定は「{STATE_LABEL[a.auto_state]}」です(あなたの判定を優先しています)</p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {actionsFor(it).map((b) => (
                            <Button key={b.action} size="sm" variant={b.action === 'confirm' ? 'primary' : 'outline'} disabled={busy}
                              onClick={() => correct(it, b.action)} aria-label={`${it.title}: ${b.label}`}>
                              {b.label}
                            </Button>
                          ))}
                        </div>
                      </article>
                    </Card>
                  );
                })}
                {listItems.length === 0 && <p className="text-gray-700">表示する状態に当てはまる予定がありません。</p>}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default VisitsPage;
