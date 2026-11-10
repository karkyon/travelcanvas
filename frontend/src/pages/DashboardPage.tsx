/**
 * ダッシュボード(SC-04 旅行一覧 / [Gate G9] UX-4 文脈型ダッシュボード)。
 *
 * 最上段で「次に何をすべきか」を示す(GET /dashboard の焦点の旅行):
 *   旅行が無い → 旅行を始める / 旅行前 → 準備・遅延と休業 / 旅行中 → 今と次・遅延と休業 / 旅行後 → 精算・記録
 * その下に段階ごとの旅行の一覧(表紙つき)と、スポット・地図への入口を置く。
 * 状態: 読み込み中・失敗(問い合わせ番号つき・再試行)・オフライン(つながったら読み直す)・旅行なし・閲覧のみ(操作を出さない)。
 * 見た目: デザインの決まり(tokens・Surface・旅行の表紙)だけを使う。明るい・暗い・端末に合わせるは上の帯の印で選ぶ([Gate HeaderPicker])。
 *
 * [Gate M9-FE-B3] 表示中に未認証へ変わった場合もログイン画面へ移る(依存を正しく宣言する)。
 * 以前の統計(登録スポット・お気に入り・訪問済みの数)と擬似的な「最近の活動」は、旅行を主役にするため外した
 * (スポット・地図への入口は残す)。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Surface from '@/components/design/Surface';
import { useAuthStore } from '@/store/authStore';
import { getDashboard } from '@/services/api/g9';
import type { DashboardSummary } from '@/services/api/types/g9';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { useThemePreference } from '@/hooks/useThemePreference';
import PageHead from '@/components/shell/PageHead';
import { EmptyHero, FocusPanels, QuickActions, TripHero, TripList } from './dashboard/DashboardParts';
import { Footprints, MemoriesSection, NextTasks, PlanningHero, Tools, TripShelves, TripSwitcher, Wishlist } from './dashboard/HomeSections';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: DashboardSummary }
  | { kind: 'offline' }
  | { kind: 'error'; message: string };


const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, isGuest } = useAuthStore();
  const { theme } = useThemePreference();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [chosenId, setChosenId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) navigate('/login');
  }, [isAuthenticated, navigate]);

  const load = useCallback(async () => {
    setState((s) => (s.kind === 'ready' ? s : { kind: 'loading' }));
    try {
      setState({ kind: 'ready', data: await getDashboard() });
    } catch (e) {
      if (isOffline()) setState({ kind: 'offline' });
      else setState({ kind: 'error', message: errorDetailMessage(e, 'ダッシュボードを読み込めませんでした') });
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    void load();
    const online = () => { void load(); };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [isAuthenticated, load]);

  if (!isAuthenticated) return null;

  const data = state.kind === 'ready' ? state.data : null;
  const home = data?.home ?? null;
  // [Gate HomeV2] 主役の旅行: 選んだ計画中の旅行 → 自動で選ばれた旅行(旅行中 → 出発が近い → 最近終わった)
  const planningTrips = data ? data.trips.filter((t) => t.shelf === 'planning') : [];
  const chosen = chosenId ? planningTrips.find((t) => t.id === chosenId) ?? null : null;
  const autoTrip = data?.focus ? data.trips.find((t) => t.id === data.focus?.plan_id) ?? null : null;
  const focusTrip = chosen ?? autoTrip;
  const focusIsAuto = Boolean(focusTrip && data?.focus && focusTrip.id === data.focus.plan_id);
  const progress = home && focusTrip ? home.planning.find((p) => p.plan_id === focusTrip.id) ?? null : null;
  const name = isGuest ? 'ゲスト' : (user?.username || 'ユーザー');
  const nextTrip = planningTrips.find((t) => t.days_until_start !== null) ?? null;
  // [Gate HomeTitle] 「おかえりなさい」は日本のアプリでは不自然なので使わない。旅までの日数をそのまま見出しにする
  const title = nextTrip?.days_until_start ? `次の旅まで あと ${nextTrip.days_until_start} 日`
    : planningTrips.some((t) => t.phase === 'ongoing') ? 'いま旅行中です。今日の予定を確かめましょう' : '次の旅を、楽しみに変える';
  // 挨拶の文は読み込みの前後で変えない(読み込んだ後は旅行の数を後ろに足す)
  const sub = `${name}さんの旅の準備と、次にすること。` + (home
    ? `計画中 ${home.shelves.planning} · 検討中 ${home.shelves.considering} · 行った旅 ${home.shelves.visited} · 見送り ${home.shelves.cancelled}`
    : '日程も予約も旅の準備も、この旅のページから一緒に進められます。');

  return (
    <div data-theme={theme} className="min-h-[calc(100vh-4.5rem)] bg-cloud-50 text-ink-900" data-testid="dashboard">
      <div className="tc-page">
        {/* [Gate AppShell] モックのホーム: 見出し・旅の表紙・4つの数・旅のつづき/次に決めること/できること */}
        <PageHead
          eyebrow="YOUR JOURNEY · ホーム"
          title={title}
          sub={sub}
          actions={(
            <nav aria-label="新しい旅を始める" className="tc-page-actions" data-testid="dashboard-start">
              <Link to="/planner?new=1" className="tc-focus-ring tc-mbtn">＋ 旅行をつくる<span className="sr-only">(行き先が決まっている)</span></Link>
              <Link to="/trip-consult" className="tc-focus-ring tc-mbtn tc-mbtn--primary">✦ 条件から旅行先を相談</Link>
            </nav>
          )}
        />

        {state.kind === 'loading' && (
          <Surface variant="quiet" role="status" aria-live="polite" className="min-h-[16rem]" data-testid="dashboard-loading">
            <p className="text-sm text-ink-700">読み込み中…</p>
          </Surface>
        )}
        {state.kind === 'offline' && (
          <Surface variant="quiet" role="status" data-testid="dashboard-offline">
            <p className="font-semibold text-ink-900">オフラインです</p>
            <p className="text-sm text-ink-700 mt-1">
              つながると自動で読み直します。端末に保存した旅行(オフラインの旅行パック)は、旅程の画面から開けます。
            </p>
            <Link to="/planner" className="tc-focus-ring mt-2 inline-block text-sm font-medium text-accent underline">旅程の一覧を開く</Link>
          </Surface>
        )}
        {state.kind === 'error' && (
          <Surface variant="critical" role="alert" data-testid="dashboard-error">
            <p className="font-semibold">{state.message}</p>
            <button type="button" onClick={() => void load()}
              className="tc-focus-ring mt-2 inline-flex items-center gap-1 rounded-lg border border-cloud-200 bg-cloud-0 px-3 py-1.5 text-sm font-medium text-ink-900">
              <RefreshCw size={14} aria-hidden="true" />もう一度読み込む
            </button>
          </Surface>
        )}

        {data && !focusTrip && <EmptyHero isGuest={data.is_guest} />}
        {data && focusTrip && (
          // [Gate HomeV2] 1. いま計画中: 主役の旅行(表紙・旅の準備・操作)と、次にやること(計画中の旅行ぜんぶ)
          <div className="tc-home-planning">
            <div className="tc-dash-col">
              {home ? <PlanningHero trip={focusTrip} detail={progress} /> : <TripHero trip={focusTrip} />}
              {/* [Gate HomeSwitch] 主役の旅行の切り替えは、大きな表紙のすぐ下に(次にやることの下から移した) */}
              <TripSwitcher planning={planningTrips} selected={focusTrip.id} onSelect={setChosenId} />
              {focusIsAuto && data.focus && (data.focus.phase === 'ongoing' || data.focus.phase === 'past'
                || (data.focus.alerts?.active ?? 0) > 0 || !home) && (
                <FocusPanels focus={data.focus} trip={focusTrip} />
              )}
            </div>
            <div className="tc-dash-col">
              {home ? (
                <NextTasks tasks={home.tasks} />
              ) : <QuickActions trip={focusTrip} />}
            </div>
          </div>
        )}
        {data && !home && data.trips.length > 0 && <TripList trips={data.trips} />}
        {data && home && data.trips.length > 0 && (
          // 2. 旅行の一覧(状態のタブ)
          <TripShelves trips={data.trips} counts={home.shelves} onChanged={() => void load()} />
        )}
        {data && home && (
          <>
            {/* 3. 旅の記録と思い出([Gate MemoryReel] 写真が流れる思い出リール。横いっぱい) */}
            <MemoriesSection home={home} />
            {/* 4. 旅の足あと・行ってみたい場所 / 道具 */}
            <div className="tc-home-two">
              <Footprints home={home} />
              <Wishlist home={home} />
            </div>
            <Tools tripId={focusTrip?.id ?? null} />
          </>
        )}
      </div>
    </div>
  );
};

export default DashboardPage;
