import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * [Gate R2-7] docs/trace/gate-r2-trace.md の R2-5行が「未達」としていた
 * 4項目のうち残る2件(accessibility試験、audit/metric基盤)の片方を満たす。
 *
 * axe-core(WCAG 2.0/2.1 A・AA相当のルールセット)で主要2画面を静的スキャン
 * する。キーボード操作シナリオ等の動的検証はスコープ外(次Gate以降で必要
 * に応じて追加)。violations が1件でもあれば test.step 単位で失敗させ、
 * どのルールがどの画面で違反しているか一覧できるようにする。
 *
 * 対象画面:
 *   1. ランディングページ(未認証、"/") - 誰もが最初に到達する画面
 *   2. プランナー画面(ゲスト、"/planner") - アプリの中核機能画面
 *      (quickdraft-flow.spec.ts と同じ「ゲストとして始める」導線を使う)
 */

test.describe('アクセシビリティ (axe-core)', () => {
  test('ランディングページにaxe violationsが無いこと', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /ゲストとして始める/ }).waitFor({
      state: 'visible',
      timeout: 15_000,
    });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    if (results.violations.length > 0) {
      const summary = results.violations
        .map(
          (v) =>
            `- [${v.impact}] ${v.id}: ${v.help} (該当要素${v.nodes.length}件) ${v.helpUrl}`,
        )
        .join('\n');
      throw new Error(
        `ランディングページでaxe violationsが${results.violations.length}件検出されました:\n${summary}`,
      );
    }

    expect(results.violations).toEqual([]);
  });

  test('プランナー画面(ゲスト)にaxe violationsが無いこと', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /ゲストとして始める/ }).click();
    await page.waitForURL(/\/planner\/?$/, { timeout: 15_000 });
    await page
      .getByRole('button', { name: /新しいプラン/ })
      .waitFor({ state: 'visible', timeout: 15_000 });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    if (results.violations.length > 0) {
      const summary = results.violations
        .map(
          (v) =>
            `- [${v.impact}] ${v.id}: ${v.help} (該当要素${v.nodes.length}件) ${v.helpUrl}`,
        )
        .join('\n');
      throw new Error(
        `プランナー画面でaxe violationsが${results.violations.length}件検出されました:\n${summary}`,
      );
    }

    expect(results.violations).toEqual([]);
  });
});
