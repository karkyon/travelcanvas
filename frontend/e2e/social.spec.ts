import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { apiClient, registerMember } from './support/api';

/**
 * [FR-063] SNS の下書きとリール の browser E2E(提供元は使わない。動画は端末の Canvas と MediaRecorder で作る)。
 *   1. 旅の記録から「SNS の下書き・リールを作る」→ 選ぶ(写真 3 枚)→ 文(ひな形・字数の目安・ハッシュタグの札)
 *   2. リール: 15 秒で「動画を作る」→ 端末で作れて「保存」が出る(Chromium の headless は WebM になる)。
 *      音楽は付けない文。書き出しの記録は数だけを送る
 *   3. X は文だけ(リールの段が無い)
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test('SNS: 旅の記録から下書きの文を作り、端末でリールを作って保存できる', async ({ page }) => {
  test.setTimeout(120_000);
  const me = await registerMember(page, 'social');
  const send = apiClient(page.request, me.apiBase, me.token);
  const plan = await send('post', '/travel-plans/', { title: `伊勢の旅E2E-${Date.now()}`, destination: '伊勢' }) as { id: string };
  const base = `/plans/${plan.id}`;
  const d1 = await send('post', `${base}/days`, { local_date: '2026-11-28', timezone_id: 'Asia/Tokyo' }) as { id: string };
  for (const place of ['内宮', 'おかげ横丁', '赤福 本店']) {
    const up = await page.request.post(`${me.apiBase}${base}/memories/upload`, {
      headers: { Authorization: `Bearer ${me.token}` },
      multipart: { kind: 'photo', day_id: d1.id, place_name: place, file: { name: `${place}.png`, mimeType: 'image/png', buffer: PNG } },
    });
    expect(up.status(), await up.text()).toBe(201);
  }

  await page.goto(`/planner/${plan.id}/journey`);
  await page.getByTestId('journey-social').click();
  await expect(page.getByRole('heading', { name: 'SNS の下書きとリール', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('写真(3 / 3〜20 枚)')).toBeVisible();
  await expectNoAxeViolations(page, 'SNS(選ぶ)');
  await page.getByRole('button', { name: '次へ(文)' }).click();
  const area = page.getByLabel('投稿の文(そのまま直せます)');
  await expect(area).toHaveValue(/^伊勢へ日帰り。|^伊勢へ/);
  await expect(area).toHaveValue(/#旅の記録/);
  await expect(page.getByTestId('social-count')).toContainText('/ 4,000 字');
  await expectNoAxeViolations(page, 'SNS(文)');
  await page.getByRole('button', { name: '次へ(リール)' }).click();
  await expect(page.getByText('音楽は TikTok・Instagram のアプリで付けてください')).toBeVisible();
  await page.getByRole('button', { name: '15 秒' }).click();
  const recorded = page.waitForResponse((r) => r.request().method() === 'POST' && /\/reel-exports$/.test(new URL(r.url()).pathname),
    { timeout: 90_000 });
  await page.getByTestId('reel-make').click();
  const rec = await recorded;
  expect(rec.status()).toBe(201);
  const body = rec.request().postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ style: 'tiktok', frame_count: 3, renderer: 'device', status: 'ready' });
  expect(JSON.stringify(body)).not.toContain('memory');
  await expect(page.getByTestId('reel-result')).toBeVisible();
  await expect(page.getByRole('link', { name: '保存' })).toHaveAttribute('download', /\.(mp4|webm)$/);
  await expectNoAxeViolations(page, 'SNS(リール)');

  // X は文だけ
  await page.getByRole('button', { name: '1 選ぶ' }).click();
  await page.getByTestId('social-style-x').click();
  await expect(page.getByRole('button', { name: '3 リール' })).toHaveCount(0);
});
