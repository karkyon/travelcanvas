import type { Page } from '@playwright/test';
import { apiClient, registerAccount, type Send } from '../e2e/support/api';

/**
 * [Gate G9] UX-0 今の画面の記録と、壊れていないことの検査(e2e/ux-baseline.spec.ts)で使う同じ旅行。
 * 京都1泊2日・予定4件・移動1件・予約1件(番号は伏せて表示される)。利用者の本当のデータは使わない。
 */
export const UX_PASSWORD = 'Gate-G9-UxBase-1';

export const SCREENS = [
  { id: 'dashboard', name: 'ダッシュボード(旅行一覧)', path: () => '/dashboard' },
  { id: 'planner', name: 'プランナー', path: (p: string) => `/planner/${p}` },
  { id: 'today', name: '今日(NOW/NEXT)', path: (p: string) => `/planner/${p}/today` },
  { id: 'reservations', name: '予約', path: (p: string) => `/planner/${p}/reservations` },
  { id: 'share', name: '共有', path: (p: string) => `/share/${p}` },
  { id: 'settings', name: '設定', path: () => '/settings' },
] as const;

export const VIEWPORTS = [
  { id: 'desktop', width: 1440, height: 900 },
  { id: 'mobile', width: 390, height: 844 },
] as const;

/** [Gate G9] UX-2〜UX-4 の後は、狭いスマホ・タブレット・小さいPCの幅でも同じ決まりを確かめる(撮るのは VIEWPORTS だけ) */
export const CHECK_VIEWPORTS = [
  ...VIEWPORTS,
  { id: 'mobile-s', width: 360, height: 780 },
  { id: 'tablet', width: 768, height: 1024 },
  { id: 'laptop', width: 1024, height: 768 },
] as const;

export async function seedBaseline(page: Page, label: string): Promise<{ planId: string; send: Send }> {
  const a = await registerAccount(page, { prefix: 'ux', label, password: UX_PASSWORD });
  const send = apiClient(page.request, a.apiBase, a.token);
  const plan = await send('post', '/travel-plans/', { title: '京都 紅葉の1泊2日', destination: '京都' }) as { id: string };
  const base = `/plans/${plan.id}`;
  const d1 = await send('post', `${base}/days`, { local_date: '2026-11-21', timezone_id: 'Asia/Tokyo' }) as { id: string };
  await send('post', `${base}/days`, { local_date: '2026-11-22', timezone_id: 'Asia/Tokyo' });
  const ids: string[] = [];
  for (const [title, type, time, lon] of [
    ['京都駅', 'transport', '09:00', 135.7588], ['清水寺', 'sightseeing', '10:00', 135.7850],
    ['祇園で昼食', 'meal', '12:30', 135.7751], ['伏見稲荷大社', 'sightseeing', '14:30', 135.7727],
  ] as const) {
    ids.push((await send('post', `${base}/events`, {
      day_id: d1.id, title, event_type: type, local_start_time: time, latitude: 34.99, longitude: lon }) as { id: string }).id);
  }
  await send('post', `${base}/segments`, { from_event_id: ids[0], to_event_id: ids[1], mode: 'bus', duration_minutes: 20 });
  await send('post', `${base}/reservations`, {
    type: 'restaurant', provider_name: '祇園の料亭', event_id: ids[2], confirmation_number: 'UXBASE1234', total_amount: 6000, currency: 'JPY' });
  return { planId: plan.id, send };
}
