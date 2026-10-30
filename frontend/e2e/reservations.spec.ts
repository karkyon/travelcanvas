import { test, expect } from '@playwright/test';
import { startGuestPlanViaApi } from './support/guestPlan';
import { apiClient } from './support/api';
import { expectNoAxeViolations } from './support/axe';

/**
 * [Gate E1] FR-010 予約管理・FR-012 QR/チケット・FR-011 予約取込の browser E2E。
 *
 * 1. 予約を画面から登録すると、一覧では予約番号を伏せて表示する。カードはキーボードで開け、
 *    「表示する」を押した時だけ予約番号・PIN を表示する(押すたびに監査ログに残る)。
 *    チケットのデータも同じく押した時だけ表示し、参加者を登録できる。再読込後も残る。
 * 2. 取込は同意してからジョブを作り、候補を1項目ずつ登録・承認し、確定すると予約が作られる。
 * どの画面も axe-core(WCAG 2.1 AA)違反が0件であること。
 */

const CONFIRMATION = 'E1CONF98765';
const PIN = '4321';

test('予約: 予約番号は伏せて一覧し、キーボードで詳細を開き、表示・チケット・参加者を扱え、再読込後も残る', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `E1予約E2E-${Date.now()}`, { open: false });
  const send = apiClient(context.request, apiBase, token);
  await send('post', `/plans/${planId}/days`, { local_date: '2026-11-02', timezone_id: 'Asia/Tokyo' });

  await page.goto(`/planner/${planId}/reservations`);
  await expect(page.getByRole('heading', { name: '旅の情報を、ひとつの場所へ', level: 1 })).toBeVisible();
  await expect(page.getByText('予約がまだ登録されていません')).toBeVisible();
  await expectNoAxeViolations(page, '予約一覧(空)');

  // 1. 画面から登録する
  await page.getByRole('button', { name: '新規予約' }).click();
  const create = page.getByRole('dialog', { name: '新規予約' });
  await expect(create).toBeVisible();
  await create.getByLabel('種類').selectOption('accommodation');
  await create.getByLabel('事業者名').fill('京都ホテルE1');
  await create.getByLabel('予約番号').fill(CONFIRMATION);
  await create.getByLabel('PIN').fill(PIN);
  await create.getByLabel('名義').fill('旅行 太郎');
  await create.getByLabel('開始日時').fill('2026-11-02T15:00');
  await expectNoAxeViolations(page, '新規予約の入力画面');
  await create.getByRole('button', { name: '作成' }).click();
  await expect(create).toBeHidden();

  // 2. 一覧では予約番号の全体を出さない
  const card = page.getByRole('button', { name: /京都ホテルE1/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText('予約番号');
  await expect(page.locator('body')).not.toContainText(CONFIRMATION);
  await expectNoAxeViolations(page, '予約一覧(1件)');

  // 3. キーボードで詳細を開く
  await card.focus();
  await page.keyboard.press('Enter');
  const detail = page.getByRole('dialog', { name: '予約詳細' });
  await expect(detail).toBeVisible();
  await expect(detail).not.toContainText(CONFIRMATION);
  await expect(detail).toContainText('PIN: ••••');
  await expectNoAxeViolations(page, '予約詳細(伏せた状態)');

  // 4. 押した時だけ表示し、隠せる
  const revealed = page.waitForResponse((r) => /\/reservations\/[^/]+\/reveal$/.test(new URL(r.url()).pathname));
  await detail.getByRole('button', { name: '表示する' }).click();
  expect((await revealed).status()).toBe(200);
  await expect(detail).toContainText(`予約番号: ${CONFIRMATION}`);
  await expect(detail).toContainText(`PIN: ${PIN}`);
  await detail.getByRole('button', { name: '隠す' }).click();
  await expect(detail).not.toContainText(CONFIRMATION);

  // 5. チケット(データは押した時だけ表示)
  await detail.getByRole('button', { name: 'チケットを追加' }).click();
  await detail.getByLabel('チケットの種類').fill('hotel_voucher');
  await detail.getByLabel('バーコード形式').fill('QR_CODE');
  await detail.getByLabel('QR/バーコードのデータ').fill('E1-QR-PAYLOAD-123');
  await detail.getByRole('button', { name: 'チケットを登録' }).click();
  await expect(detail).toContainText('hotel_voucher');
  await expect(detail).toContainText('データあり');
  await expect(detail).not.toContainText('E1-QR-PAYLOAD-123');
  await detail.getByRole('button', { name: 'チケット「hotel_voucher」のデータを表示' }).click();
  await expect(detail).toContainText('E1-QR-PAYLOAD-123');
  await detail.getByRole('button', { name: 'チケット「hotel_voucher」のデータを隠す' }).click();
  await expect(detail).not.toContainText('E1-QR-PAYLOAD-123');

  // 6. 参加者
  await detail.getByLabel('参加者の氏名').fill('同行 花子');
  await detail.getByLabel('参加者の座席').fill('12A');
  await detail.getByRole('button', { name: '参加者を追加' }).click();
  await expect(detail).toContainText('同行 花子(座席: 12A)');
  await expectNoAxeViolations(page, '予約詳細(チケット・参加者あり)');

  // 7. 再読込後も残る(伏せた状態で戻る)
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: /京都ホテルE1/ }).click();
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('hotel_voucher');
  await expect(detail).toContainText('同行 花子(座席: 12A)');
  await expect(detail).not.toContainText(CONFIRMATION);
  await expect(detail).not.toContainText('E1-QR-PAYLOAD-123');

  // 8. 予約の削除
  page.once('dialog', (d) => d.accept());
  await detail.getByRole('button', { name: '予約を削除' }).click();
  await expect(detail).toBeHidden();
  await expect(page.getByText('予約がまだ登録されていません')).toBeVisible();
});

test('予約取込: 同意して取込ジョブを作り、候補を登録・承認して確定すると予約が作られる', async ({ page }) => {
  const { planId } = await startGuestPlanViaApi(page, `E1取込E2E-${Date.now()}`, { open: false });

  await page.goto(`/planner/${planId}/imports`);
  await expect(page.getByRole('heading', { name: '予約取込', level: 1 })).toBeVisible();
  await expectNoAxeViolations(page, '予約取込(空)');

  // 1. 同意しないと作れない
  await page.getByRole('button', { name: '新規取込' }).click();
  const create = page.getByRole('dialog', { name: '新規取込ジョブ' });
  await expect(create.getByRole('button', { name: '作成' })).toBeDisabled();
  await create.getByLabel('この取込内容を旅行プランへ登録することに同意します。').check();
  await expectNoAxeViolations(page, '新規取込ジョブ');
  await create.getByRole('button', { name: '作成' }).click();
  await expect(create).toBeHidden();

  // 2. ジョブをキーボードで開き、候補を登録する
  const job = page.getByRole('button', { name: /取込ジョブ\(/ });
  await expect(job).toContainText('レビュー待ち');
  await job.focus();
  await page.keyboard.press('Enter');
  const detail = page.getByRole('dialog', { name: '取込ジョブ詳細' });
  await expect(detail.getByText('候補がまだ登録されていません')).toBeVisible();

  const candidates: Array<[string, string]> = [
    ['type', 'restaurant'],
    ['provider_name', '取込レストランE1'],
    ['confirmation_number', 'IMP-E1-5555'],
  ];
  for (const [field, value] of candidates) {
    await detail.getByLabel('項目').selectOption(field);
    await detail.getByLabel('候補の値').fill(value);
    await detail.getByRole('button', { name: '候補を追加' }).click();
    await expect(detail.getByRole('button', { name: `候補「${field}」を承認` })).toBeVisible();
  }
  await expectNoAxeViolations(page, '取込ジョブ詳細(未レビュー)');

  // 3. 承認して確定 → 予約一覧へ移り、予約ができている(予約番号は伏せる)
  for (const [field] of candidates) {
    await detail.getByRole('button', { name: `候補「${field}」を承認` }).click();
    await expect(detail.getByRole('button', { name: `候補「${field}」を承認` })).toHaveCount(0);
  }
  page.once('dialog', (d) => d.accept());
  await detail.getByRole('button', { name: '確定して予約を作成' }).click();
  await page.waitForURL(new RegExp(`/planner/${planId}/reservations$`), { timeout: 15_000 });
  const card = page.getByRole('button', { name: /取込レストランE1/ });
  await expect(card).toBeVisible();
  await expect(page.locator('body')).not.toContainText('IMP-E1-5555');

  // 4. 取込側では確定済みとして残る
  await page.goto(`/planner/${planId}/imports`);
  await expect(page.getByRole('button', { name: /取込ジョブ\(/ })).toContainText('確定済み');
});
