import { test, expect, type Page } from '@playwright/test';
import { apiClient, registerMember } from './support/api';

/**
 * [#185・監査 2026-11-23 §4.B] 旅程の地図の上の欄が、幅を変えても互いに重ならないことを「座標」で確かめる。
 * DOM に要素があるかではなく、見えている箱(getBoundingClientRect)が重ならないか・地図の枠からはみ出さないか・
 * 凡例の語が 1 字ずつ折れていないか(1 行の高さ)を測る。
 * 幅: 375(スマホ)・760(狭い画面の上限)・761(2 列の下限)・820(タブレット縦)・1024・1180・1280・1440(PC)。
 * 2 列の時は画面が広くても地図は狭いので、地図の枠の幅で並びを切り替える(timeline.css の @container tcmap)。
 * 予定を選んだ時(選んだ予定の欄)も測る。
 */
type Box = { name: string; x: number; y: number; w: number; h: number };

async function boxes(page: Page): Promise<{ frame: Box; items: Box[]; legendHeights: number[] }> {
  return page.evaluate(() => {
    const frameEl = document.querySelector('[data-testid="planner-map"]')!;
    const box = (name: string, e: Element) => { const b = e.getBoundingClientRect(); return { name, x: b.left, y: b.top, w: b.width, h: b.height }; };
    const visible = (e: Element) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
    const items: Box[] = [];
    const add = (name: string, sel: string) => frameEl.querySelectorAll(sel).forEach((e, i) => { if (visible(e)) items.push(box(`${name}${i}`, e)); });
    add('chip', '.tc-mapov-chip');
    add('action', '.tc-map-action');
    add('zoom', '.leaflet-control-zoom');
    add('check', '.tc-mapov-check');
    add('sel', '.tc-mapov-sel');
    add('next', '.tc-mapov-next');
    add('foot', '.tc-planmap-foot');
    const legendHeights = [...frameEl.querySelectorAll('.tc-mapov-legend, .tc-mapov-date')].map((e) => e.getBoundingClientRect().height);
    return { frame: box('frame', frameEl), items, legendHeights };
  });
}

function overlaps(a: Box, b: Box): boolean {
  const pad = 1; // 境目の 1px は許す
  return a.x + a.w - pad > b.x && b.x + b.w - pad > a.x && a.y + a.h - pad > b.y && b.y + b.h - pad > a.y;
}

async function expectNoOverlap(page: Page, label: string) {
  const { frame, items, legendHeights } = await boxes(page);
  expect(items.length, `${label}: 地図の上の欄が見えない`).toBeGreaterThan(2);
  for (const it of items) {
    // 地図の枠の中に収まる(枠は overflow: hidden。はみ出した分は切れて読めない)
    expect(it.x, `${label}: ${it.name} が左にはみ出す`).toBeGreaterThanOrEqual(frame.x - 1);
    expect(it.x + it.w, `${label}: ${it.name} が右にはみ出す`).toBeLessThanOrEqual(frame.x + frame.w + 1);
    expect(it.y + it.h, `${label}: ${it.name} が下にはみ出す`).toBeLessThanOrEqual(frame.y + frame.h + 1);
  }
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]!; const b = items[j]!;
      if (a.name.startsWith('action') && b.name.startsWith('action')) continue; // 同じ並びの中の隣
      expect(overlaps(a, b), `${label}: ${a.name} と ${b.name} が重なる ${JSON.stringify([a, b])}`).toBe(false);
    }
  }
  // 凡例・日付は 1 行(1 字ずつ縦に折れていない)
  for (const h of legendHeights) expect(h, `${label}: 凡例が折れている`).toBeLessThan(30);
}

test('旅程の地図: 375〜1440px の 8 つの幅で、上の欄が重ならず枠に収まる(予定を選んだ時も)', async ({ page }) => {
  test.setTimeout(150_000);
  const me = await registerMember(page, 'mapov');
  const send = apiClient(page.request, me.apiBase, me.token);
  const plan = await send('post', '/travel-plans/', { title: '伊勢神宮とおかげ横丁をめぐる長い名前の旅行', destination: '伊勢' }) as { id: string };
  const base = `/plans/${plan.id}`;
  const d1 = await send('post', `${base}/days`, { local_date: '2026-11-28', timezone_id: 'Asia/Tokyo' }) as { id: string };
  await send('post', `${base}/events`, { day_id: d1.id, title: '伊勢神宮 内宮(皇大神宮)の参拝と五十鈴川の御手洗場', local_start_time: '09:30', latitude: 34.4551, longitude: 136.7258 });
  await send('post', `${base}/events`, { day_id: d1.id, title: 'おかげ横丁', local_start_time: '12:00', latitude: 34.4622, longitude: 136.7243 });

  for (const width of [375, 760, 761, 820, 1024, 1180, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/planner/${plan.id}`);
    const map = page.getByTestId('planner-map');
    await expect(map).toBeVisible({ timeout: 20_000 });
    await map.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('map-chip')).toBeVisible();
    // 地図が潰れていない(2 列の時も 300px 以上)
    expect((await map.boundingBox())!.width, `${width}px: 地図が狭すぎる`).toBeGreaterThanOrEqual(300);
    await expectNoOverlap(page, `${width}px`);
    // 旅程チェックを開いた時(狭い画面では初めはたたんである)
    const fold = page.getByRole('button', { name: 'チェックを開く' });
    if (await fold.isVisible().catch(() => false)) {
      await fold.click();
      await expectNoOverlap(page, `${width}px(チェックを開いた)`);
    }
    // 予定を選んだ時(選んだ予定の欄が出る)
    await page.getByRole('listitem', { name: /おかげ横丁/ }).first().click();
    await expectNoOverlap(page, `${width}px(予定を選んだ)`);
  }
});
