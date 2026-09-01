/**
 * Vitest グローバルセットアップ。
 * vitest.config.ts の setupFiles で参照されているが、実ファイルが
 * 存在しなかった(vitest.config.tsからは参照されているのに欠落)。
 *
 * `@testing-library/jest-dom/vitest` をimportすることで、
 * - 実行時: expect() に toBeInTheDocument 等のDOM系マッチャーを登録
 * - 型検査時: vitestのAssertion型へ型定義を拡張
 * の両方が行われる(通常の '@testing-library/jest-dom' はJest向けの
 * 型拡張しか提供せず、vitestのAssertion型には効かないため区別が必要)。
 */
import '@testing-library/jest-dom/vitest';
