/**
 * [Gate TravelEstimate] 運用コンソールの「移動の見積もり」: 手段ごとの速さ・待ち・乗り換え・迂回の係数を調整する。
 *
 * - 保存は理由つき(監査に残る)。保存すると版が上がり、次に旅程を開いた時に区間の見積もりが計算し直される
 *   (利用者が手で入れた距離・時間は変えない)
 * - 保存の前に「試算」で、直線距離ごと・手段ごとの目安を確かめられる
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  getTravelEstimate, previewTravelEstimate, saveTravelEstimate,
  type TravelEstimateParams, type TravelEstimateSample, type TravelEstimateSettings,
} from '@/services/api/travelEstimate';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { durationLabel } from '@/utils/transportModes';

const MODE_NAME: Record<string, string> = {
  walking: '徒歩', bicycle: '自転車', driving: '自家用車', taxi: 'タクシー', bus: '路線バス', express_bus: '高速バス',
  train: '電車', shinkansen: '新幹線', flight: '飛行機', ferry: '船',
};

const clone = (p: TravelEstimateParams): TravelEstimateParams => JSON.parse(JSON.stringify(p)) as TravelEstimateParams;

function errorList(e: unknown): string[] {
  const detail = (e as { response?: { data?: { detail?: { errors?: unknown } } } })?.response?.data?.detail;
  return Array.isArray(detail?.errors) ? detail.errors.filter((x): x is string => typeof x === 'string') : [];
}

const AdminTravelEstimatePanel: React.FC = () => {
  const [data, setData] = useState<TravelEstimateSettings | null>(null);
  const [form, setForm] = useState<TravelEstimateParams>({});
  const [sample, setSample] = useState<TravelEstimateSample[] | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getTravelEstimate().then((d) => {
      if (!active) return;
      setData(d);
      setForm(clone(d.params));
      setSample(d.sample);
    }).catch((e) => { if (active) setError(errorDetailMessage(e, '移動の見積もりの条件を読めませんでした')); });
    return () => { active = false; };
  }, []);

  const groups = useMemo(() => {
    const out: Array<{ mode: string; label: string; fields: TravelEstimateSettings['schema'] }> = [];
    for (const f of data?.schema ?? []) {
      let g = out.find((x) => x.mode === f.mode);
      if (!g) { g = { mode: f.mode, label: f.mode_label, fields: [] }; out.push(g); }
      g.fields.push(f);
    }
    return out;
  }, [data]);

  const changed = useMemo(() => (data ? JSON.stringify(form) !== JSON.stringify(data.params) : false), [form, data]);
  const set = (mode: string, key: string, raw: string) => setForm((p) => {
    const next = clone(p);
    next[mode] = { ...(next[mode] ?? {}), [key]: raw === '' ? Number.NaN : Number(raw) };
    return next;
  });
  const resetDefaults = () => {
    if (!data) return;
    const next: TravelEstimateParams = {};
    for (const f of data.schema) next[f.mode] = { ...(next[f.mode] ?? {}), [f.key]: f.default };
    setForm(next);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null); setErrors([]); setNotice(null);
    try { await fn(); } catch (e) {
      setErrors(errorList(e));
      setError(errorDetailMessage(e, '処理できませんでした'));
    } finally { setBusy(false); }
  };

  if (!data) {
    return error ? <p role="alert" className="text-danger text-sm">{error}</p> : <p role="status">読み込み中…</p>;
  }

  return (
    <div className="tc-ops-grid" data-testid="travel-estimate-panel">
      <article className="tc-card p-4" aria-labelledby="te-h">
        <div className="tc-section-row"><div>
          <h2 id="te-h" className="tc-section-title">移動の見積もりの条件</h2>
          <p className="text-xs text-ink-700">{`版 ${data.revision}${data.updated_at ? ` · 最終の変更 ${data.updated_at}` : ' · 既定のまま'}`}</p>
        </div></div>
        <p className="text-sm text-ink-700 mb-3">{data.note}</p>
        {error && <p role="alert" className="text-danger text-sm mb-3">{error}</p>}
        {errors.length > 1 && <ul className="text-danger mb-3 list-disc pl-5 text-sm">{errors.map((x) => <li key={x}>{x}</li>)}</ul>}
        {notice && <p role="status" className="tc-ops-callout mb-3">{notice}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {groups.map((g) => (
            <fieldset key={g.mode} className="rounded-lg border border-cloud-200 p-3" data-testid={`te-group-${g.mode}`}>
              <legend className="px-1 text-sm font-semibold text-ink-900">{g.label}</legend>
              {g.fields.map((f) => {
                const id = `te-${f.mode}-${f.key}`;
                const v = form[f.mode]?.[f.key];
                return (
                  <div key={f.key} className="mt-2 grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-2">
                    <label htmlFor={id} className="text-sm text-ink-800">
                      {f.label}
                      <span className="block text-xs text-ink-700">{`${f.min}〜${f.max}${f.unit} · 既定 ${f.default}${v !== f.default ? ' · 変更あり' : ''}`}</span>
                    </label>
                    <div className="flex items-center gap-1">
                      <input id={id} type="number" inputMode="decimal" step="any" min={f.min} max={f.max}
                        className="w-full rounded-md border border-cloud-200 px-2 py-1 text-sm"
                        value={v === undefined || Number.isNaN(v) ? '' : v} onChange={(e) => set(f.mode, f.key, e.target.value)} />
                      <span className="text-xs text-ink-700" aria-hidden="true">{f.unit}</span>
                    </div>
                  </div>
                );
              })}
            </fieldset>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" disabled={busy} data-testid="te-preview"
            onClick={() => void run(async () => { setSample(await previewTravelEstimate(form)); setNotice('試算しました(まだ保存していません)'); })}>
            試算する
          </button>
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" disabled={busy} onClick={resetDefaults} data-testid="te-defaults">
            全て既定に戻す
          </button>
          <label className="ml-auto min-w-[16rem] text-sm text-ink-800">変更の理由(監査に残ります)
            <input className="mt-1 w-full rounded-md border border-cloud-200 px-2 py-1" maxLength={200} value={reason}
              onChange={(e) => setReason(e.target.value)} data-testid="te-reason" />
          </label>
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary tc-mbtn--sm" data-testid="te-save"
            disabled={busy || !changed || !reason.trim()}
            onClick={() => void run(async () => {
              const d = await saveTravelEstimate(form, reason.trim());
              setData(d); setForm(clone(d.params)); setSample(d.sample); setReason('');
              setNotice(`保存しました(版 ${d.revision})。次に旅程を開いた時に区間の見積もりが計算し直されます`);
            })}>
            保存する
          </button>
        </div>
      </article>

      {sample && (
        <article className="tc-card p-4" aria-labelledby="te-sample-h">
          <h2 id="te-sample-h" className="tc-section-title">試算(直線距離ごとの目安)</h2>
          <div className="overflow-x-auto">
            <table className="tc-ops-table" data-testid="te-sample">
              <thead><tr><th scope="col">手段</th>{data.sample_km.map((km) => <th key={km} scope="col">{`直線 ${km}km`}</th>)}</tr></thead>
              <tbody>
                {Object.keys(MODE_NAME).map((mode) => (
                  <tr key={mode}>
                    <th scope="row">{MODE_NAME[mode]}</th>
                    {data.sample_km.map((km) => {
                      const hit = sample.find((s) => s.mode === mode && s.straight_km === km);
                      return (
                        <td key={km}>
                          {hit?.variants.map((v) => (
                            <span key={v.key} className="block" title={v.note}>{`${v.label} ${durationLabel(v.duration_minutes)}(${v.distance_km}km)`}</span>
                          )) ?? '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}
    </div>
  );
};

export default AdminTravelEstimatePanel;
