/**
 * [Gate Remaining-4] FR-058 管理者の料金・決済(Stripe のテストモード)。
 * - 仮の価格を変える・販売を止める(revision で他の管理者との上書きを防ぐ)
 * - 最近の支払いと返金(全額・一部。理由は必須)
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  adminBillingPayments, adminBillingProducts, adminRefund, adminUpdateProduct, type BillingPayment, type BillingProduct,
} from '@/services/api/billing';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

const AdminBillingPanel: React.FC = () => {
  const [products, setProducts] = useState<BillingProduct[]>([]);
  const [payments, setPayments] = useState<BillingPayment[]>([]);
  const [configured, setConfigured] = useState(false);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, pay] = await Promise.all([adminBillingProducts(), adminBillingPayments()]);
      setProducts(p.products);
      setConfigured(p.configured);
      setPayments(pay.payments);
      setPrices(Object.fromEntries(p.products.map((x) => [x.id, String(x.price_jpy)])));
    } catch (e) {
      setError(errorDetailMessage(e, '料金の情報を取れませんでした'));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (e) {
      setError(errorDetailMessage(e, '変えられませんでした'));
    }
  };

  return (
    <section aria-labelledby="ops-billing-heading" data-testid="ops-billing">
      <h2 id="ops-billing-heading" className="tc-section-title">料金・決済(Stripe のテストモード)</h2>
      <p className="text-sm text-ink-700">
        {configured ? 'テストモードの鍵が登録されています(実際には請求されません)。'
          : '決済の鍵がありません。「秘密情報・権限」で Stripe のテストモードの鍵(sk_test_…)と Webhook の署名の鍵(whsec_…)を登録してください。'}
        価格は仮です。変えると、変えた後の購入から新しい価格になります(購読中の人は元の価格のまま)。
      </p>
      {error && <p role="alert" className="p-2 rounded-lg bg-red-50 text-red-800 text-sm mt-2">{error}</p>}
      {notice && <p role="status" className="p-2 rounded-lg bg-green-50 text-green-900 text-sm mt-2">{notice}</p>}
      <div className="tc-ops-table-wrap mt-3">
        <table className="tc-ops-table" aria-label="商品と仮の価格">
          <thead><tr><th>商品</th><th>種類</th><th>価格(円)</th><th>販売</th><th>版</th><th /></tr></thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.kind === 'trip_pass' ? 'Trip Pass' : `購読(${p.interval === 'year' ? '年' : '月'})`}</td>
                <td>
                  <input aria-label={`${p.name}の価格`} inputMode="numeric" className="border rounded-sm px-2 py-1 w-28"
                    value={prices[p.id] ?? ''} onChange={(e) => setPrices({ ...prices, [p.id]: e.target.value })} />
                </td>
                <td>{p.active ? '販売中' : '停止'}</td>
                <td>{p.revision}</td>
                <td className="whitespace-nowrap">
                  <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm"
                    onClick={() => void run(() => adminUpdateProduct(p.id, { price_jpy: Number(prices[p.id]), revision: p.revision }),
                      `${p.name}の価格を変えました`)}>価格を保存</button>{' '}
                  <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm"
                    onClick={() => void run(() => adminUpdateProduct(p.id, { active: !p.active, revision: p.revision }),
                      p.active ? `${p.name}の販売を止めました` : `${p.name}の販売を始めました`)}>
                    {p.active ? '販売を止める' : '販売する'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="tc-section-title mt-4">最近の支払い</h3>
      {payments.length === 0 ? <p className="text-sm text-ink-700">支払いはまだありません。</p> : (
        <div className="tc-ops-table-wrap">
          <table className="tc-ops-table" aria-label="最近の支払い">
            <thead><tr><th>日付</th><th>内容</th><th>金額</th><th>返金</th><th>状態</th><th /></tr></thead>
            <tbody>
              {payments.map((x) => (
                <tr key={x.id}>
                  <td>{(x.paid_at ?? x.created_at ?? '').slice(0, 10)}</td>
                  <td>{x.product_name ?? x.kind}</td>
                  <td>{yen(x.amount_jpy)}</td>
                  <td>{x.refunded_jpy ? yen(x.refunded_jpy) : '—'}</td>
                  <td>{x.status}</td>
                  <td>
                    {(x.status === 'paid' || x.status === 'partially_refunded') && (
                      <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => {
                        const reason = window.prompt('返金の理由(必須)');
                        if (!reason) return;
                        const amount = window.prompt(`返金の額(円。空なら残りの全額 ${x.amount_jpy - x.refunded_jpy}円)`) ?? '';
                        void run(() => adminRefund(x.id, reason, amount ? Number(amount) : undefined), '返金しました');
                      }}>返金</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default AdminBillingPanel;
