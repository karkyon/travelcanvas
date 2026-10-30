/**
 * ダッシュボード(SC-04 旅行一覧 / [Gate G9] UX-4 文脈型ダッシュボード)。
 *
 * 最上段で「次に何をすべきか」を示す(GET /dashboard の焦点の旅行):
 *   旅行が無い → 旅行を始める / 旅行前 → 準備・遅延と休業 / 旅行中 → 今と次・遅延と休業 / 旅行後 → 精算・記録
 * その下に段階ごとの旅行の一覧(表紙つき)と、スポット・地図への入口を置く。
 * 状態: 読み込み中・失敗(問い合わせ番号つき・再試行)・オフライン(つながったら読み直す)・旅行なし・閲覧のみ(操作を出さない)。
 * 見た目: デザインの決まり(tokens・Surface・旅行の表紙)だけを使い、明るい・暗い・端末に合わせるを選べる(この端末だけ)。
 *
 * [Gate M9-FE-B3] 表示中に未認証へ変わった場合もログイン画面へ移る(依存を正しく宣言する)。
 * 以前の統計(登録スポット・お気に入り・訪問済みの数)と擬似的な「最近の活動」は、旅行を主役にするため外した
 * (スポット・地図への入口は残す)。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MapPin, Search, Star, User as UserIcon, Map as MapIcon, RefreshCw } from 'lucide-react';
import Surface from '@/components/design/Surface';
import { useAuthStore } from '@/store/authStore';
import { getDashboard } from '@/services/api/g9';
import type { DashboardSummary } from '@/services/api/types/g9';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { useThemePreference, type ThemePreference } from '@/hooks/useThemePreference';
import PageHead from '@/components/shell/PageHead';
import { EmptyHero, FocusPanels, QuickActions, TripContinue, TripHero, TripList, TripStats } from './dashboard/DashboardParts';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: DashboardSummary }
  | { kind: 'offline' }
  | { kind: 'error'; message: string };

const OTHER_LINKS = [
  { to: '/spots/search', label: 'スポット検索', icon: Search },
  { to: '/spots/register', label: 'スポット登録', icon: MapPin },
  { to: '/spots', label: 'スポット一覧', icon: Star },
  { to: '/atlas', label: '旅の地図', icon: MapIcon },
  { to: '/profile', label: 'プロフィール', icon: UserIcon },
];

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, isGuest } = useAuthStore();
  const { preference, theme, setPreference } = useThemePreference();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

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
  const focusTrip = data?.focus ? data.trips.find((t) => t.id === data.focus?.plan_id) ?? null : null;
  const name = isGuest ? 'ゲスト' : (user?.username || 'ユーザー');

  return (
    <div data-theme={theme} className="min-h-[calc(100vh-4.5rem)] bg-cloud-50 text-ink-900" data-testid="dashboard">
      <div className="tc-page">
        {/* [Gate AppShell] モックのホーム: 見出し・旅の表紙・4つの数・旅のつづき/次に決めること/できること */}
        <PageHead
          eyebrow="YOUR JOURNEY · ホーム"
          title="次の旅を、楽しみに変える"
          sub={`${name}さん、次にすることをまとめました。日程も予約も旅の準備も、この旅のページから一緒に進められます。`}
          actions={(
            <nav aria-label="新しい旅を始める" className="tc-page-actions" data-testid="dashboard-start">
              <Link to="/planner?new=1" className="tc-focus-ring tc-mbtn">＋ 旅行をつくる<span className="sr-only">(行き先が決まっている)</span></Link>
              <Link to="/trip-consult" className="tc-focus-ring tc-mbtn tc-mbtn--primary">✦ 条件から旅行先を相談</Link>
              <label className="text-sm text-ink-700 flex items-center gap-2">
                表示
                <select value={preference} onChange={(e) => setPreference(e.target.value as ThemePreference)}
                  className="tc-focus-ring rounded-lg border border-cloud-200 bg-cloud-0 px-2 py-2 text-ink-900">
                  <option value="system">端末に合わせる</option>
                  <option value="light">明るい</option>
                  <option value="dark">暗い</option>
                </select>
              </label>
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
        {data && focusTrip && data.focus && (
          <>
            <TripHero trip={focusTrip} />
            <TripStats trip={focusTrip} focus={data.focus} />
            <div className="tc-dash-grid">
              <div className="tc-dash-col">
                <TripContinue trip={focusTrip} />
                <section className="tc-card tc-focus-list" aria-labelledby="dash-next">
                  <div className="tc-section-row">
                    <h2 id="dash-next" className="tc-section-title">次に決めること</h2>
                  </div>
                  <div className="mt-3"><FocusPanels focus={data.focus} trip={focusTrip} /></div>
                </section>
              </div>
              <div className="tc-dash-col">
                <QuickActions trip={focusTrip} />
              </div>
            </div>
          </>
        )}
        {data && data.trips.length > 0 && <TripList trips={data.trips} />}

        <section aria-labelledby="dash-other" className="mt-8">
          <h2 id="dash-other" className="text-lg font-semibold text-ink-900">スポット・地図</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {OTHER_LINKS.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <Link to={to} className="tc-focus-ring tc-mbtn tc-mbtn--sm">
                  <Icon size={16} aria-hidden="true" />{label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
};

export default DashboardPage;
