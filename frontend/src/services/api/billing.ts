/**
 * [Gate Remaining-4] FR-058 料金・決済(Stripe のテストモード)の API。
 *
 * 最初に読む JS を小さく保つため、CompleteTravelAPI には足さず、使う画面(後から読む塊)がここを直接 import する。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { arrayOf, bool, decodeResponse, nullable, num, object, oneOf, str, type Decoder } from './decode';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export interface BillingProduct {
  id: string; code: string; kind: 'subscription' | 'trip_pass'; tier_key: string; name: string;
  description: string | null; price_jpy: number; interval: 'month' | 'year' | null; active: boolean; revision: number;
  updated_at: string | null;
}
export interface BillingSubscription {
  id: string; product: BillingProduct | null; status: string; cancel_at_period_end: boolean;
  current_period_end: string | null; price_jpy: number; usable: boolean; created_at: string | null;
}
export interface BillingPayment {
  id: string; kind: 'subscription' | 'trip_pass' | 'invoice'; status: string; amount_jpy: number; refunded_jpy: number;
  product_name: string | null; plan_id: string | null; plan_title: string | null; receipt_url: string | null;
  paid_at: string | null; created_at: string | null; user_id: string; refund_reason: string | null;
}
export interface BillingMe {
  class: string; class_label: string; class_source: string; subscriptions: BillingSubscription[];
  payments: BillingPayment[]; trip_passes: { plan_id: string; plan_title: string }[]; configured: boolean;
}

const product: Decoder<BillingProduct> = object<BillingProduct>({
  id: str, code: str, kind: oneOf('subscription', 'trip_pass'), tier_key: str, name: str, description: nullable(str),
  price_jpy: num, interval: nullable(oneOf('month', 'year')), active: bool, revision: num, updated_at: nullable(str),
});
const subscription: Decoder<BillingSubscription> = object<BillingSubscription>({
  id: str, product: nullable(product), status: str, cancel_at_period_end: bool, current_period_end: nullable(str),
  price_jpy: num, usable: bool, created_at: nullable(str),
});
const payment: Decoder<BillingPayment> = object<BillingPayment>({
  id: str, kind: oneOf('subscription', 'trip_pass', 'invoice'), status: str, amount_jpy: num, refunded_jpy: num,
  product_name: nullable(str), plan_id: nullable(str), plan_title: nullable(str), receipt_url: nullable(str),
  paid_at: nullable(str), created_at: nullable(str), user_id: str, refund_reason: nullable(str),
});
const productsResp = object({ configured: bool, test_mode: bool, products: arrayOf(product), note: str });
const meResp: Decoder<BillingMe> = object<BillingMe>({
  class: str, class_label: str, class_source: str, subscriptions: arrayOf(subscription), payments: arrayOf(payment),
  trip_passes: arrayOf(object({ plan_id: str, plan_title: str })), configured: bool,
});

export async function getBillingProducts() {
  return decodeResponse((await api.get('/billing/products', SILENT)).data, productsResp, 'GET /billing/products');
}

export async function getBillingMe(): Promise<BillingMe> {
  return decodeResponse((await api.get('/billing/me', SILENT)).data, meResp, 'GET /billing/me');
}

export async function startCheckout(productId: string, planId?: string): Promise<{ url: string | null; payment_id: string }> {
  const body = planId ? { product_id: productId, plan_id: planId } : { product_id: productId };
  return decodeResponse((await api.post('/billing/checkout', body, SILENT)).data,
    object({ url: nullable(str), payment_id: str }), 'POST /billing/checkout');
}

export async function syncCheckout(sessionId: string): Promise<{ result: string; payment: BillingPayment }> {
  return decodeResponse((await api.post(`/billing/checkout/${encodeURIComponent(sessionId)}/sync`, null, SILENT)).data,
    object({ result: str, payment }), 'POST /billing/checkout/{session_id}/sync');
}

export async function cancelSubscription(id: string, atPeriodEnd = true): Promise<BillingSubscription> {
  return decodeResponse((await api.post(`/billing/subscriptions/${id}/cancel`, { at_period_end: atPeriodEnd }, SILENT)).data,
    subscription, 'POST /billing/subscriptions/{sub_id}/cancel');
}

export async function resumeSubscription(id: string): Promise<BillingSubscription> {
  return decodeResponse((await api.post(`/billing/subscriptions/${id}/resume`, null, SILENT)).data, subscription,
    'POST /billing/subscriptions/{sub_id}/resume');
}

// ===== 管理者
export async function adminBillingProducts() {
  return decodeResponse((await api.get('/admin/billing/products', SILENT)).data,
    object({ configured: bool, products: arrayOf(product) }), 'GET /admin/billing/products');
}

export async function adminUpdateProduct(id: string, patch: {
  name?: string; description?: string; price_jpy?: number; active?: boolean; revision: number;
}): Promise<BillingProduct> {
  return decodeResponse((await api.patch(`/admin/billing/products/${id}`, patch, SILENT)).data, product,
    'PATCH /admin/billing/products/{product_id}');
}

export async function adminBillingPayments() {
  return decodeResponse((await api.get('/admin/billing/payments', SILENT)).data,
    object({ configured: bool, payments: arrayOf(payment) }), 'GET /admin/billing/payments');
}

export async function adminRefund(id: string, reason: string, amountJpy?: number): Promise<BillingPayment> {
  const body = amountJpy ? { reason, amount_jpy: amountJpy } : { reason };
  return decodeResponse((await api.post(`/admin/billing/payments/${id}/refund`, body, SILENT)).data, payment,
    'POST /admin/billing/payments/{payment_id}/refund');
}
