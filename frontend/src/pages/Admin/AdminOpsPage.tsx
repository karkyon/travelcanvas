/**
 * [Gate OpsCMS] 運用コンソール(管理者だけ)。利用者の指示「TravelCanvas API運用CMS」と CMS のモック(2026-10-30)の構成:
 * 概要 / API・契約と接続 / 原価・利用台帳 / Cloud 環境 / テスト実行(Fake の家族旅行) / 秘密情報・権限。監査はログの画面へ。
 *
 * - 値は全て backend の実データ。取れない値は「取得していない」「未確認」と書く(作った数を出さない)
 * - Fake の試験の額と、実の提供元の見込みの原価を同じ欄に混ぜない。GCP の予算は通知で、課金を止める上限ではないと書く
 * - 鍵の値は受け取らない・出さない(設定の有無だけ)。止める・戻す・試験は理由が要り、監査に残る
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHead from '@/components/shell/PageHead';
import {
  disableOpsSecret, getOpsCloud, getOpsLedger, getOpsOverview, getOpsProviders, getOpsSecrets, registerOpsSecret,
  runOpsFamilyFake, setOpsProviderSuspended,
  type OpsCloud, type OpsSecrets, type OpsSecretSlot, type OpsFamilyRun, type OpsLedger, type OpsOverview, type OpsProvider, type OpsProviders,
} from '@/services/api/opsConsole';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

type Tab = 'overview' | 'providers' | 'ledger' | 'cloud' | 'runs' | 'secrets';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: '概要' },
  { id: 'providers', label: 'API・契約と接続' },
  { id: 'ledger', label: '原価・利用台帳' },
  { id: 'cloud', label: 'Cloud 環境' },
  { id: 'runs', label: 'テスト実行' },
  { id: 'secrets', label: '秘密情報・権限' },
];

const yen = (v: string | null | undefined) => (v == null ? '—' : `¥${Number(v).toLocaleString('ja-JP', { maximumFractionDigits: 2 })}`);

const STATE_LABEL: Record<string, { text: string; tone: string }> = {
  ok: { text: '上限内', tone: 'tc-pill--good' },
  user_warning: { text: '利用者に警告(40円〜)', tone: 'tc-pill--warn' },
  ops_alert: { text: '運用に知らせ(45円〜)', tone: 'tc-pill--warn' },
  limit_reached: { text: '上限ちょうど', tone: 'tc-pill--bad' },
  over_cap: { text: '上限を越えた', tone: 'tc-pill--bad' },
  no_budget: { text: '枠なし', tone: '' },
};
const StatePill: React.FC<{ state: string }> = ({ state }) => {
  const s = STATE_LABEL[state] ?? { text: state, tone: '' };
  return <span className={`tc-pill ${s.tone}`}>{s.text}</span>;
};

const SECRET_LABEL: Record<string, { text: string; tone: string }> = {
  configured: { text: '設定あり(値は表示しない)', tone: 'tc-pill--good' },
  missing: { text: '未設定', tone: 'tc-pill--warn' },
  not_defined: { text: 'コードに設定の項目なし', tone: '' },
  not_needed: { text: '不要', tone: '' },
};
const LIVE_LABEL: Record<string, { text: string; tone: string }> = {
  test_only: { text: '試験用(外へ送らない)', tone: 'tc-pill--blue' },
  ready: { text: '送信できる', tone: 'tc-pill--good' },
  disabled: { text: '無効(送らない)', tone: '' },
};
const DENIAL_LABEL: Record<string, string> = {
  feature_quota_exceeded: '回数の上限', plan_cost_limit_exceeded: '1旅行の額の上限', per_call_limit_exceeded: '1回の量の上限',
  monthly_cost_limit_exceeded: '月の額の上限', monthly_plan_quota_exceeded: '月の旅行の数の上限',
};

function useLoad<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fn());
    } catch (e) {
      setError(errorDetailMessage(e, '読み込めませんでした'));
    } finally {
      setLoading(false);
    }
  }, [fn]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}

const Loading: React.FC = () => <p role="status" className="text-sm text-ink-500 p-4">読み込んでいます…</p>;
const Failed: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div role="alert" className="tc-card p-4 text-sm">
    <p className="text-danger font-semibold">{message}</p>
    <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm mt-2" onClick={onRetry}>もう一度読む</button>
  </div>
);

// ===================================================================== 概要
const OverviewTab: React.FC<{ onGo: (t: Tab) => void }> = ({ onGo }) => {
  const { data, error, loading, reload } = useLoad<OpsOverview>(getOpsOverview);
  if (loading) return <Loading />;
  if (error || !data) return <Failed message={error ?? '読み込めませんでした'} onRetry={() => void reload()} />;
  const paid = data.connected_paid_providers.length;
  const states = data.plan_accounts.by_state as Record<string, number>;
  return (
    <div className="tc-ops-grid">
      <div className="tc-ops-kpis">
        <article className="tc-card tc-ops-kpi">
          <p className="tc-ops-kpi-head">今月の Fake の試験の額</p>
          <p className="tc-ops-kpi-value">{yen(data.fake_usage.estimated_jpy)}</p>
          <p className="tc-ops-kpi-sub">{`${data.fake_usage.events}件 · 実の請求ではない`}</p>
        </article>
        <article className="tc-card tc-ops-kpi">
          <p className="tc-ops-kpi-head">今月の実の提供元の見込み</p>
          <p className="tc-ops-kpi-value">{yen(data.live_usage.estimated_jpy)}</p>
          <p className="tc-ops-kpi-sub">アプリの見込み · 請求との照合は明細が届いてから</p>
        </article>
        <article className="tc-card tc-ops-kpi">
          <p className="tc-ops-kpi-head">1旅行の上限</p>
          <p className="tc-ops-kpi-value">{yen(data.thresholds.hard_cap_jpy)}<small> / 旅行</small></p>
          <p className="tc-ops-kpi-sub">{`警告 ${yen(data.thresholds.user_warning_jpy)} · 運用の知らせ ${yen(data.thresholds.ops_alert_jpy)} · policy ${data.policy_version}`}</p>
        </article>
        <article className="tc-card tc-ops-kpi">
          <p className="tc-ops-kpi-head">有料の提供元の接続</p>
          <p className="tc-ops-kpi-value">{paid}<small> / 4</small></p>
          <p className="tc-ops-kpi-sub">{paid === 0 ? '未接続(外へは送らない)' : data.connected_paid_providers.join('・')}</p>
        </article>
      </div>
      <div className="tc-ops-two">
        <article className="tc-card tc-ops-panel">
          <div className="tc-section-row"><h2 className="tc-section-title">旅行ごとの原価の口座</h2>
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => onGo('ledger')}>台帳へ</button></div>
          <p className="tc-ops-desc">{`旅行の口座 ${data.plan_accounts.total}件 · 予約中 ${data.open_reservations}件(${data.month})`}</p>
          <ul className="tc-ops-rows">
            {Object.keys(STATE_LABEL).filter((k) => states[k]).map((k) => (
              <li key={k}><StatePill state={k} /><b>{`${states[k]}件`}</b></li>
            ))}
            {data.plan_accounts.total === 0 && <li>まだ口座はありません(外部の提供元を一度も使っていません)</li>}
          </ul>
        </article>
        <article className="tc-card tc-ops-panel">
          <div className="tc-section-row"><h2 className="tc-section-title">Cloud の請求・予算</h2>
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => onGo('cloud')}>Cloud 環境へ</button></div>
          <p className="tc-ops-desc">{data.cloud_billing.message}</p>
          <p className="tc-ops-callout">GCP の予算は通知です。課金を自動で止める上限ではありません。1旅行 50円の上限はアプリのサーバーが provider へ送る前に守ります。</p>
          {Object.keys(data.suspended_providers).length > 0 && (
            <p className="tc-ops-desc mt-2"><span className="tc-pill tc-pill--warn">止めている提供元</span>{' '}{Object.keys(data.suspended_providers).join('・')}</p>
          )}
        </article>
      </div>
      <p className="tc-ops-asof">{`取得 ${new Date(data.as_of).toLocaleString('ja-JP')} · 環境 ${data.environment}`}</p>
    </div>
  );
};

// ===================================================================== 提供元
const ProvidersTab: React.FC = () => {
  const { data, error, loading, reload } = useLoad<OpsProviders>(getOpsProviders);
  const [pending, setPending] = useState<{ p: OpsProvider; reason: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (error || !data) return <Failed message={error ?? '読み込めませんでした'} onRetry={() => void reload()} />;
  const submit = async () => {
    if (!pending || !pending.reason.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await setOpsProviderSuspended(pending.p.name, !pending.p.suspended, pending.reason.trim());
      setMsg(`${pending.p.label} を${pending.p.suspended ? '戻しました' : '止めました'}(監査に記録)`);
      setPending(null);
      await reload();
    } catch (e) {
      setMsg(errorDetailMessage(e, '変更できませんでした'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="tc-card tc-ops-panel">
      <div className="tc-section-row"><div><h2 className="tc-section-title">外部 API・契約と接続</h2>
        <p className="tc-ops-desc">{data.rule}</p></div></div>
      {msg && <p role="status" className="tc-ops-callout">{msg}</p>}
      <div className="tc-ops-table-wrap">
        <table className="tc-ops-table">
          <thead><tr><th>提供元 / API</th><th>用途</th><th>契約・請求</th><th>価格の版</th><th>鍵</th><th>送信</th><th>今月</th><th /></tr></thead>
          <tbody>
            {data.providers.map((p) => (
              <tr key={p.name} data-testid={`ops-provider-${p.name}`}>
                <td><b>{p.label}</b><br /><code>{p.operations.join(' · ')}</code></td>
                <td>{p.purpose}</td>
                <td><span className={`tc-pill ${p.contract === 'unverified' ? 'tc-pill--warn' : 'tc-pill--good'}`}>
                  {p.contract === 'unverified' ? '契約・課金は未確認' : '料金なし'}</span></td>
                <td><span className={`tc-pill ${p.price_profile === 'known' ? 'tc-pill--good' : 'tc-pill--warn'}`}>
                  {p.price_profile === 'known' ? `単価あり(${p.policy_version ?? '—'})` : p.price_profile === 'partial' ? '一部の単価なし' : '読めない'}</span></td>
                <td><span className={`tc-pill ${SECRET_LABEL[p.secret]?.tone ?? ''}`}>{SECRET_LABEL[p.secret]?.text ?? p.secret}</span>
                  {p.secret_setting && <><br /><code>{p.secret_setting}</code></>}</td>
                <td><span className={`tc-pill ${LIVE_LABEL[p.live_calls]?.tone ?? ''}`}>{LIVE_LABEL[p.live_calls]?.text}</span>
                  {p.suspended && <><br /><span className="tc-pill tc-pill--bad">止めている</span></>}</td>
                <td>{p.month_usage ? `${p.month_usage.events}件 · ${yen(p.month_usage.estimated_jpy)}` : '—'}</td>
                <td>
                  <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => setPending({ p, reason: '' })}>
                    {p.suspended ? '戻す' : '止める'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pending && (
        <form className="tc-ops-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}
          aria-label={`${pending.p.label} を${pending.p.suspended ? '戻す' : '止める'}`}>
          <label htmlFor="ops-reason">{`${pending.p.label} を${pending.p.suspended ? '戻す' : '止める'}理由(監査に残ります)`}</label>
          <input id="ops-reason" value={pending.reason} maxLength={200}
            onChange={(e) => setPending({ ...pending, reason: e.target.value })} />
          <div className="flex gap-2">
            <button type="submit" className="tc-focus-ring tc-mbtn tc-mbtn--primary" disabled={busy || !pending.reason.trim()}>実行</button>
            <button type="button" className="tc-focus-ring tc-mbtn" onClick={() => setPending(null)}>やめる</button>
          </div>
        </form>
      )}
      <ol className="tc-ops-steps" aria-label="接続の順番">
        <li><b>契約・請求先を確かめる</b>OpenAI は ChatGPT の契約と API の課金が別。Google は Cloud の請求先と予算</li>
        <li><b>必要な API だけ有効にする</b>使わない API は有効にしない</li>
        <li><b>制限付きの鍵を作る</b>ブラウザ用(referrer・許可 API)とサーバー用を分ける</li>
        <li><b>Secret Manager に入れる</b>Cloud Run の実行のアカウントだけが読める。画面・ログ・Git に出さない</li>
        <li><b>1回だけの少額の確認</b>見込みの額と残りの枠を確かめてから、1回ずつ</li>
      </ol>
      <p className="tc-ops-asof">この画面は OpenAI Platform・Google Cloud の契約の状態を読みません(未確認と表示)。</p>
    </article>
  );
};

// ===================================================================== 台帳
const LedgerTab: React.FC = () => {
  const { data, error, loading, reload } = useLoad<OpsLedger>(getOpsLedger);
  if (loading) return <Loading />;
  if (error || !data) return <Failed message={error ?? '読み込めませんでした'} onRetry={() => void reload()} />;
  return (
    <article className="tc-card tc-ops-panel">
      <div className="tc-section-row"><div><h2 className="tc-section-title">原価・利用台帳(旅行ごと)</h2>
        <p className="tc-ops-desc">{data.note}</p></div>
        <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => void reload()}>読み直す</button></div>
      {data.rows.length === 0 ? <p className="tc-ops-desc p-3">まだ口座はありません。</p> : (
        <div className="tc-ops-table-wrap">
          <table className="tc-ops-table">
            <thead><tr><th>旅行</th><th>クラス・policy</th><th>確定</th><th>予約中</th><th>最大見込み</th><th>¥50まで</th><th>状態</th><th>提供元</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.plan_id}>
                  <td><code>{r.plan_ref}…</code>{r.fake_only && <><br /><span className="tc-pill tc-pill--blue">Fake の試験</span></>}</td>
                  <td>{r.class}<br /><code>{r.policy_version}</code></td>
                  <td>{yen(r.settled_jpy)}</td>
                  <td>{yen(r.reserved_jpy)}</td>
                  <td>{yen(r.max_total_jpy)}</td>
                  <td>{yen(r.remaining_jpy)}</td>
                  <td><StatePill state={r.state} /></td>
                  <td>{Object.keys(r.providers).join('・') || '—'}<br /><small>{`確定 ${r.settled_events} · 解放 ${r.released_events}`}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
};

// ===================================================================== Cloud
const CloudTab: React.FC = () => {
  const { data, error, loading, reload } = useLoad<OpsCloud>(getOpsCloud);
  if (loading) return <Loading />;
  if (error || !data) return <Failed message={error ?? '読み込めませんでした'} onRetry={() => void reload()} />;
  return (
    <article className="tc-card tc-ops-panel">
      <div className="tc-section-row"><div><h2 className="tc-section-title">Cloud 環境</h2>
        <p className="tc-ops-desc">実行環境から読める値だけを出します。{data.note}</p></div></div>
      <ul className="tc-ops-rows">
        {data.items.map((it) => (
          <li key={it.key}><span>{it.label}<small>{it.source === 'environment' ? '環境変数' : '設定'}</small></span>
            {it.status === 'known' ? <code>{it.value}</code> : <span className="tc-pill">取得できない</span>}</li>
        ))}
      </ul>
      <h3 className="tc-section-title mt-4">アプリから取得していない値</h3>
      <ul className="tc-ops-rows">
        {data.unavailable.map((u) => (
          <li key={u.key}><span>{u.label}<small>{u.reason}</small></span><span className="tc-pill tc-pill--warn">未取得</span></li>
        ))}
      </ul>
    </article>
  );
};

// ===================================================================== テスト実行(Fake の家族旅行)
const RunsTab: React.FC = () => {
  const [reason, setReason] = useState('家族旅行の Fake の試験');
  const [run, setRun] = useState<OpsFamilyRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setRun(await runOpsFamilyFake(reason.trim()));
    } catch (e) {
      setError(errorDetailMessage(e, '試験を実行できませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const s = run?.summary;
  return (
    <div className="tc-ops-two">
      <article className="tc-card tc-ops-panel">
        <div className="tc-section-row"><h2 className="tc-section-title">家族4人の旅行相談の試験</h2>
          <span className="tc-pill tc-pill--blue">Fake · 外へ送らない</span></div>
        <ul className="tc-ops-rows">
          <li><span>出発地 / 旅行者</span><b>大阪府枚方市 · 大人4人</b></li>
          <li><span>旅行の条件<small>1泊2日 / 自家用車・高速道路</small></span><b>片道3時間以内</b></li>
          <li><span>宿泊の予算<small>4人の合計(旅行の予算。API の原価とは別)</small></span><b>¥60,000〜¥80,000</b></li>
          <li><span>相談・再計画<small>候補 3〜5件・2〜3回の見直し</small></span><b>Fake → 実の提供元は段階で</b></li>
          <li><span>API の原価の条件</span><b>¥40 警告 · ¥45 運用 · ¥50 上限</b></li>
        </ul>
        <form className="tc-ops-form" onSubmit={(e) => { e.preventDefault(); void start(); }} aria-label="Fake の試験を実行">
          <label htmlFor="ops-run-reason">実行の理由(監査に残ります)</label>
          <input id="ops-run-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          <button type="submit" className="tc-focus-ring tc-mbtn tc-mbtn--primary" disabled={busy || !reason.trim()}>
            {busy ? '実行しています…' : 'Fake で原価の上限を試す'}
          </button>
        </form>
        <p className="tc-ops-asof">試験用の利用者と旅行を作り、原価の予約→確定を上限まで繰り返します。本番・staging では実行しません。実の提供元の試験(Live)は、契約と鍵が揃ってから1回ずつ行う予定で、この版にはありません。</p>
        {error && <p role="alert" className="text-danger text-sm mt-2">{error}</p>}
      </article>
      <article className="tc-card tc-ops-panel" aria-live="polite">
        <h2 className="tc-section-title">結果</h2>
        {!s ? <p className="tc-ops-desc">まだ実行していません。</p> : (
          <>
            <ul className="tc-ops-rows" data-testid="ops-run-summary">
              <li><span>最後の合計</span><b>{`${yen(s.final_total_jpy)} / ${yen(s.plan_cap_jpy)}`}</b></li>
              <li><span>上限を越えなかった</span><span className={`tc-pill ${s.never_over_cap ? 'tc-pill--good' : 'tc-pill--bad'}`}>{s.never_over_cap ? 'はい' : 'いいえ'}</span></li>
              <li><span>利用者の警告(40円〜)</span><b>{s.first_user_warning_step ? `${s.first_user_warning_step}回目から` : '届かず'}</b></li>
              <li><span>運用の知らせ(45円〜)</span><b>{s.first_ops_alert_step ? `${s.first_ops_alert_step}回目から` : '届かず'}</b></li>
              <li><span>最初に断った理由<small>provider へ送る前</small></span><b>{s.first_denial ? `${s.first_denial.n}回目 · ${DENIAL_LABEL[s.first_denial.reason] ?? s.first_denial.reason}` : '—'}</b></li>
              <li><span>同じ Idempotency-Key の再送</span><b>{s.idempotency_replay.double_counted === false ? '二重に数えない' : '要確認'}</b></li>
              <li><span>外部への送信</span><b>{`${s.external_calls}回`}</b></li>
            </ul>
            <div className="tc-ops-table-wrap mt-3">
              <table className="tc-ops-table">
                <thead><tr><th>#</th><th>操作</th><th>見込み</th><th>結果</th><th>合計</th><th>状態</th></tr></thead>
                <tbody>
                  {run!.steps.map((st) => (
                    <tr key={st.n}>
                      <td>{st.n}</td><td>{st.label}</td><td>{yen(st.max_cost_jpy)}</td>
                      <td>{st.result === 'settled' ? '確定' : `断った(${DENIAL_LABEL[st.reason ?? ''] ?? st.reason})`}</td>
                      <td>{yen(st.plan_total_jpy)}</td><td><StatePill state={st.state} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tc-ops-asof">{run!.note}</p>
          </>
        )}
      </article>
    </div>
  );
};

// ===================================================================== 秘密情報・権限
/** [Gate OpsSecrets] 鍵の登録: 値は送るだけ(画面に二度と出さない)。登録・無効化は理由が必須で監査に残る。 */
const SecretForm: React.FC<{ slot: OpsSecretSlot; onDone: (msg: string) => void }> = ({ slot, onDone }) => {
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'register' | 'disable' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `secret-${slot.slot}`;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        const st = await registerOpsSecret(slot.slot, value, reason.trim());
        onDone(`${slot.label} を登録しました(版 ${st.version ?? '—'} · 末尾 ${st.last4 ?? '—'})`);
      } else {
        await disableOpsSecret(slot.slot, reason.trim());
        onDone(`${slot.label} の登録を無効にしました`);
      }
      setValue('');
      setReason('');
      setMode(null);
    } catch (e) {
      setValue('');
      setError(errorDetailMessage(e, '保存できませんでした'));
    } finally {
      setBusy(false);
    }
  };
  if (mode === null) {
    return (
      <div className="flex flex-wrap gap-2 mt-2">
        <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary" onClick={() => setMode('register')}>
          {slot.source === 'cms' ? '新しい鍵に入れ替える' : '鍵を登録する'}
        </button>
        {slot.source === 'cms' && (
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => setMode('disable')}>登録を無効にする</button>
        )}
      </div>
    );
  }
  return (
    <form className="tc-ops-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}
      aria-label={`${slot.label} を${mode === 'register' ? '登録' : '無効に'}する`} autoComplete="off">
      {mode === 'register' && (
        <>
          <label htmlFor={`${id}-value`}>{`${slot.label}(貼り付け。保存の後は表示しません)`}</label>
          <input id={`${id}-value`} type="password" value={value} autoComplete="new-password" spellCheck={false}
            maxLength={512} onChange={(e) => setValue(e.target.value)} data-testid={`${id}-value`} />
        </>
      )}
      <label htmlFor={`${id}-reason`}>理由(監査に残ります)</label>
      <input id={`${id}-reason`} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="tc-focus-ring tc-mbtn tc-mbtn--primary"
          disabled={busy || !reason.trim() || (mode === 'register' && value.trim().length < 8)}>
          {mode === 'register' ? '暗号化して保存' : '無効にする'}
        </button>
        <button type="button" className="tc-focus-ring tc-mbtn" onClick={() => { setValue(''); setReason(''); setMode(null); setError(null); }}>やめる</button>
      </div>
    </form>
  );
};

const SOURCE_LABEL: Record<string, string> = { cms: 'この画面で登録', env: 'サーバーの .env' };

const SecretsTab: React.FC = () => {
  const { data, error, loading, reload } = useLoad<OpsSecrets>(getOpsSecrets);
  const [msg, setMsg] = useState<string | null>(null);
  if (loading) return <Loading />;
  if (error || !data) return <Failed message={error ?? '読み込めませんでした'} onRetry={() => void reload()} />;
  return (
    <div className="tc-ops-two">
      <article className="tc-card tc-ops-panel">
        <h2 className="tc-section-title">API キーの登録</h2>
        <p className="tc-ops-desc">{data.note}</p>
        {msg && <p role="status" className="tc-ops-callout">{msg}</p>}
        <ul className="tc-ops-secrets">
          {data.slots.map((s) => (
            <li key={s.slot} data-testid={`ops-secret-${s.slot}`}>
              <div className="tc-section-row">
                <span><b>{s.label}</b><small>{s.hint}</small><small>{`使う提供元: ${s.providers.join('・')} · .env の名前: ${s.env}`}</small></span>
                <span className={`tc-pill ${s.status === 'configured' ? 'tc-pill--good' : 'tc-pill--warn'}`}>
                  {s.status === 'configured' ? '設定あり' : '未設定'}
                </span>
              </div>
              {s.status === 'configured' && (
                <p className="tc-ops-desc">
                  {`出典: ${SOURCE_LABEL[s.source ?? ''] ?? '—'}${s.version ? ` · 版 ${s.version}` : ''}${s.last4 ? ` · 末尾 ${s.last4}` : ''}`}
                  {s.registered_at ? ` · ${new Date(s.registered_at).toLocaleString('ja-JP')}` : ''}
                </p>
              )}
              <SecretForm slot={s} onDone={(m) => { setMsg(m); void reload(); }} />
              {s.history.length > 0 && (
                <details className="mt-2 text-xs text-ink-700">
                  <summary>登録の履歴</summary>
                  <ul>
                    {s.history.map((h) => (
                      <li key={h.version}>{`版 ${h.version} · ${h.status === 'active' ? '有効' : h.status === 'superseded' ? '入れ替え済み' : '無効'} · 末尾 ${h.last4} · ${h.reason}`}</li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
        <p className="tc-ops-asof">鍵を登録しても、外部の API へ送るのは提供元の接続(adapter)を入れて登録した後です。今は全て「送信: 無効」のままです。</p>
      </article>
      <article className="tc-card tc-ops-panel">
        <h2 className="tc-section-title">権限と記録</h2>
        <ul className="tc-ops-rows">
          <li><span>この画面</span><b>管理者 + 多要素認証</b></li>
          <li><span>鍵の登録・無効化</span><b>理由が必須 · 監査に記録(値は記録しない)</b></li>
          <li><span>保存の方法</span><b>サーバーの ENCRYPTION_KEY で暗号化</b></li>
          <li><span>使う順</span><b>この画面で登録した有効な版 → .env</b></li>
          <li><span>鍵の入れ替え</span><b>新しい版を登録 → 前の版は自動で入れ替え済み</b></li>
          <li><span>提供元を止める・戻す・試験</span><b>理由が必須 · 監査に記録</b></li>
        </ul>
        <Link to="/admin/audit-logs" className="tc-focus-ring tc-mbtn tc-mbtn--sm mt-3 inline-flex">監査ログを見る</Link>
      </article>
    </div>
  );
};

const AdminOpsPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="tc-page tc-ops">
      <PageHead
        eyebrow="OPERATIONS · 運用コンソール"
        title="運用の状態を、ひと目で。"
        sub="外部 API の契約・接続、旅行ごとの原価の上限、開発環境をまとめて確認します。"
        actions={<Link to="/admin" className="tc-focus-ring tc-mbtn tc-mbtn--sm">← 管理の画面</Link>}
      />
      <div className="tc-ops-banner" role="note">
        <b>有料の外部 API はまだ接続していません。</b>
        今は Fake の提供元で原価の上限を確かめる段階です。OpenAI・Google Maps の契約・鍵・Secret Manager が揃うまで、外へは送りません。
      </div>
      <div className="tc-kit-nav">
      <div className="tc-kit-tabs tc-ops-tabs" role="tablist" aria-label="運用コンソールの画面">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`ops-tab-${t.id}`} aria-selected={tab === t.id}
            aria-controls={`ops-panel-${t.id}`} className="tc-focus-ring tc-day-tab" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <Link to="/admin/audit-logs" className="tc-focus-ring tc-mbtn tc-mbtn--sm">監査ログ →</Link>
      </div>
      <section role="tabpanel" id={`ops-panel-${tab}`} aria-labelledby={`ops-tab-${tab}`}>
        {tab === 'overview' && <OverviewTab onGo={setTab} />}
        {tab === 'providers' && <ProvidersTab />}
        {tab === 'ledger' && <LedgerTab />}
        {tab === 'cloud' && <CloudTab />}
        {tab === 'runs' && <RunsTab />}
        {tab === 'secrets' && <SecretsTab />}
      </section>
    </div>
  );
};

export default AdminOpsPage;
