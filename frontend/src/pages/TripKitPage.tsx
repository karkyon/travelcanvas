/**
 * [Gate TripKit] 旅行箱の概要(TK-01)。旅行箱 UI/UX 改修 2026-11-15。
 *
 * 機能のリンク集ではなく「この旅行で今なにを確かめ・準備すべきか」を、実在する API の値だけで出す:
 * - 次に確認すること: 準備状況(readiness)の項目(重い順・期限つき)と、確認待ち・失敗の取込
 * - 旅行の情報: 予約・チケット / 準備・持ち物 / 予算・費用 / 文書 / 予約の取込 の件数と状態、各一覧へ
 * - 最近追加したもの: 予約と文書(追加日時・出典)
 * - すぐ使う操作: 予約を手入力・メール/画像から取り込む・文書を保管・支出を登録・旅行箱から探す
 * 件数・金額は固定の値を出さない。読み込み中・0 件・失敗・権限なし(見せない設定)を分けて出す。
 * 準備の点数は使わない(期限切れや重い問題を 1 つの数字で隠さない)。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ChevronRight, FileText, Inbox, ListChecks, Plus, Search, Ticket, Wallet } from 'lucide-react';
import PageHead from '@/components/shell/PageHead';
import TripKitNav from '@/components/shell/TripKitNav';
import { getDocuments, getFinanceSummary, getImportJobs, getReadiness, getReservations } from '@/services/api';
import type { FinanceSummary, ImportJob, Readiness, Reservation, TravelDocument } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { safeInternalPath } from '@/utils/safeNavigation';
import { attentionReasons } from './reservations/reservationListModel';

type Load<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'denied' } | { state: 'error'; message: string };

function statusOf(e: unknown): number {
  return (e as { response?: { status?: number } } | null)?.response?.status ?? 0;
}

function useLoad<T>(fn: () => Promise<T>, deps: unknown[], what: string): [Load<T>, () => void] {
  const [v, setV] = useState<Load<T>>({ state: 'loading' });
  const run = useCallback(() => {
    let alive = true;
    setV({ state: 'loading' });
    fn().then((data) => { if (alive) setV({ state: 'ok', data }); }).catch((e) => {
      if (!alive) return;
      const s = statusOf(e);
      setV(s === 403 || s === 404 ? { state: 'denied' } : { state: 'error', message: errorDetailMessage(e, `${what}を読めませんでした`) });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 呼び出し側の依存で読み直す
  }, deps);
  useEffect(() => run(), [run]);
  return [v, run];
}

const REVIEW = new Set(['review_required']);
const FAILED = new Set(['failed', 'quarantined']);
const WORKING = new Set(['uploaded', 'scanning', 'extracting', 'retry_wait']);
const SEV_WORD: Record<string, string> = { high: '重要', medium: '確認', low: 'メモ' };
const SEV_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function money(v: string | null | undefined, cur: string): string {
  if (v == null) return '—';
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toLocaleString('ja-JP')} ${cur}` : `${v} ${cur}`;
}

const SectionState: React.FC<{ load: Load<unknown>; retry: () => void; label: string }> = ({ load, retry, label }) => {
  if (load.state === 'loading') return <p className="tc-kit-state" aria-busy="true">{`${label}を読み込み中…`}</p>;
  if (load.state === 'denied') return <p className="tc-kit-state">{`${label}は、この旅行での役割では見られません`}</p>;
  if (load.state === 'error') {
    return (
      <p className="tc-kit-state tc-kit-state--err" role="alert">{load.message}
        <button type="button" className="tc-focus-ring tc-mini-link" onClick={retry}>もう一度読む</button></p>
    );
  }
  return null;
};

const TripKitPage: React.FC = () => {
  const { planId = '' } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [res, reloadRes] = useLoad<Reservation[]>(() => getReservations(planId), [planId], '予約');
  const [ready, reloadReady] = useLoad<Readiness>(() => getReadiness(planId), [planId], '準備状況');
  const [fin, reloadFin] = useLoad<FinanceSummary>(() => getFinanceSummary(planId), [planId], '費用');
  const [docs, reloadDocs] = useLoad<TravelDocument[]>(() => getDocuments(planId), [planId], '文書');
  const [jobs, reloadJobs] = useLoad<ImportJob[]>(() => getImportJobs(planId), [planId], '取込');
  const now = Date.now();

  // 次に確認すること(API の値だけ)
  type Todo = { key: string; sev: 'high' | 'medium' | 'low'; title: string; detail: string; due: string | null; to: string; tag: string };
  const todos: Todo[] = [];
  if (jobs.state === 'ok') {
    for (const j of jobs.data) {
      if (REVIEW.has(j.status)) todos.push({ key: `j${j.id}`, sev: 'high', title: '読み取った予約の内容を確認', detail: `取込 ${shortDate(j.created_at)} ・ 確認するまで予約には入りません`, due: null, to: `/planner/${planId}/imports?st=review`, tag: '確認待ち' });
      else if (FAILED.has(j.status)) todos.push({ key: `j${j.id}`, sev: 'medium', title: '読み取れなかった取込があります', detail: j.error_message ?? '原本を見て手入力で登録できます', due: null, to: `/planner/${planId}/imports?st=failed`, tag: '失敗' });
    }
  }
  if (ready.state === 'ok') {
    for (const it of ready.data.items) {
      if (it.task?.status === 'done') continue;
      const to = it.category === 'packing' || it.category === 'unassigned' ? `/planner/${planId}/preparation` : it.category === 'budget' ? `/planner/${planId}/expenses`
        : it.entity_type === 'reservation' ? `/planner/${planId}/reservations?open=${encodeURIComponent(it.entity_id)}` : `/planner/${planId}/preparation`;
      todos.push({ key: it.key, sev: it.severity, title: it.title, detail: it.detail, due: it.due_at, to, tag: SEV_WORD[it.severity] ?? '' });
    }
  }
  todos.sort((a, b) => (SEV_ORDER[a.sev]! - SEV_ORDER[b.sev]!) || ((a.due ? Date.parse(a.due) : Infinity) - (b.due ? Date.parse(b.due) : Infinity)));

  const resList = res.state === 'ok' ? res.data : [];
  const resAttention = resList.filter((r) => attentionReasons(r, now).length > 0).length;
  const nextRes = resList.filter((r) => r.start_at && Date.parse(r.start_at) >= now && r.status !== 'cancelled')
    .sort((a, b) => Date.parse(a.start_at!) - Date.parse(b.start_at!))[0] ?? null;
  const jobList = jobs.state === 'ok' ? jobs.data : [];
  const docList = docs.state === 'ok' ? docs.data : [];
  const recent = [
    ...resList.map((r) => ({ key: `r${r.id}`, at: r.created_at, title: r.provider_name || '予約', sub: '予約・チケット', to: `/planner/${planId}/reservations?open=${encodeURIComponent(r.id)}` })),
    ...docList.map((d) => ({ key: `d${d.id}`, at: d.created_at, title: d.original_filename ?? '文書', sub: `文書${d.document_type ? ` ・ ${d.document_type}` : ''}`, to: `/planner/${planId}/documents` })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);

  const areas: Array<{ key: string; icon: React.ReactNode; title: string; load: Load<unknown>; retry: () => void; line: string; to: string; warn?: boolean }> = [
    { key: 'res', icon: <Ticket size={18} aria-hidden="true" />, title: '予約・チケット', load: res, retry: reloadRes, to: `/planner/${planId}/reservations`,
      line: resList.length === 0 ? 'まだ予約がありません' : `${resList.length}件${resAttention ? ` ・ 要確認 ${resAttention}` : ''}${nextRes ? ` ・ 次は ${shortDate(nextRes.start_at)} ${nextRes.provider_name ?? ''}` : ''}`,
      warn: resAttention > 0 },
    { key: 'prep', icon: <ListChecks size={18} aria-hidden="true" />, title: '準備・持ち物', load: ready, retry: reloadReady, to: `/planner/${planId}/preparation`,
      line: ready.state === 'ok' ? `持ち物 ${ready.data.packing.packed} / ${ready.data.packing.total} ・ やること ${ready.data.tasks.open}件 ・ 確認 ${ready.data.counts.total}件` : '',
      warn: ready.state === 'ok' && (ready.data.counts.by_severity.high ?? 0) > 0 },
    { key: 'fin', icon: <Wallet size={18} aria-hidden="true" />, title: '予算・費用', load: fin, retry: reloadFin, to: `/planner/${planId}/expenses`,
      line: fin.state === 'ok' ? `予算 ${money(fin.data.total.budget, fin.data.base_currency)} ・ 予約の見込み ${money(fin.data.reserved.total, fin.data.base_currency)} ・ 支出 ${money(fin.data.total.actual, fin.data.base_currency)}${fin.data.is_settled ? '' : ' ・ 精算あり'}` : '',
      warn: fin.state === 'ok' && fin.data.total.over },
    { key: 'docs', icon: <FileText size={18} aria-hidden="true" />, title: '文書', load: docs, retry: reloadDocs, to: `/planner/${planId}/documents`,
      line: docList.length === 0 ? 'まだ文書がありません' : `${docList.length}件${docList.some((d) => d.ocr_status === 'failed') ? ' ・ 読み取り失敗あり' : ''}` },
    { key: 'imp', icon: <Inbox size={18} aria-hidden="true" />, title: '予約の取込', load: jobs, retry: reloadJobs, to: `/planner/${planId}/imports`,
      line: jobList.length === 0 ? 'まだ取込はありません'
        : `確認待ち ${jobList.filter((j) => REVIEW.has(j.status)).length} ・ 処理中 ${jobList.filter((j) => WORKING.has(j.status)).length} ・ 失敗 ${jobList.filter((j) => FAILED.has(j.status)).length}`,
      warn: jobList.some((j) => REVIEW.has(j.status) || FAILED.has(j.status)) },
  ];

  const allLoaded = [res, ready, jobs].every((l) => l.state !== 'loading');

  return (
    <div className="tc-page" data-testid="tripkit-home">
      <PageHead
        eyebrow="TRIP KIT · 旅行箱"
        title="旅行箱の概要"
        sub="予約・チケット・書類・持ち物・費用を、この旅行の中でまとめて確認します。"
        actions={(
          <>
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => navigate(`/planner/${planId}/kit/search`)}>
              <Search size={15} aria-hidden="true" />情報を探す
            </button>
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary" onClick={() => navigate(`/planner/${planId}/reservations?new=1`)}>
              <Plus size={15} aria-hidden="true" />予約を手入力
            </button>
          </>
        )}
      />
      <TripKitNav planId={planId} />

      <div className="tc-kit-home">
        <section className="tc-card tc-kit-card" aria-labelledby="kit-todo-title">
          <h2 id="kit-todo-title" className="tc-section-title">次に確認すること</h2>
          <p className="tc-kit-sub">重いもの・期限が近いものから。準備状況と取込の状態から出しています。</p>
          {!allLoaded ? <p className="tc-kit-state" aria-busy="true">確認することを集めています…</p>
            : todos.length === 0 ? (
              <p className="tc-kit-state">{ready.state === 'ok' || jobs.state === 'ok' ? '今、確認が必要なものはありません。' : '確認することを読めませんでした(下の各項目から開けます)。'}</p>
            ) : (
              <ul className="tc-kit-todo" aria-label="次に確認すること">
                {todos.slice(0, 8).map((t) => (
                  <li key={t.key}>
                    <Link to={safeInternalPath(t.to) ?? `/planner/${planId}/kit`} className="tc-focus-ring tc-kit-todo__item" data-sev={t.sev}>
                      <span className="tc-kit-todo__tag">{t.sev === 'high' && <AlertTriangle size={13} aria-hidden="true" />}{t.tag}</span>
                      <span className="tc-kit-todo__text"><b>{t.title}</b><small>{[t.detail, t.due ? `期限 ${shortDate(t.due)}` : null].filter(Boolean).join(' ・ ')}</small></span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          {todos.length > 8 && <Link to={`/planner/${planId}/preparation`} className="tc-mini-link">{`ほか ${todos.length - 8}件を準備状況で見る`}</Link>}
        </section>

        <section aria-labelledby="kit-areas-title">
          <h2 id="kit-areas-title" className="tc-section-title">旅行の情報</h2>
          <ul className="tc-kit-areas">
            {areas.map((a) => (
              <li key={a.key}>
                <div className="tc-card tc-kit-area" data-warn={a.warn ? 'true' : undefined}>
                  <Link to={safeInternalPath(a.to) ?? `/planner/${planId}/kit`} className="tc-focus-ring tc-kit-area__link">
                    <span className="tc-kit-area__icon">{a.icon}</span>
                    <span className="tc-kit-area__text"><b>{a.title}</b>
                      {a.load.state === 'ok' ? <small>{a.line}</small> : null}
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </Link>
                  <SectionState load={a.load} retry={a.retry} label={a.title} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="tc-card tc-kit-card" aria-labelledby="kit-quick-title">
          <h2 id="kit-quick-title" className="tc-section-title">すぐ使う</h2>
          <div className="tc-kit-quick">
            <Link to={`/planner/${planId}/reservations?new=1`} className="tc-focus-ring tc-mbtn">予約を手入力</Link>
            <Link to={`/planner/${planId}/imports`} className="tc-focus-ring tc-mbtn">メール・画像から取り込む</Link>
            <Link to={`/planner/${planId}/documents`} className="tc-focus-ring tc-mbtn">文書を保管</Link>
            <Link to={`/planner/${planId}/expenses?tab=expenses`} className="tc-focus-ring tc-mbtn">支出を登録</Link>
            <Link to={`/planner/${planId}/kit/search`} className="tc-focus-ring tc-mbtn">旅行箱から探す</Link>
          </div>
        </section>

        <section className="tc-card tc-kit-card" aria-labelledby="kit-recent-title">
          <h2 id="kit-recent-title" className="tc-section-title">最近追加したもの</h2>
          {res.state === 'loading' || docs.state === 'loading' ? <p className="tc-kit-state" aria-busy="true">読み込み中…</p>
            : recent.length === 0 ? <p className="tc-kit-state">まだ何も追加されていません。予約を登録するか、予約メールを取り込むとここに出ます。</p>
              : (
                <ul className="tc-kit-recent" aria-label="最近追加したもの">
                  {recent.map((x) => (
                    <li key={x.key}><Link to={safeInternalPath(x.to) ?? `/planner/${planId}/kit`} className="tc-focus-ring"><b>{x.title}</b><small>{`${x.sub} ・ ${shortDate(x.at)} に追加`}</small></Link></li>
                  ))}
                </ul>
              )}
        </section>
      </div>
    </div>
  );
};

export default TripKitPage;
