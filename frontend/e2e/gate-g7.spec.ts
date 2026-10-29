import { test, expect, type Locator, type Page, type Request } from '@playwright/test';
import { apiClient, registerAccount, type Send } from './support/api';
import { expectNoAxeViolations } from './support/axe';

/**
 * [Gate G7] 外部の判断の要らない残り(移動・最適化・案の比較・記録・削除)を、実際のブラウザで確かめる。
 *   1. MOVE-03 既定の滞在・休憩・疲れ: 「制約」の画面で既定を見て変え、検証で休憩の無い連続と日ごとの疲れの目安が出る
 *   2. FR-005 予定のドラッグで並べ替え(実際のブラウザのドラッグ)・終了時刻を翌日にする(保存の前に影響を確かめる)
 *   3. MOVE-04 条件(目的の重み)を変えて計算し、選んだ予定だけを確かめてから適用する
 *   4. FR-019 案を選んで本案と比べる(移動・検証・費用)。案で予定を外して保存すると、比較に外した分が出る
 *   5. MEM-03 過去の旅の移動の遅れから、区間の前の余裕を足す提案を適用する
 *   6. FR-039 14日後の削除を申し込み、読み込み直しても残り、取り消せる
 */

const PASSWORD = 'Gate-G7-TestPass-1';

type Detail = { revision: number; days: Array<{ id: string; events: Array<Record<string, unknown> & { id: string; title: string; sort_order: number }> }> };

async function member(page: Page, label: string): Promise<{ send: Send; apiBase: string; token: string }> {
  const a = await registerAccount(page, { prefix: 'g7', label, password: PASSWORD });
  return { send: apiClient(page.request, a.apiBase, a.token), apiBase: a.apiBase, token: a.token };
}

/** 読み込み中の要求の数(更新を受け取り続ける常時の接続 `/events/stream` は数えない) */
function trackPendingRequests(page: Page): () => number {
  const open = new Set<Request>();
  const counted = (r: Request) => !r.url().includes('/events/stream');
  page.on('request', (r) => { if (counted(r)) open.add(r); });
  page.on('requestfinished', (r) => open.delete(r));
  page.on('requestfailed', (r) => open.delete(r));
  return () => open.size;
}

/** 読み込み中の要求が無く、要素の位置が続けて同じになるまで待つ(画面の配置が決まってから座標を測る) */
async function waitLayoutSettled(page: Page, el: Locator, pending: () => number): Promise<void> {
  let last = '';
  await expect.poll(async () => {
    const box = await el.boundingBox();
    const now = `${pending()}|${box ? Math.round(box.y) : 'none'}`;
    const settled = pending() === 0 && now === last;
    last = now;
    return settled;
  }, { message: '画面の配置が決まらない(読み込み中の要求が残る・位置が動き続ける)', intervals: [150], timeout: 20_000 }).toBe(true);
}

const titles = (d: Detail, day = 0) => d.days[day]!.events.slice().sort((x, y) => x.sort_order - y.sort_order).map((e) => e.title);

test('MOVE-03・FR-005 既定の滞在と疲れ、ドラッグの並べ替え、翌日に終わる予定と影響の確認', async ({ page }) => {
  test.setTimeout(180_000);
  const { send } = await member(page, 'move');
  const plan = await send('post', '/travel-plans/', { title: `滋賀G7-${Date.now()}` }) as { id: string };
  const base = `/plans/${plan.id}`;
  const day = await send('post', `${base}/days`, { local_date: '2026-11-21', timezone_id: 'Asia/Tokyo' }) as { id: string };
  for (const [title, time] of [['酒蔵A', '09:00'], ['酒蔵B', '10:00'], ['酒蔵C', '11:00'], ['酒蔵D', '12:00']] as const) {
    await send('post', `${base}/events`, { day_id: day.id, title, event_type: 'sightseeing', local_start_time: time });
  }

  // 1. 既定の滞在・休憩・疲れ
  await page.goto(`/planner/${plan.id}/constraints`);
  await expect(page.getByTestId('movement-summary')).toContainText('休憩なしは180分まで');
  await page.getByRole('button', { name: '検証する' }).click();
  await expect(page.getByTestId('day-metric')).toContainText('2026-11-21');
  await expect(page.getByTestId('day-metric')).toContainText('見積もりを含む');
  await expect(page.getByText(/休憩\(15分以上の空きか食事\)がありません/).first()).toBeVisible();
  await page.getByRole('button', { name: '既定を見る・変える' }).click();
  await page.getByRole('radio', { name: /ゆっくり/ }).check();
  await page.getByLabel('観光の既定の滞在(分)').fill('45');
  await page.getByRole('button', { name: '既定を保存' }).click();
  await expect(page.getByRole('status').filter({ hasText: '保存しました' })).toBeVisible();
  await expect(page.getByTestId('movement-summary')).toContainText('休憩なしは150分まで');
  const saved = await send('get', `${base}/movement-settings`) as { revision: number; settings: { pace: string; stay_minutes: Record<string, number> } };
  expect(saved.revision).toBe(1);
  expect(saved.settings.pace).toBe('relaxed');
  expect(saved.settings.stay_minutes.sightseeing).toBe(45);
  await expectNoAxeViolations(page, '制約(移動・滞在の既定・日ごとの疲れ)');

  // 2. ドラッグで並べ替え(酒蔵A を 酒蔵C の前へ)
  const pending = trackPendingRequests(page);
  await page.goto(`/planner/${plan.id}`);
  const list = page.getByRole('list', { name: /の予定$/ });
  const source = list.getByRole('listitem', { name: '酒蔵A(上下矢印キーで並べ替え)' });
  await expect(source).toBeVisible();
  // 一覧の上の非同期の表示(利用枠・表紙など)が読み終わって位置が決まってから座標を測る。
  // 読み終わる前に測ると、表示が現れて一覧が下へずれ、落とし先の座標が古くなる(#10 の見立て。サンドボックスで再現・確認。docs/trace/gate-e2e-drag-trace.md)
  await waitLayoutSettled(page, source, pending);
  // 並べ替える予定を画面に出してから、実際のマウスでドラッグする(座標は画面の中だけ)
  await source.hover();
  const box = (await source.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 30, { steps: 5 });
  const gaps = list.locator('div.border-dashed');
  await expect(gaps).toHaveCount(5);
  const gap = (await gaps.nth(2).boundingBox())!;
  await page.mouse.move(gap.x + gap.width / 2, gap.y + gap.height / 2, { steps: 10 });
  await page.mouse.up();
  // [Gate G11 段階7] ドラッグは保存する前の案を作る。サーバーの順は「この並びにする」まで変えない
  await expect(page.getByTestId('reorder-preview')).toContainText('「酒蔵A」 1番目 → 2番目');
  expect(titles(await send('get', `/plans/${plan.id}`) as Detail)).toEqual(['酒蔵A', '酒蔵B', '酒蔵C', '酒蔵D']);
  await page.getByTestId('reorder-apply').click();
  await expect(page.getByText('スケジュールを並び替えました')).toBeVisible();
  await expect.poll(async () => titles(await send('get', `/plans/${plan.id}`) as Detail)).toEqual(['酒蔵B', '酒蔵A', '酒蔵C', '酒蔵D']);

  // 3. 翌日に終わる予定(保存の前に影響を確かめる)
  await list.getByRole('listitem', { name: '酒蔵D(上下矢印キーで並べ替え)' }).click();
  const modal = page.getByRole('dialog', { name: 'スポットを編集' });
  await modal.getByLabel('終了時刻').fill('01:30');
  await modal.getByLabel('終わる日').selectOption('1');
  await modal.getByRole('button', { name: '変更の影響を確かめる' }).click();
  const impact = modal.getByRole('status', { name: '変更の影響' });
  await expect(impact).toContainText('終了は開始の1日後です(日をまたぐ予定)');
  await expect(impact.getByRole('list', { name: '新たに出る問題' })).toBeVisible();
  const before = await send('get', `/plans/${plan.id}`) as Detail;
  await expectNoAxeViolations(page, '予定の編集(終了時刻・影響の確認)');
  await modal.getByRole('button', { name: '保存', exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(list.getByRole('listitem', { name: '酒蔵D(上下矢印キーで並べ替え)' })).toContainText('(翌日)');
  const after = await send('get', `/plans/${plan.id}`) as Detail;
  expect(after.revision).toBe(before.revision + 1);
  const d = after.days[0]!.events.find((e) => e.title === '酒蔵D')!;
  expect(d.local_end_time).toBe('01:30');
  expect(d.end_day_offset).toBe(1);
});

test('MOVE-04・FR-019 条件を変えた計算・選んだ予定だけの適用、案と本案の比較', async ({ page }) => {
  test.setTimeout(180_000);
  const { send } = await member(page, 'opt');
  const plan = await send('post', '/travel-plans/', { title: `京都G7-${Date.now()}` }) as { id: string };
  const base = `/plans/${plan.id}`;
  const day = await send('post', `${base}/days`, { local_date: '2026-11-01', timezone_id: 'Asia/Tokyo' }) as { id: string };
  const lon: Record<string, number> = { A: 135.70, B: 135.711, C: 135.722, D: 135.733 };
  for (const [name, time] of [['A', '09:00'], ['C', '10:00'], ['B', '11:00'], ['D', '12:00']] as const) {
    await send('post', `${base}/events`, {
      day_id: day.id, title: `地点${name}`, event_type: 'sightseeing', local_start_time: time, latitude: 35.0, longitude: lon[name] });
  }

  // 3. 条件を変えて計算し、選んだ予定だけを確かめてから適用する
  await page.goto(`/planner/${plan.id}`);
  await page.getByRole('button', { name: /この日の並べ替え/ }).click();
  await page.getByRole('button', { name: '並べ替え候補を計算する' }).click();
  await expect(page.getByRole('list', { name: /の目的の内訳$/ }).first()).toContainText('移動距離');
  await page.getByRole('button', { name: '条件を変える(目的の重み)' }).click();
  await page.getByLabel('移動距離').selectOption('5');
  await page.getByLabel('検証・制約').selectOption('0');
  await page.getByRole('button', { name: 'この条件で計算する' }).click();
  const fit = page.getByRole('region', { name: /条件に合わせた案/ });
  await expect(fit).toBeVisible({ timeout: 15_000 });
  await expect(fit.getByRole('list', { name: /の目的の内訳$/ })).toContainText('重み5');
  const before = await send('get', base) as Detail;
  const pick = fit.getByRole('checkbox').first();
  const pickedTitle = ((await pick.locator('xpath=..').innerText()).split(':')[0] ?? '').trim();
  await pick.check();
  await fit.getByRole('button', { name: '選んだ1件だけ動かした結果を確かめる' }).click();
  await expect(fit.getByRole('status')).toContainText('選んだ予定だけ: 移動距離');
  expect((await send('get', base) as Detail).revision).toBe(before.revision); // 確かめるだけでは変わらない
  await expectNoAxeViolations(page, '並べ替え(条件・一部だけ)');
  page.once('dialog', (dlg) => dlg.accept());
  await fit.getByRole('button', { name: '選んだ予定だけ適用' }).click();
  await expect(page.getByText(/のうち1件を適用しました/)).toBeVisible({ timeout: 15_000 });
  const after = await send('get', base) as Detail;
  expect(after.revision).toBe(before.revision + 1);
  const moved = (t: Detail) => t.days[0]!.events.find((e) => e.title === pickedTitle)!;
  expect([moved(after).sort_order, moved(after).local_start_time])
    .not.toEqual([moved(before).sort_order, moved(before).local_start_time]);
  // 選ばなかった予定は動かない(時刻)
  for (const e of before.days[0]!.events.filter((x) => x.title !== pickedTitle)) {
    expect(after.days[0]!.events.find((x) => x.id === e.id)!.local_start_time).toBe(e.local_start_time);
  }

  // 4. 案を作って本案と比べる
  const branch = await send('post', `${base}/branches`, { title: '雨の日G7', scenario_type: 'custom', assumptions: {} }) as { id: string };
  await page.goto(`/planner/${plan.id}/branches`);
  await page.getByRole('checkbox', { name: '「雨の日G7」を比べる' }).check();
  await page.getByRole('button', { name: '選んだ案(1/3)を本案と比べる' }).click();
  const table = page.getByRole('table', { name: '本案と案の比較' });
  await expect(table.getByRole('columnheader', { name: '雨の日G7' })).toBeVisible();
  await expect(table.getByRole('row', { name: /移動\(概算\)/ })).toContainText('km');
  await expect(page.getByRole('group', { name: '雨の日G7の違い' })).toContainText('検証の結果は本案と変わりません。');
  await expectNoAxeViolations(page, '案の一覧(本案との比較)');

  await page.goto(`/planner/${plan.id}/branches/${branch.id}`);
  const item = page.locator('[data-testid^="branch-item-"]').filter({ has: page.locator('input[value="地点D"]') });
  await item.getByRole('button', { name: '外す' }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('list', { name: '変更の一覧' })).toContainText('外す: 地点D');
  await page.getByRole('button', { name: '移動・検証・費用で比べる' }).click();
  const cmp = page.getByRole('table', { name: '本案と案の比較' });
  await expect(cmp.getByRole('row', { name: /^変更/ })).toContainText('外す1');
  await expectNoAxeViolations(page, '案の詳細(本案との比較)');
});

test('MEM-03・FR-039 移動の遅れの傾向から余裕を足す、14日後の削除の申し込みと取り消し', async ({ page }) => {
  test.setTimeout(180_000);
  const { send, apiBase, token } = await member(page, 'mem');
  const stamp = Date.now();
  const trip = async (title: string, date: string, items: Array<[string, string, string | null]>, buses: Array<[string, string]>) => {
    const plan = await send('post', '/travel-plans/', { title }) as { id: string };
    const day = await send('post', `/plans/${plan.id}/days`, { local_date: date, timezone_id: 'Asia/Tokyo' }) as { id: string };
    const ids: Record<string, string> = {};
    for (const [name, time, actual] of items) {
      const ev = await send('post', `/plans/${plan.id}/events`, { day_id: day.id, title: name, event_type: 'sightseeing', local_start_time: time }) as { id: string };
      ids[name] = ev.id;
      if (actual) {
        await send('put', `/plans/${plan.id}/journey/events/${ev.id}`, { status: 'visited', actual_start_at: `${date}T${actual}:00+09:00` });
      }
    }
    const segs: string[] = [];
    for (const [from, to] of buses) {
      const s = await send('post', `/plans/${plan.id}/segments`, { from_event_id: ids[from], to_event_id: ids[to], mode: 'bus' }) as { id: string };
      segs.push(s.id);
    }
    return { plan, segs };
  };
  await trip(`彦根-${stamp}`, '2025-04-01', [['駅', '09:00', '09:00'], ['城', '10:00', '10:20'], ['庭', '12:00', '12:25']], [['駅', '城'], ['城', '庭']]);
  await trip(`長浜-${stamp}`, '2025-05-01', [['駅', '09:00', '09:00'], ['寺', '10:00', '10:15']], [['駅', '寺']]);
  const next = await trip(`近江八幡-${stamp}`, '2026-11-21', [['堀', '10:00', null], ['山', '13:00', null]], [['堀', '山']]);

  // 5. 移動の遅れの傾向から、区間の前の余裕を足す
  await page.goto(`/planner/${next.plan.id}/memory-replan`);
  const insights = page.getByRole('region', { name: '見つかった傾向' });
  await expect(insights).toContainText('バスの後は、予定より平均20分遅れて着いています');
  await expect(insights).toContainText('同じ同行者(1人)の旅行の');
  const proposal = page.getByRole('region', { name: 'この旅行への提案' });
  const row = proposal.getByRole('row', { name: /堀 → 山/ });
  await expect(row).toContainText('前の余裕0分');
  await expect(row).toContainText('前の余裕20分');
  await expectNoAxeViolations(page, '過去の旅からの提案(移動の傾向)');
  page.once('dialog', (dlg) => dlg.accept());
  await proposal.getByRole('button', { name: 'この提案を適用' }).first().click();
  await expect(page.getByRole('status')).toContainText('移動1件の前の余裕を足しました');
  const seg = await send('get', `/plans/${next.plan.id}/segments/${next.segs[0]}`) as { buffer_before_minutes: number };
  expect(seg.buffer_before_minutes).toBe(20);

  // 6. 14日後の削除を申し込み、取り消す
  await page.goto('/settings/data');
  await page.getByRole('button', { name: '削除の内容を確認する' }).click();
  await page.getByLabel(/確認のため/).fill('退会する');
  await page.getByLabel('現在のパスワード').fill(PASSWORD);
  await page.getByRole('button', { name: '14日後に削除する(取り消せる)' }).click();
  await expect(page.getByRole('status').filter({ hasText: '削除を申し込みました' })).toBeVisible();
  await expect(page.getByTestId('deletion-scheduled')).toContainText('に削除されます。それまでは、いつも通り使えます。');
  await page.reload();
  await expect(page.getByTestId('deletion-scheduled')).toBeVisible({ timeout: 15_000 });
  expect((await page.request.get(`${apiBase}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(200);
  await expectNoAxeViolations(page, 'データとプライバシー(削除の申し込み)');
  await page.getByRole('button', { name: '削除の申し込みを取り消す' }).click();
  await expect(page.getByRole('status').filter({ hasText: '削除の申し込みを取り消しました。' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '削除の内容を確認する' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('deletion-scheduled')).toHaveCount(0);
});
