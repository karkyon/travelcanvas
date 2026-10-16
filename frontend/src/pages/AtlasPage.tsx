/**
 * AtlasPage - Personal Travel Atlas(DOC-04 SC-41、FR-052)。
 *
 * [Gate P15] backend/app/api/v1/atlas.py の画面。
 * - 参加している旅行を横断して、訪れた地域を区画(約11km/約110km)で表示する。状態は滞在・訪問・通過・予定を区別する
 * - 地図の代わりの一覧(区画ごとの状態・旅行・最初と最後の日)を必ず併記する(DOC-04 SC-41 地図代替一覧)
 * - 年で絞り込み、旅行ごとにAtlasへ含めるかを選べる。Atlasはあなただけが見られる
 * - 国・都道府県などの地名は、座標から地名を調べる仕組みが未接続のため表示しない
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { getAtlas, updateAtlasSettings } from '@/services/api';
import type { AtlasPrecision, AtlasResponse, AtlasState } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { STATE_INFO, cellLabel, layout, percent } from './atlas/atlasModel';

const STATES: AtlasState[] = ['STAYED', 'VISITED', 'PASS_THROUGH', 'PLANNED'];

const showDate = (iso: string | null): string => (iso ? iso.slice(0, 10) : '—');

const AtlasPage: React.FC = () => {
  const [data, setData] = useState<AtlasResponse | null>(null);
  const [precision, setPrecision] = useState<AtlasPrecision>('region');
  const [year, setYear] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getAtlas(precision, year));
    } catch (e) {
      setError(errorDetailMessage(e, 'Atlasの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [precision, year]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleExclude = async (planId: string, include: boolean) => {
    if (!data) return;
    const excluded = data.plans.filter((p) => p.excluded).map((p) => p.plan_id);
    const next = include ? excluded.filter((id) => id !== planId) : [...excluded, planId];
    const before = data;
    // 押した直後にチェックを切り替える(保存に失敗したら元に戻す)
    setData({ ...data, plans: data.plans.map((p) => (p.plan_id === planId ? { ...p, excluded: !include } : p)) });
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await updateAtlasSettings(next);
      setMessage(include ? 'Atlasに含めました' : 'Atlasから除きました');
      await load();
    } catch (e) {
      setData(before);
      setError(errorDetailMessage(e, '設定を保存できませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const sketch = data ? layout(data.cells) : null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-gray-900">旅の地図(Atlas)</h1>
      <p className="text-sm text-gray-700 mt-1">
        参加している旅行を横断して、訪れた地域を区画で表します。材料は旅行の「行った」記録、あなたの位置付きの記録と位置の軌跡、
        これからの旅行の予定です。Atlasはあなただけが見られます。
      </p>
      {error && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
      {message && <div className="mt-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{message}</div>}

      <div className="mt-4 flex flex-wrap gap-4">
        <label className="text-sm text-gray-800">区画の大きさ
          <select className="block mt-1 border rounded px-2 py-1" value={precision} onChange={(e) => setPrecision(e.target.value as AtlasPrecision)}>
            <option value="region">約11km(0.1度)</option>
            <option value="area">約110km(1度)</option>
          </select>
        </label>
        <label className="text-sm text-gray-800">年
          <select className="block mt-1 border rounded px-2 py-1" value={year ?? ''} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}>
            <option value="">すべて</option>
            {(data?.years ?? []).map((y) => <option key={y} value={y}>{`${y}年`}</option>)}
          </select>
        </label>
      </div>

      {isLoading || !data || !sketch ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : (
        <>
          <Card padding="md" className="mt-4">
            <section aria-label="Atlasの概要" className="space-y-2">
              <p className="text-sm text-gray-900">
                {`区画${data.summary.cells}件(滞在${data.summary.by_state.STAYED}・訪問${data.summary.by_state.VISITED}・通過${data.summary.by_state.PASS_THROUGH}・予定${data.summary.by_state.PLANNED})・再訪率 ${percent(data.summary.revisit_rate)}`}
              </p>
              <ul className="flex flex-wrap gap-3 text-sm text-gray-800" aria-label="凡例">
                {STATES.map((s) => (
                  <li key={s} className="flex items-center gap-1">
                    <span aria-hidden="true" className="inline-block w-3 h-3 border border-gray-500" style={{ background: STATE_INFO[s].fill }} />
                    {`${STATE_INFO[s].mark} ${STATE_INFO[s].label}: ${STATE_INFO[s].description}`}
                  </li>
                ))}
              </ul>
              {data.cells.length > 0 && (
                <svg viewBox={`0 0 ${sketch.width} ${sketch.height}`} width="100%" style={{ maxWidth: 360 }} role="img"
                  aria-label={`訪れた地域の略図(区画${data.cells.length}件。内容は下の一覧と同じ)`} className="border border-gray-200 rounded bg-white">
                  {sketch.rects.map((r) => (
                    <rect key={r.key} x={r.x} y={r.y} width={Math.max(r.w, 2)} height={Math.max(r.h, 2)} fill={r.fill} stroke="#374151" strokeWidth="0.5">
                      <title>{r.title}</title>
                    </rect>
                  ))}
                </svg>
              )}
            </section>
          </Card>

          <section aria-label="区画の一覧" className="mt-6">
            <h2 className="font-semibold text-gray-900">区画の一覧</h2>
            {data.cells.length === 0 ? (
              <Card padding="lg" className="mt-2 text-center text-gray-700">
                まだ訪れた地域はありません。旅行の「振り返り」で行った予定を記録すると表示されます。
              </Card>
            ) : (
              <table className="w-full mt-2 text-sm">
                <caption className="sr-only">区画ごとの状態と旅行</caption>
                <thead>
                  <tr className="text-left text-gray-700">
                    <th scope="col" className="font-medium">状態</th>
                    <th scope="col" className="font-medium">区画</th>
                    <th scope="col" className="font-medium">旅行</th>
                    <th scope="col" className="font-medium">最初・最後</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cells.map((c) => (
                    <tr key={c.key} className="border-t border-gray-200">
                      <td className="py-1 text-gray-900">{`${STATE_INFO[c.state].mark} ${STATE_INFO[c.state].label}`}</td>
                      <td className="py-1 text-gray-900">{cellLabel(c)}</td>
                      <td className="py-1 text-gray-900">
                        {c.trips.map((t, i) => (
                          <React.Fragment key={t.plan_id}>
                            {i > 0 && '、'}
                            <Link className="text-blue-800 underline" to={`/planner/${t.plan_id}`}>{t.title}</Link>
                          </React.Fragment>
                        ))}
                      </td>
                      <td className="py-1 text-gray-800">{`${showDate(c.first_at)} / ${showDate(c.last_at)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section aria-label="Atlasに含める旅行" className="mt-6">
            <h2 className="font-semibold text-gray-900">Atlasに含める旅行</h2>
            {data.plans.length === 0 ? (
              <p className="text-sm text-gray-700 mt-2">参加している旅行がありません。</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {data.plans.map((p) => (
                  <li key={p.plan_id}>
                    <label className="flex items-center gap-2 text-sm text-gray-900">
                      <input type="checkbox" checked={!p.excluded} disabled={busy} onChange={(e) => toggleExclude(p.plan_id, e.target.checked)} />
                      {`${p.title}(材料${p.observations}件)`}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default AtlasPage;
