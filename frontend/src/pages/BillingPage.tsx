/**
 * [Gate Remaining-4] FR-058 料金・お支払い(Stripe のテストモード)。
 *
 * - 会員のクラス(Trip・Journey・Explorer)の購読と、旅行ごとの Trip Pass。価格は仮(管理者が変えられる)
 * - 購入は Stripe の画面(Checkout)へ移ってカードを入れる。このアプリはカードの番号を受け取らない
 * - 戻ってきた時(?session=)は結果を問い合わせて反映する。購読は期間の終わりで止める・すぐ止める・止める予定を取り消す
 * - 支払いの記録(返金を含む)と領収書・請求書へのリンク。決済の設定が無い環境は案内だけ
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import api from '@/services/api';
import {
  cancelSubscription, getBillingMe, getBillingProducts, resumeSubscription, startCheckout, syncCheckout,
  type BillingMe, type BillingProduct,
} from '@/services/api/billing';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { safeExternalUrl } from '@/utils/safeNavigation';

const STATUS_LABEL: Record<string, string> = {
  active: '利用中', trialing: '試用中', past_due: '支払いの遅れ(使えます)', canceled: '止めました', unpaid: '未払いで止まりました',
  incomplete: '手続き中', incomplete_expired: '手続きが切れました', paused: '一時停止',
  paid: '支払い済み', pending: '手続き中', failed: '失敗', expired: '期限切れ', refunded: '返金済み',
  partially_refunded: '一部を返金',
};
const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');
const per = (p: BillingProduct) => (p.interval === 'year' ? '年' : p.interval === 'month' ? '月' : '1 旅行');

const BillingPage: React.FC = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState<BillingProduct[]>([]);
  const [configured, setConfigured] = useState(false);
  const [note, setNote] = useState('');
  const [me, setMe] = useState<BillingMe | null>(null);
  const [plans, setPlans] = useState<{ id: string; title: string }[]>([]);
  const [passPlan, setPassPlan] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([getBillingProducts(), getBillingMe()]);
      setProducts(p.products);
      setConfigured(p.configured);
      setNote(p.note);
      setMe(m);
    } catch (e) {
      setError(errorDetailMessage(e, '料金の情報を取れませんでした'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    api.getPlans().then((r) => {
      const list = (r.data ?? []).map((x) => ({ id: String(x.id), title: String(x.title ?? '(名前なし)') }));
      setPlans(list);
      setPassPlan((cur) => cur || list[0]?.id || '');
    }).catch(() => setPlans([]));
  }, [load]);

  // Stripe の画面から戻ってきた時
  useEffect(() => {
    const session = params.get('session');
    if (params.get('canceled')) {
      setMessage('購入をやめました。請求はありません');
      setParams({}, { replace: true });
    } else if (session) {
      setBusy('sync');
      syncCheckout(session).then((r) => {
        setMessage(r.payment.status === 'paid' ? 'お支払いが済みました(テストモード)。下の記録で確かめられます'
          : '手続きの結果を確かめています。少し後に読み直してください');
        return load();
      }).catch((e) => setError(errorDetailMessage(e, '手続きの結果を確かめられませんでした')))
        .finally(() => { setBusy(null); setParams({}, { replace: true }); });
    }
  }, [params, setParams, load]);

  const buy = async (p: BillingProduct) => {
    setBusy(p.id);
    setError(null);
    try {
      const r = await startCheckout(p.id, p.kind === 'trip_pass' ? passPlan : undefined);
      // Stripe の Checkout の画面だけへ移る(ほかの宛先へは移らない)
      const to = safeExternalUrl(r.url);
      if (to && to.startsWith('https://checkout.stripe.com/')) {
        window.location.assign(to);
      } else {
        setError('決済の画面を開けませんでした');
        setBusy(null);
      }
    } catch (e) {
      setError(errorDetailMessage(e, '購入を始められませんでした'));
      setBusy(null);
    }
  };

  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      setMessage(ok);
      await load();
    } catch (e) {
      setError(errorDetailMessage(e, '購読を変えられませんでした'));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>;
  const subs = products.filter((p) => p.kind === 'subscription');
  const passes = products.filter((p) => p.kind === 'trip_pass');
  const live = me?.subscriptions.find((s) => s.usable);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/settings')}>← 設定へ戻る</Button>
      <h1 className="text-2xl font-bold text-ink-900 mt-2">料金・お支払い</h1>
      <p className="text-sm text-ink-700 mt-1">{note}</p>
      {!configured && (
        <p className="mt-3 p-3 rounded-lg bg-amber-50 text-amber-900 text-sm" role="status">
          この環境では決済を使えません(管理者が Stripe のテストモードの鍵を登録すると使えます)。
        </p>
      )}
      {error && <p className="mt-3 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</p>}
      {message && <p className="mt-3 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{message}</p>}

      <Card padding="md" className="mt-4">
        <h2 className="text-lg font-semibold text-ink-900">今のクラス</h2>
        <p className="text-ink-900 mt-1" data-testid="billing-class">
          {`${me?.class_label ?? '—'}${me?.class_source === 'subscription' ? '(購読)' : me?.class_source === 'admin' ? '(管理者の付与)' : ''}`}
        </p>
        {me && me.trip_passes.length > 0 && (
          <p className="text-sm text-ink-700 mt-1">{`Trip Pass の付いた旅行: ${me.trip_passes.map((t) => t.plan_title).join('、')}`}</p>
        )}
      </Card>

      <section aria-labelledby="billing-plans-heading" className="mt-6">
        <h2 id="billing-plans-heading" className="text-lg font-semibold text-ink-900 mb-2">会員のクラス(購読)</h2>
        <ul className="grid sm:grid-cols-3 gap-3" aria-label="購読のクラス">
          {subs.map((p) => (
            <li key={p.id}>
              <Card padding="md" className="h-full flex flex-col">
                <p className="font-semibold text-ink-900">{p.name}</p>
                <p className="text-xl text-ink-900 mt-1">{`${yen(p.price_jpy)} / ${per(p)}`}</p>
                {p.description && <p className="text-xs text-ink-700 mt-1">{p.description}</p>}
                <div className="mt-auto pt-3">
                  <Button variant="primary" size="sm" disabled={!configured || !!live || busy !== null}
                    loading={busy === p.id} onClick={() => void buy(p)}>購読する</Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
        {live && <p className="text-xs text-ink-700 mt-2">購読中です。別のクラスにする時は、今の購読を止めてから選んでください。</p>}
      </section>

      {passes.length > 0 && (
        <section aria-labelledby="billing-pass-heading" className="mt-6">
          <h2 id="billing-pass-heading" className="text-lg font-semibold text-ink-900 mb-2">Trip Pass(1 旅行)</h2>
          {passes.map((p) => (
            <Card key={p.id} padding="md" className="flex flex-wrap items-end gap-3">
              <div>
                <p className="font-semibold text-ink-900">{`${p.name} ${yen(p.price_jpy)}`}</p>
                {p.description && <p className="text-xs text-ink-700">{p.description}</p>}
              </div>
              <label className="text-sm">旅行
                <select className="block border rounded-lg px-2 py-1" value={passPlan} onChange={(e) => setPassPlan(e.target.value)}>
                  {plans.length === 0 && <option value="">自分の旅行がありません</option>}
                  {plans.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                </select>
              </label>
              <Button variant="outline" size="sm" disabled={!configured || !passPlan || busy !== null}
                loading={busy === p.id} onClick={() => void buy(p)}>この旅行に買う</Button>
            </Card>
          ))}
        </section>
      )}

      <section aria-labelledby="billing-subs-heading" className="mt-6">
        <h2 id="billing-subs-heading" className="text-lg font-semibold text-ink-900 mb-2">購読</h2>
        {me && me.subscriptions.length === 0 ? (
          <p className="text-sm text-ink-700">購読はありません。</p>
        ) : (
          <ul className="space-y-2" aria-label="購読">
            {me?.subscriptions.map((s) => (
              <li key={s.id}>
                <Card padding="md" className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink-900">{`${s.product?.name ?? '購読'} ・ ${yen(s.price_jpy)} ・ ${STATUS_LABEL[s.status] ?? s.status}`}</p>
                    <p className="text-xs text-ink-700">
                      {s.cancel_at_period_end ? `${day(s.current_period_end)} で止まります` : `次の更新 ${day(s.current_period_end)}`}
                    </p>
                  </div>
                  {s.usable && (
                    <div className="flex flex-wrap gap-2">
                      {s.cancel_at_period_end ? (
                        <Button variant="outline" size="sm" loading={busy === s.id}
                          onClick={() => void act(s.id, () => resumeSubscription(s.id), '止める予定を取り消しました')}>続ける</Button>
                      ) : (
                        <Button variant="outline" size="sm" loading={busy === s.id}
                          onClick={() => void act(s.id, () => cancelSubscription(s.id, true), '期間の終わりで止めます')}>期間の終わりで止める</Button>
                      )}
                      <Button variant="ghost" size="sm" disabled={busy !== null}
                        onClick={() => {
                          if (window.confirm('今すぐ止めますか? クラスはすぐ Free に戻ります')) {
                            void act(s.id, () => cancelSubscription(s.id, false), '購読を止めました');
                          }
                        }}>今すぐ止める</Button>
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="billing-pay-heading" className="mt-6">
        <h2 id="billing-pay-heading" className="text-lg font-semibold text-ink-900 mb-2">支払いの記録</h2>
        {me && me.payments.length === 0 ? (
          <p className="text-sm text-ink-700">記録はありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="支払いの記録">
              <thead>
                <tr className="text-left text-ink-700"><th className="py-1">日付</th><th>内容</th><th>金額</th><th>状態</th><th>領収書</th></tr>
              </thead>
              <tbody>
                {me?.payments.map((x) => (
                  <tr key={x.id} className="border-t">
                    <td className="py-1">{day(x.paid_at ?? x.created_at)}</td>
                    <td>{`${x.product_name ?? (x.kind === 'invoice' ? '購読の請求' : '支払い')}${x.plan_title ? `(${x.plan_title})` : ''}`}</td>
                    <td>{`${yen(x.amount_jpy)}${x.refunded_jpy ? `(返金 ${yen(x.refunded_jpy)})` : ''}`}</td>
                    <td>{STATUS_LABEL[x.status] ?? x.status}</td>
                    <td>{safeExternalUrl(x.receipt_url) ? <a className="text-blue-800 underline" href={safeExternalUrl(x.receipt_url) ?? undefined} target="_blank" rel="noreferrer noopener">開く</a> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default BillingPage;
