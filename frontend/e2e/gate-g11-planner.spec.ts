import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { apiClient, registerMember } from './support/api';

/**
 * [Gate G11] 旅程の画面(docs/ux/G11_UIUX全範囲_実装仕様.md §3.2、UIX-M02〜M07・M11。FR-005・FR-008・FR-014・FR-017)。
 *
 *   1. 営業時間を登録した場所の予定に「営業時間内」、閉店の後に着く予定に「閉まった後」の帯が、出典と一緒に出る
 *   2. 予定へ着く移動に名前が出る(新幹線は明示した区間だけ・鉄道は「鉄道」)。日の見出しに現地の時刻帯が出る
 *   3. 時差をまたぐ飛行機の区間は、出発地・到着地の現地の日時を、同じ瞬間から求めて並べる(夏時間の終わった後の UTC−5)
 *   4. 「下へ」のボタンは保存する前の案を作る(前後が合わなくなる区間を先に示し、サーバーの順は変えない)。「やめる」で何も変えず、
 *      「この並びにする」で保存し、実際の影響(順の変化・営業時間・区間)を出し、「元に戻す」でサーバーの順も元へ戻る。
 *      移動はタイムラインの独立した行
 *   7. 高速バス(express_bus)の区間を保存でき、「高速バス」とアイコン(絵文字ではない)が出る(路線バスと区別する)
 *   5. 「全日程」で日を同じ時刻の物差しで並べ、予定を押すとその日の日別へ戻る
 *   6. 幅 360px・暗い見た目で横にはみ出さない。axe 違反 0
 */
test('旅程: 営業時間の帯・移動手段の名前・時差・触る並べ替え・全日程のチャート', async ({ page }) => {
  test.setTimeout(180_000);
  const me = await registerMember(page, 'g11plan');
  const send = apiClient(page.context().request, me.apiBase, me.token);
  const plan = await send('post', '/travel-plans/', { title: `G11旅程E2E-${Date.now()}`, destination: '京都' });
  const base = `/plans/${plan.id}`;
  const d1 = await send('post', `${base}/days`, { local_date: '2026-11-16', timezone_id: 'Asia/Tokyo' });  // 月曜
  const d2 = await send('post', `${base}/days`, { local_date: '2026-11-17', timezone_id: 'America/New_York' });

  // 営業時間のある場所の予定(候補から旅程へ)
  const addPlace = async (title: string, time: string, eventType: string) => {
    const cand = await send('post', `${base}/candidates`, { title, address: '京都市' });
    const s = await send('post', `${base}/candidates/${cand.id}/schedule`, { day_id: d1.id, event_type: eventType },
      { 'If-Match': '1' });  // 作ったばかりの候補の revision は 1
    const place = await send('get', `/places/${s.place_id}`);
    await send('put', `/places/${s.place_id}/opening-hours`, { hours: [
      { day_of_week: 0, open_time: title === '夕食' ? '17:00' : '09:00', close_time: '18:00' }] },
    { 'If-Match': String(place.revision) });
    const rev2 = (await send('get', base)).revision;
    await send('put', `${base}/events/${s.event_id}`, { local_start_time: time }, { 'If-Match': String(rev2) });
    return s.event_id as string;
  };
  const kiyomizu = await addPlace('清水寺', '09:30', 'sightseeing');
  const dinner = await addPlace('夕食', '18:30', 'dining');
  const kyotoSt = (await send('post', `${base}/events`, { day_id: d1.id, title: '京都駅', local_start_time: '20:00' })).id;
  const ny = (await send('post', `${base}/events`, { day_id: d2.id, title: 'ニューヨーク着', local_start_time: '00:15' })).id;
  await send('post', `${base}/segments`, { from_event_id: kiyomizu, to_event_id: dinner, mode: 'train', duration_minutes: 25 });
  await send('post', `${base}/segments`, { from_event_id: dinner, to_event_id: kyotoSt, mode: 'shinkansen', duration_minutes: 15 });
  await send('post', `${base}/segments`, {
    from_event_id: kyotoSt, to_event_id: ny, mode: 'flight', planned_departure_at: '2026-11-16T13:45:00Z', duration_minutes: 870,
  });
  // 7. 2日目の中の高速バス(到着の後の移動)
  const hotel = (await send('post', `${base}/events`, { day_id: d2.id, title: 'ボストンの宿', local_start_time: '06:00' })).id;
  await send('post', `${base}/segments`, { from_event_id: ny, to_event_id: hotel, mode: 'express_bus', duration_minutes: 255 });

  await page.goto(`/planner/${plan.id}`);
  const list = page.getByRole('list', { name: /の予定$/ });
  await expect(list).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('day-timezone')).toHaveText('現地時間 · Asia/Tokyo');

  // 1. 営業時間の帯
  const card = (title: string) => list.getByRole('listitem', { name: `${title}(上下矢印キーで並べ替え)` });
  await expect(card('清水寺').getByTestId('schedule-hours')).toContainText('営業時間内 · 09:00〜18:00', { timeout: 20_000 });
  await expect(card('清水寺').getByTestId('schedule-hours')).toHaveAttribute('data-tone', 'good');
  await expect(card('夕食').getByTestId('schedule-hours')).toContainText('閉まった後に着く予定(17:00〜18:00)');
  await expect(card('夕食').getByTestId('schedule-hours')).toContainText('確認');
  await expect(card('京都駅').getByTestId('schedule-hours')).toHaveCount(0);

  // 2. 移動手段の名前(予定の前の独立した行)
  const segRow = (eventId: string) => list.locator(`[data-testid="segment-row"][data-to-event="${eventId}"]`);
  await expect(segRow(dinner)).toContainText('鉄道 · 25分');
  await expect(segRow(dinner)).toContainText('「清水寺」から');
  await expect(segRow(kyotoSt)).toContainText('新幹線 · 15分');
  await expect(list.getByTestId('segment-mismatch')).toHaveCount(0);
  await expectNoAxeViolations(page, '旅程(営業時間の帯・移動手段)');

  // 4. 触る並べ替え(夕食を京都駅の後へ)
  const original = ['清水寺', '夕食', '京都駅'];
  const serverOrder = async () => (await send('get', base)).days[0].events.map((e: { title: string }) => e.title);
  // 案(保存しない) → やめる
  await page.getByRole('button', { name: '「夕食」を下へ移す' }).click();
  await expect(page.getByTestId('reorder-status')).toContainText('「夕食」を3番目へ動かす案にしました。まだ保存していません');
  const preview = page.getByTestId('reorder-preview');
  await expect(preview.getByTestId('reorder-preview-segments')).toContainText('前後が合わなくなる移動の区間が2件あります');
  await expect(preview.getByTestId('reorder-preview-hours')).toContainText('営業時間の判定は変わりません');
  await expectNoAxeViolations(page, '並べ替えの案');
  expect(await serverOrder()).toEqual(original);
  await preview.getByTestId('reorder-cancel').click();
  await expect(page.getByTestId('reorder-preview')).toHaveCount(0);
  await expect(list.getByTestId('segment-mismatch')).toHaveCount(0);
  // 案 → この並びにする
  await page.getByRole('button', { name: '「夕食」を下へ移す' }).click();
  await page.getByTestId('reorder-preview').getByTestId('reorder-apply').click();
  await expect(page.getByTestId('reorder-status')).toContainText('この並びを保存しました');
  await expect.poll(async () => (await send('get', base)).days[0].events.map((e: { title: string }) => e.title))
    .toEqual(['清水寺', '京都駅', '夕食']);
  await expect(page.getByTestId('reorder-status')).toContainText('確かめました', { timeout: 20_000 });
  const impact = page.getByTestId('reorder-impact');
  await expect(impact.getByTestId('reorder-impact-moves')).toContainText('「夕食」 2番目 → 3番目');
  await expect(impact.getByTestId('reorder-impact-hours')).toContainText('営業時間の判定に変化はありません');
  await expect(impact.getByTestId('reorder-impact-segments')).toContainText('前後が合わなくなった移動の区間が2件あります');
  await expect(segRow(dinner)).toHaveAttribute('data-mismatch', 'true');
  await expectNoAxeViolations(page, '並べ替えの影響');
  await impact.getByTestId('reorder-undo').click();
  await expect(page.getByTestId('reorder-status')).toContainText('元の並びに戻しました');
  await expect.poll(async () => (await send('get', base)).days[0].events.map((e: { title: string }) => e.title))
    .toEqual(['清水寺', '夕食', '京都駅']);
  await expect(page.getByTestId('reorder-impact')).toHaveCount(0);
  await expect(list.getByTestId('segment-mismatch')).toHaveCount(0);

  // 3. 時差(2日目)
  await page.locator('[data-day="1"]').first().click();
  await expect(page.getByTestId('day-timezone')).toHaveText('現地時間 · America/New_York', { timeout: 20_000 });
  const arrival = segRow(ny).getByTestId('schedule-cross-zone');
  await expect(arrival).toHaveText('11/16 22:45 Tokyo(UTC+9)→ 11/16 23:15 New York(UTC−5)');
  await expect(segRow(ny)).toContainText('「京都駅」から');
  await expect(segRow(ny)).toHaveAttribute('data-mismatch', 'false');
  // 7. 高速バス
  await expect(segRow(hotel)).toContainText('高速バス · 4時間15分');
  await expect(segRow(hotel).getByTestId('transport-icon')).toHaveAttribute('data-mode', 'express_bus');
  expect(await segRow(hotel).textContent()).not.toMatch(/\p{Extended_Pictographic}/u);  // 絵文字に頼らない

  // 5. 全日程
  await page.getByTestId('plan-view-all').click();
  const chart = page.getByTestId('all-days-chart');
  await expect(chart).toBeVisible();
  await expect(page.getByTestId('chart-summary-0')).toContainText('予定 3件・09:30〜');
  await expect(page.getByTestId('chart-day-1')).toContainText('現地時間 · America/New_York');
  await expectNoAxeViolations(page, '全日程の横断チャート');
  await page.getByTestId(`chart-event-${kiyomizu}`).click();
  await expect(chart).toBeHidden();
  await expect(page.getByTestId('day-timezone')).toHaveText('現地時間 · Asia/Tokyo');

  // 6. 360px・暗い見た目
  await page.evaluate(() => window.localStorage.setItem('tc.theme', 'dark'));
  await page.setViewportSize({ width: 360, height: 780 });
  await page.reload();
  await expect(card('清水寺').getByTestId('schedule-hours')).toBeVisible({ timeout: 20_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page, '旅程(360px・暗い見た目)');
  await page.getByTestId('plan-view-all').click();
  await expect(page.getByTestId('all-days-chart')).toBeVisible();
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow2).toBeLessThanOrEqual(0);
});
