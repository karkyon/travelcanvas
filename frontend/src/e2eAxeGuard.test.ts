/**
 * [Gate Q1] E2E の axe(アクセシビリティの自動検査)は、必ず画面を落ち着かせてから判定する。
 *
 * ボタンの色の切り替え(Tailwind の transition 200ms)の途中で判定するとコントラスト違反になる(E1 v1、V2 の CI の
 * booklet-image)。共通の expectNoAxeViolations を使うか、自前で AxeBuilder を使う時は直前に settleForAxe を呼ぶ。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const E2E = join(process.cwd(), 'e2e');

describe('E2E の axe の待ち合わせ (Gate Q1)', () => {
  it('自前の AxeBuilder の直前に settleForAxe がある', () => {
    const missing: string[] = [];
    const files = readdirSync(E2E).filter((f) => f.endsWith('.spec.ts'));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const lines = readFileSync(join(E2E, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('new AxeBuilder(')) return;
        const before = lines.slice(Math.max(0, i - 3), i).join('\n');
        if (!before.includes('await settleForAxe(page)')) missing.push(`${f}:${i + 1}`);
      });
    }
    expect(missing).toEqual([]);
  });
});
