/**
 * [Gate HomeV2] 旅の記録と思い出(/memories)。左の帯の「旅の記録と思い出」から開く。
 *
 * 行った旅を新しい順に並べ、写真・メモの数と、旅の記録・振り返り・しおり(印刷・Web)へ移れるようにする。
 * 上に最近の旅の写真と旅の足あと(ホームと同じ部品・同じ値)。値は GET /dashboard の home から読む。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHead from '@/components/shell/PageHead';
import { getDashboard } from '@/services/api/g9';
import type { DashboardSummary } from '@/services/api/types/g9';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { Footprints, MemoriesSection } from './dashboard/HomeSections';
import { TripCard } from './dashboard/DashboardParts';

const MemoriesHomePage: React.FC = () => {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getDashboard());
    } catch (e) {
      setError(errorDetailMessage(e, '旅の記録を読み込めませんでした'));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const home = data?.home ?? null;
  const visited = (data?.trips ?? []).filter((t) => t.shelf === 'visited');
  return (
    <div className="tc-page" data-testid="memories-home">
      <PageHead eyebrow="MEMORIES · 旅の記録と思い出" title="旅の記録と思い出"
        sub="行った旅の写真・メモ・振り返りと、旅の足あと。しおりは印刷用と Web のページにできます。"
        actions={<Link to="/atlas" className="tc-focus-ring tc-mbtn">旅の地図を開く</Link>} />
      {error && (
        <p role="alert" className="tc-card p-4 text-sm text-danger">{error}
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm ml-2" onClick={() => void load()}>もう一度読み込む</button>
        </p>
      )}
      {!data && !error && <p role="status" className="tc-card p-4 text-sm text-ink-700">読み込み中…</p>}
      {home && (
        <div className="tc-home-two" style={{ marginTop: 0 }}>
          <MemoriesSection home={home} />
          <Footprints home={home} />
        </div>
      )}
      {data && (
        <section className="tc-card tc-home-shelf" aria-labelledby="memories-trips">
          <h2 id="memories-trips" className="tc-section-title">{`行った旅(${visited.length})`}</h2>
          {visited.length === 0 ? (
            <p className="mt-2 text-sm text-ink-700" data-testid="memories-empty">
              まだ行った旅はありません。旅行の最後の日を過ぎると、ここに移ります。旅行中は旅行を開いた画面の「記録」で写真とメモを残せます。
            </p>
          ) : (
            <ul className="tc-home-cards" aria-label="行った旅">
              {visited.map((t) => (
                <li key={t.id} className="tc-home-trip">
                  <Link to={`/planner/${t.id}/memories`} aria-label={`${t.title}の旅の記録を開く`}
                    className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                    <TripCard trip={t} />
                  </Link>
                  <div className="tc-home-trip-meta">
                    <span className="tc-home-mini">{`写真 ${t.photo_count ?? 0}`}</span>
                    <span className="tc-home-mini">{`メモ ${t.note_count ?? 0}`}</span>
                    <Link to={`/planner/${t.id}/journey`} className="tc-focus-ring tc-home-mini-btn">振り返る</Link>
                    <Link to={`/planner/${t.id}/booklet`} className="tc-focus-ring tc-home-mini-btn">しおり</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
};

export default MemoriesHomePage;
