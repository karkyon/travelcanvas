import { test, expect } from '@playwright/test';
import { apiClient, registerMember } from './support/api';
import { startGuestPlanViaApi } from './support/guestPlan';
import { expectNoAxeViolations } from './support/axe';

/**
 * [Gate G4] 外部の判断の要らない機能の残りを、実際のブラウザで確かめる。
 *   1. MAP-02 場所: 例外の日(臨時休業)を登録すると、その日の営業時間が「臨時休業」になる。入口ごとの地点を登録できる
 *   2. MAP-03 検索のコマンド: 「>予定を追加」は Enter では確認だけ(何も変えない)、「実行する」で1回だけ足し、「元に戻す」で消える
 *   3. COL-02 合意: 候補箱の候補を選択肢にした投票を決定し、確かめてから旅程に反映し、反映を元に戻せる
 *      COL-03 予定へのコメント: 予定ごとのコメントの画面から、その予定に付けて投稿できる
 *   4. COL-05 ゲストの閲覧: 開いた後の「最新を読み込む」は使用回数を使わない。複製は許された項目だけ。FC-097 問題を報告できる
 *      COL-03 通知の設定を変えられる
 */

test('MAP-02 例外の日・その日の営業時間・入口', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `G4場所E2E-${Date.now()}`, { open: false });
  const send = apiClient(context.request, apiBase, token);
  const day = await send('post', `/plans/${planId}/days`, { local_date: '2026-11-03', timezone_id: 'Asia/Tokyo' });
  const cand = await send('post', `/plans/${planId}/candidates`, { title: '美術館G4' });
  const s = await send('post', `/plans/${planId}/candidates/${cand.id}/schedule`, { day_id: day.id }, { 'If-Match': '1' });
  await page.goto(`/planner/${planId}/places/${s.place_id}`);
  const special = page.getByRole('region', { name: '例外の日' });
  await expect(special).toBeVisible();
  await special.getByRole('button', { name: '例外の日を追加' }).click();
  await special.getByLabel('日付').fill('2026-11-03');
  await special.getByLabel('メモ').fill('臨時休業G4');
  await special.getByRole('button', { name: '例外の日を保存' }).click();
  await expect(page.getByRole('status').filter({ hasText: '例外の日を保存しました' })).toBeVisible();
  await special.getByLabel('その日の営業時間を確かめる').fill('2026-11-03');
  await special.getByRole('button', { name: '確かめる' }).click();
  await expect(special.getByRole('status', { name: 'その日の営業時間' })).toContainText('臨時休業');

  const entrances = page.getByRole('region', { name: '入口' });
  await entrances.getByRole('button', { name: '入口を追加' }).click();
  await entrances.getByLabel('名前').fill('正面G4');
  await entrances.getByLabel('緯度').fill('35.0');
  await entrances.getByLabel('経度').fill('135.7');
  await entrances.getByRole('button', { name: '入口を保存' }).click();
  await expect(page.getByRole('status').filter({ hasText: '入口を保存しました' })).toBeVisible();
  const place = await send('get', `/places/${s.place_id}`);
  expect(place.special_hours.map((x: { local_date: string }) => x.local_date)).toEqual(['2026-11-03']);
  expect(place.entrances.map((x: { label: string }) => x.label)).toEqual(['正面G4']);
  await expectNoAxeViolations(page, '場所(例外の日・入口)');
});

test('MAP-03 コマンドは確認の後だけ実行し、元に戻せる', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `G4コマンドE2E-${Date.now()}`, { open: false });
  const send = apiClient(context.request, apiBase, token);
  await send('post', `/plans/${planId}/days`, { local_date: '2026-11-03', timezone_id: 'Asia/Tokyo' });
  await page.goto(`/planner/${planId}`);
  await page.waitForURL(new RegExp(`/planner/${planId}$`));
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: '検索' });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('combobox', { name: '検索語' });
  await input.fill('>');
  await expect(dialog.getByRole('listbox', { name: 'コマンド' })).toBeVisible();
  await input.fill('>予定を追加 11/3 10:00 コマンドG4');
  await input.press('Enter');
  const confirm = dialog.getByRole('region', { name: 'コマンドの確認' });
  await expect(confirm).toContainText('コマンドG4');
  const titles = async () => {
    const detail = await send('get', `/plans/${planId}`);
    return (detail.days as Array<{ events: Array<{ title: string }> }>).flatMap((d) => d.events.map((e) => e.title));
  };
  expect(await titles()).not.toContain('コマンドG4'); // 確認だけでは変えない
  await expectNoAxeViolations(page, 'コマンドの確認');
  await confirm.getByRole('button', { name: '実行する' }).click();
  const result = dialog.getByLabel('コマンドの結果');
  await expect(result).toContainText('予定を足しました');
  expect((await titles()).filter((t) => t === 'コマンドG4')).toHaveLength(1);
  await result.getByRole('button', { name: '元に戻す' }).click();
  await expect(dialog.getByLabel('コマンドの結果')).toContainText('元に戻しました');
  expect(await titles()).not.toContain('コマンドG4');
});

test('COL-02 候補の投票を決定して旅程に反映し、元に戻す / COL-03 予定へのコメント', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `G4合意E2E-${Date.now()}`, { open: false });
  const send = apiClient(context.request, apiBase, token);
  const day = await send('post', `/plans/${planId}/days`, { local_date: '2026-11-03', timezone_id: 'Asia/Tokyo' });
  const ev = await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '朝の散歩G4' });
  const cand = await send('post', `/plans/${planId}/candidates`, { title: '錦市場G4' });
  let poll = await send('post', `/plans/${planId}/polls`, { title: '昼ごはんG4', quorum: 1,
    options: [{ candidate_id: cand.id }, { label: '弁当' }] });
  const option = poll.options.find((o: { label: string }) => o.label === '錦市場G4');
  await send('put', `/plans/${planId}/polls/${poll.id}/votes`, { votes: [{ option_id: option.id, value: 'love' }] });
  poll = await send('patch', `/plans/${planId}/polls/${poll.id}`, { decided_option_id: option.id }, { 'If-Match': String(poll.revision) });
  page.on('dialog', (d) => void d.accept());

  await page.goto(`/planner/${planId}/discussion`);
  const card = page.getByRole('region', { name: '昼ごはんG4' });
  await expect(card.getByText('決定', { exact: true }).first()).toBeVisible();
  await card.getByRole('button', { name: '旅程に反映' }).click();
  const adopt = page.getByRole('dialog');
  await adopt.getByLabel('開始の時刻(任意)').fill('12:00');
  await adopt.getByRole('button', { name: '反映の内容を確かめる' }).click();
  await expect(adopt.getByRole('region', { name: '反映の内容' })).toContainText('錦市場G4');
  await expectNoAxeViolations(page, '投票の反映の確認');
  await adopt.getByRole('button', { name: '反映する' }).click();
  await expect(page.getByRole('status').filter({ hasText: '旅程に反映しました' })).toBeVisible();
  const events = async () => ((await send('get', `/plans/${planId}`)).days as Array<{ events: Array<{ title: string }> }>)
    .flatMap((d) => d.events.map((e) => e.title));
  expect(await events()).toContain('錦市場G4');
  await page.getByRole('region', { name: '昼ごはんG4' }).getByRole('button', { name: '反映を元に戻す' }).click();
  await expect(page.getByRole('status').filter({ hasText: '反映を元に戻しました' })).toBeVisible();
  expect(await events()).not.toContain('錦市場G4');

  await page.goto(`/planner/${planId}/discussion?target=event&id=${ev.id}`);
  await expect(page.getByRole('note').filter({ hasText: 'この予定へのコメント' })).toBeVisible();
  await page.getByRole('textbox').first().fill('集合は駅でG4');
  await page.getByRole('button', { name: 'コメントする' }).click();
  await expect(page.getByText('集合は駅でG4')).toBeVisible();
  // [Gate G7] 画面に出た直後は保存の応答の前のことがある(G7 の予行で1回)。保存されるまで待って確かめる
  await expect.poll(async () => (await send('get', `/plans/${planId}/comments?target_type=event&target_id=${ev.id}`))
    .map((c: { body: string }) => c.body)).toEqual(['集合は駅でG4']);
  const planComments = await send('get', `/plans/${planId}/comments?target_type=plan`);
  expect(planComments).toEqual([]);
});

test('COL-05 ゲストの閲覧は見直しで使用回数を使わず、複製・報告ができる / COL-03 通知の設定', async ({ page, browser }) => {
  const member = await registerMember(page, 'g4share');
  const send = apiClient(page.request, member.apiBase, member.token);
  const plan = await send('post', '/travel-plans/', { title: `G4共有E2E-${Date.now()}` });
  const day = await send('post', `/plans/${plan.id}/days`, { local_date: '2026-11-03', timezone_id: 'Asia/Tokyo' });
  await send('post', `/plans/${plan.id}/events`, { day_id: day.id, title: '伏見稲荷G4', local_start_time: '09:00' });
  const share = await send('post', `/travel-plans/${plan.id}/share`, { allow_clone: true });
  const url = share.url as string;

  const anonymous = await browser.newContext();
  const viewer = await anonymous.newPage();
  await viewer.goto(url);
  await expect(viewer.getByText('伏見稲荷G4')).toBeVisible();
  await viewer.getByRole('button', { name: '最新を読み込む' }).click();
  await expect(viewer.getByRole('status').filter({ hasText: '最新の内容を読み込みました' })).toBeVisible();
  await viewer.getByRole('button', { name: '最新を読み込む' }).click();
  const links = await send('get', `/travel-plans/${plan.id}/share`);
  expect(links.find((l: { id: string }) => l.id === share.id).use_count).toBe(1);
  await viewer.getByRole('button', { name: '自分の旅行として複製' }).click();
  await expect(viewer.getByRole('alert')).toContainText('ログインしてからこのリンクを開き直してください');
  await viewer.getByRole('button', { name: '問題を報告' }).click();
  await viewer.getByLabel('問題の種類').selectOption('spam');
  await viewer.getByRole('button', { name: '報告する' }).click();
  await expect(viewer.getByRole('status').filter({ hasText: '問題の報告を受け付けました' })).toBeVisible();
  await expectNoAxeViolations(viewer, 'ゲストの閲覧');
  await anonymous.close();

  // ログインしている人(ここでは所有者)は許された項目だけを複製できる
  await page.goto(url);
  await page.getByRole('button', { name: '自分の旅行として複製' }).click();
  await expect(page.getByRole('status').filter({ hasText: '複製しました' })).toBeVisible();
  const plans = await send('get', '/travel-plans/');
  expect((plans.plans as Array<{ title: string }>).map((p) => p.title)).toContain(`${plan.title}(共有から複製)`);

  await page.goto('/notifications');
  const settings = page.getByRole('region', { name: '通知の設定' });
  await expect(settings).toBeVisible();
  await settings.getByLabel(/自分あてだけ/).check();
  await expect(settings.getByRole('status')).toHaveText('通知の設定を保存しました');
  expect((await send('get', '/notifications/settings')).level).toBe('mentions');
  await expectNoAxeViolations(page, '通知の設定');
});
