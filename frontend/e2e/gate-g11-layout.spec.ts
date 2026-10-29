import { test, expect, type Page } from '@playwright/test';
import { apiClient, registerAccount } from './support/api';
import { expectNoAxeViolations } from './support/axe';

/**
 * [Gate G11-Layout] 旅程の画面の配置と、二端末の競合の後の表示(docs/trace/gate-g11-layout-trace.md)。
 *   1. 一覧の上の非同期の表示(利用枠・地図の下の移動概算)が遅れて読み終わっても、予定の一覧の位置が変わらない
 *      (以前は 142px + 24px 下へずれ、押す・ドラッグの位置が外れた。issue #10)
 *   2. 保存が競合(409)し、その後の最新の読み直しが失敗した時に「この画面の項目にはありません」と言い切らない。
 *      読み直すと相手が変えた項目を示し、重ねて保存できる
 * 外部の提供元へはつながない(読み込みの遅れと失敗は page.route で作る。保存は本物の backend を通す)。
 */

const PASSWORD = 'Gate-G11L-TestPass-1';

async function setup(page: Page, label: string) {
  const a = await registerAccount(page, { prefix: 'g11l', label, password: PASSWORD });
  const send = apiClient(page.request, a.apiBase, a.token);
  const plan = await send('post', '/travel-plans/', { title: `配置G11-${Date.now()}` }) as { id: string };
  const day = await send('post', `/plans/${plan.id}/days`, { local_date: '2026-11-21', timezone_id: 'Asia/Tokyo' }) as { id: string };
  const ids: string[] = [];
  for (const [title, time] of [['清水寺', '09:00'], ['八坂神社', '11:00'], ['祇園', '13:00']] as const) {
    ids.push((await send('post', `/plans/${plan.id}/events`, { day_id: day.id, title, local_start_time: time }) as { id: string }).id);
  }
  return { send, planId: plan.id, ids };
}

test('予定の一覧の上の表示が遅れて読み終わっても、一覧の位置が変わらない', async ({ page }) => {
  test.setTimeout(120_000);
  const { planId } = await setup(page, 'layout');
  // 利用枠・移動概算の応答だけを遅らせる(読み終わる時機を一覧が見えた後にする)
  let released = false;
  const gate: Array<() => void> = [];
  const hold = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    if (!released) await new Promise<void>((r) => gate.push(r));
    await route.continue();
  };
  await page.route('**/planning-usage', hold);
  await page.route('**/route-preview**', hold);
  await page.goto(`/planner/${planId}`);
  const list = page.getByRole('list', { name: /の予定$/ });
  await expect(list).toBeVisible();
  await expect(page.getByTestId('planning-usage-loading')).toBeVisible();
  await expect(page.getByTestId('route-summary')).toHaveAttribute('data-status', 'loading');
  const before = (await list.boundingBox())!.y;

  released = true;
  gate.splice(0).forEach((r) => r());
  await expect(page.getByTestId('planning-usage')).toBeVisible();
  await expect(page.getByTestId('route-summary')).toHaveAttribute('data-status', /ready|failed/);
  const after = (await list.boundingBox())!.y;
  expect(Math.abs(after - before), `一覧が ${after - before}px ずれた`).toBeLessThanOrEqual(2);
  await expectNoAxeViolations(page, '旅程(利用枠・移動概算を読み終えた後)');
});

test('競合の後に最新を読み直せなかった時は、変わった項目を言い切らず、読み直してから違いを示す', async ({ page }) => {
  test.setTimeout(120_000);
  const { send, planId, ids } = await setup(page, 'conflict');
  await page.goto(`/planner/${planId}`);
  const item = page.getByRole('listitem', { name: '清水寺(上下矢印キーで並べ替え)' });
  await item.click();
  const dialog = page.getByRole('dialog', { name: 'スポットを編集' });
  await expect(dialog.getByLabel('タイトル')).toHaveValue('清水寺');

  // ほかの端末が先に開始時刻を変える(本物の backend。版が進む)
  const detail = await send('get', `/plans/${planId}`) as { revision: number };
  await send('put', `/plans/${planId}/events/${ids[0]}`, { local_start_time: '09:30' }, { 'If-Match': String(detail.revision) });

  // この端末の保存は 409 になり、その後の最新の読み直し(日程)が失敗する
  let failDetail = true;
  await page.route(`**/plans/${planId}`, async (route) => {
    if (failDetail && route.request().method() === 'GET') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'unavailable' }) });
      return;
    }
    await route.continue();
  });
  await dialog.getByLabel('メモ').fill('朝一番に行く');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  const conflict = dialog.getByTestId('edit-conflict');
  await expect(conflict.getByTestId('edit-conflict-unread')).toContainText('最新の内容を読み直せなかったため');
  await expect(conflict).not.toContainText('この画面の項目にはありません');
  await expect(dialog.getByLabel('メモ')).toHaveValue('朝一番に行く');
  await expectNoAxeViolations(page, '競合(最新を読み直せない)');

  failDetail = false;
  await conflict.getByRole('button', { name: '最新を読み直して違いを確かめる' }).click();
  await expect(conflict).toContainText('開始時刻: ほかの人の値「09:30」');
  await conflict.getByRole('button', { name: '自分の変更を最新の内容に重ねて保存' }).click();
  await expect(dialog).toBeHidden();
  const latest = await send('get', `/plans/${planId}`) as { days: Array<{ events: Array<{ id: string; local_start_time: string }> }> };
  const saved = latest.days[0]!.events.find((e) => e.id === ids[0])!;
  expect(saved.local_start_time).toBe('09:30');
  expect(JSON.stringify(saved)).toContain('朝一番に行く');
});
