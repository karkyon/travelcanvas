import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * [Gate L1b] FR-029/030/032 当日モード(SC-07、NOW/NEXT)のmobile viewport browser E2E。
 *
 * 画面から作った予定と同じ形(local_start_timeのみ、start_atなし)で今日の予定を
 * 作り、スマートフォン幅の画面で次を確認する。
 *   1. NOW/NEXTが表示される(Gate L1ではlocal_start_timeのみの予定が一度も
 *      表示されない不具合があった)
 *   2. 時刻が端末のタイムゾーンではなく日程のIANAタイムゾーンの現地時刻で表示され、
 *      その旨が注記される(端末のタイムゾーンは日程と別にしている)
 *   3. NEXTへ向かう採用済み経路の区間が遅延なら「遅延」と出発時刻・出発までを表示する
 *   4. 通信が切れても保存済みの情報でNOW/NEXTを表示し続け、その旨を表示する
 *   5. 横スクロールが発生しない(mobile幅でレイアウトが崩れない)
 *
 * 実行時刻によって日付境界を跨がないよう、日程のタイムゾーンは候補のうち
 * 現地時刻が正午に最も近いものを選ぶ(候補間の時差は最大3時間程度のため、
 * 現地時刻はおおむね10時〜14時になり、前後2時間の予定が同じ日に収まる)。
 */

const DEVICE_TIME_ZONE = 'Pacific/Kiritimati'; // UTC+14。日程の候補とは必ず異なる

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'ja-JP',
  timezoneId: DEVICE_TIME_ZONE,
});

const ZONE_CANDIDATES = [
  'Pacific/Honolulu', 'America/Los_Angeles', 'America/New_York', 'America/Sao_Paulo', 'Europe/London',
  'Europe/Paris', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Tokyo', 'Australia/Sydney',
  'Pacific/Auckland',
];

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hhmm: `${get('hour')}:${get('minute')}`, hour: Number(get('hour')) + Number(get('minute')) / 60 };
}

function pickZoneNearNoon(now: Date): string {
  return ZONE_CANDIDATES.reduce((best, zone) =>
    Math.abs(localParts(now, zone).hour - 12) < Math.abs(localParts(now, best).hour - 12) ? zone : best
  );
}

const displayTime = (date: Date, timeZone: string) =>
  date.toLocaleTimeString('ja-JP', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });

async function startGuestAndCreatePlan(page: Page, title: string): Promise<{ planId: string; apiBase: string }> {
  await page.goto('/');
  const guestResponse = page.waitForResponse((r) => /\/auth\/guest$/.test(new URL(r.url()).pathname));
  await page.getByRole('button', { name: /ゲストとして始める/ }).click();
  const apiBase = (await guestResponse).url().replace(/\/auth\/guest$/, '');
  await page.waitForURL(/\/planner\/?$/, { timeout: 15_000 });

  const newPlanButton = page.getByRole('button', { name: /新しいプラン/ });
  await newPlanButton.waitFor({ state: 'visible', timeout: 15_000 });
  await newPlanButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('例: 東京旅行').fill(title);
  await dialog.getByRole('button', { name: '作成' }).click();
  await page.waitForURL(/\/planner\/[0-9a-fA-F-]{36}$/, { timeout: 15_000 });
  const match = page.url().match(/\/planner\/([0-9a-fA-F-]{36})/);
  if (!match) throw new Error(`planId をURLから取得できませんでした: ${page.url()}`);
  return { planId: match[1], apiBase };
}

class Api {
  constructor(private request: APIRequestContext, private base: string, private token: string) {}

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.token}`, ...extra };
  }

  async send(method: 'get' | 'post' | 'patch', path: string, data?: unknown, extra: Record<string, string> = {}) {
    const res = await this.request[method](`${this.base}${path}`, { headers: this.headers(extra), data });
    const body = await res.text();
    if (!res.ok()) throw new Error(`${method.toUpperCase()} ${path} -> ${res.status()}: ${body}`);
    return body ? JSON.parse(body) : null;
  }

  async revision(planId: string): Promise<string> {
    return String((await this.send('get', `/plans/${planId}`)).revision);
  }
}

test.describe('当日モード (FR-029/030/032) mobile E2E', () => {
  test('日程の現地時間でNOW/NEXT・遅延・出発までを表示し、オフラインでも表示し続ける', async ({ page, context }) => {
    test.setTimeout(90_000);
    page.on('pageerror', (err) => console.log(`[PAGE ERROR] ${err.message}`));
    page.on('response', (r) => {
      if (r.status() >= 400) console.log(`[HTTP ${r.status()}] ${r.request().method()} ${r.url()}`);
    });

    const suffix = Date.now().toString();
    const { planId, apiBase } = await startGuestAndCreatePlan(page, `L1b当日E2E-${suffix}`);
    const token = await page.evaluate(() => window.localStorage.getItem('auth_token'));
    if (!token) throw new Error('ゲストのアクセストークンがlocalStorage(auth_token)にありません');
    const api = new Api(context.request, apiBase, token);

    const now = new Date();
    const zone = pickZoneNearNoon(now);
    const minute = 60_000;
    const nowStart = new Date(now.getTime() - 60 * minute);
    const nextStart = new Date(now.getTime() + 120 * minute);
    const departure = new Date(Math.floor((now.getTime() + 60 * minute) / minute) * minute);
    const today = localParts(now, zone).date;

    const day = await api.send('post', `/plans/${planId}/days`, { local_date: today, timezone_id: zone });
    const nowTitle = `NOW予定-${suffix}`;
    const nextTitle = `NEXT予定-${suffix}`;
    const nowEvent = await api.send('post', `/plans/${planId}/events`, {
      day_id: day.id, title: nowTitle, local_start_time: localParts(nowStart, zone).hhmm,
    });
    const nextEvent = await api.send('post', `/plans/${planId}/events`, {
      day_id: day.id, title: nextTitle, local_start_time: localParts(nextStart, zone).hhmm,
    });
    const option = await api.send(
      'post',
      `/plans/${planId}/route-options`,
      {
        from_event_id: nowEvent.id,
        to_event_id: nextEvent.id,
        legs: [{ mode: 'train', departure_at: departure.toISOString() }],
      },
      { 'Idempotency-Key': `l1b-e2e-${suffix}` }
    );
    await api.send(
      'patch',
      `/plans/${planId}/route-options/${option.id}/legs/${option.legs[0].id}`,
      { realtime_status: 'delayed' },
      { 'If-Match': await api.revision(planId) }
    );
    await api.send('post', `/plans/${planId}/route-options/${option.id}/adopt`, undefined, {
      'If-Match': await api.revision(planId),
    });

    // 1〜3. NOW/NEXT・現地時間・遅延・出発まで
    await page.goto(`/planner/${planId}/today`);
    await expect(page.getByRole('heading', { name: '今日' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(nowTitle)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(nextTitle)).toBeVisible();
    await expect(page.getByText(`時刻は現地時間(${zone})`, { exact: false })).toBeVisible();
    await expect(page.getByText(localParts(nowStart, zone).hhmm, { exact: true })).toBeVisible();
    await expect(page.getByText('遅延', { exact: true })).toBeVisible();
    await expect(page.getByText(`出発 ${displayTime(departure, zone)}`, { exact: true })).toBeVisible();
    await expect(page.getByText(/^出発 (まもなく|\d+分後|\d+時間(\d+分)?後)$/)).toBeVisible();

    // 5. mobile幅で横スクロールが発生しない
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // 4. オフラインでも保存済みの情報で表示し続ける
    await context.setOffline(true);
    await page.getByRole('button', { name: '更新' }).click();
    await expect(page.getByText(/保存済みの情報を表示しています/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(nowTitle)).toBeVisible();
    await expect(page.getByText(nextTitle)).toBeVisible();

    // オンライン復帰で自動的に再取得し、保存済み表示の注記が消える
    await context.setOffline(false);
    await expect(page.getByText(/保存済みの情報を表示しています/)).toBeHidden({ timeout: 40_000 });
    await expect(page.getByText(nowTitle)).toBeVisible();
  });
});
