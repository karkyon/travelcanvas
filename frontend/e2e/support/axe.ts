import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * [Gate E1] axe(アクセシビリティの自動検査)の前に画面を落ち着かせる。
 *
 * omega-dev2 は試験の進みが速く、ボタンの色の切り替え(Tailwind の transition 200ms)の途中で
 * コントラストを判定して違反になることがあった(E1 v1)。マウスを画面の隅へ移してホバーを外し、
 * 有限回のアニメーション・transition が終わるまで最大5秒待つ。無限に続くもの(読み込み中の回転)は待たない。
 */
export async function settleForAxe(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .filter((a) => a.playState === 'running')
          .filter((a) => {
            const iterations = a.effect?.getTiming().iterations;
            return iterations !== Infinity;
          }).length === 0,
      null,
      { timeout: 5_000 },
    )
    .catch(() => undefined);
}

/** 違反があれば、規則・要素の HTML・理由(コントラスト比など)を含めて失敗させる */
export async function expectNoAxeViolations(page: Page, label: string, include?: string): Promise<void> {
  await settleForAxe(page);
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  if (results.violations.length === 0) return;
  const lines: string[] = [];
  for (const v of results.violations) {
    lines.push(`- [${v.impact}] ${v.id}: ${v.help} (該当要素${v.nodes.length}件) ${v.helpUrl}`);
    for (const n of v.nodes.slice(0, 5)) {
      lines.push(`  [axe-node] ${n.target.join(' ')} ${n.html.slice(0, 200)}`);
      if (n.failureSummary) lines.push(`  [axe-node] ${n.failureSummary.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  }
  throw new Error(`${label}でaxe violationsが${results.violations.length}件検出されました:\n${lines.join('\n')}`);
}
