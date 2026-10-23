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

/**
 * [Gate G3] DEP-04 試験の出力に想定外のエラー・警告を残さない。
 * console.error・console.warn(React の act 警告、jsdom の通信の失敗・捕まえていない例外を含む)が呼ばれると、
 * その試験を失敗にする。エラーを起こすこと自体を確かめる試験は `vi.spyOn(console, 'error').mockImplementation(...)`
 * のように明示的に捕まえる(捕まえた呼び出しは失敗にしない)。
 */
import { afterEach, beforeEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';

const guarded: Array<{ name: 'error' | 'warn'; spy: MockInstance; impl: (...args: unknown[]) => void }> = [];

beforeEach(() => {
  guarded.length = 0;
  for (const name of ['error', 'warn'] as const) {
    const original = console[name].bind(console);
    const impl = (...args: unknown[]) => original(...args);
    const spy = vi.spyOn(console, name).mockImplementation(impl);
    guarded.push({ name, spy, impl });
  }
});

afterEach(() => {
  const problems: string[] = [];
  for (const g of guarded) {
    // 試験が自分で mockImplementation した(想定したエラーを捕まえた)なら対象外
    if (g.spy.getMockImplementation() !== g.impl) continue;
    for (const call of g.spy.mock.calls) {
      problems.push(`console.${g.name}: ${call.map((a) => (a instanceof Error ? a.message : String(a))).join(' ').slice(0, 300)}`);
    }
  }
  guarded.length = 0;
  if (problems.length) {
    throw new Error(`想定外の console 出力があります(試験で明示的に捕まえてください):\n${problems.join('\n')}`);
  }
});

/**
 * [Gate G3] DEP-04 単体試験から本物の通信をさせない(以前は差し替え忘れの API が localhost:3001 へ通信して
 * ECONNREFUSED を出していた)。通信は失敗として扱い(以前と同じ)、その試験を失敗にする。
 * 試験が XMLHttpRequest・fetch を自分で差し替えた時は対象外。
 */
const unmockedRequests: string[] = [];
const OriginalXHR = globalThis.XMLHttpRequest;
if (OriginalXHR) {
  const open = OriginalXHR.prototype.open;
  OriginalXHR.prototype.open = function patchedOpen(this: XMLHttpRequest & { __tcUrl?: string }, ...args: unknown[]) {
    this.__tcUrl = `${String(args[0])} ${String(args[1])}`;
    return (open as (...a: unknown[]) => void).apply(this, args);
  } as typeof OriginalXHR.prototype.open;
  OriginalXHR.prototype.send = function patchedSend(this: XMLHttpRequest & { __tcUrl?: string }) {
    unmockedRequests.push(this.__tcUrl ?? '(XMLHttpRequest)');
    setTimeout(() => {
      this.dispatchEvent(new ProgressEvent('error'));
      this.dispatchEvent(new ProgressEvent('loadend'));
    }, 0);
  };
}
const originalFetch = globalThis.fetch;
const blockedFetch = ((input: unknown) => {
  unmockedRequests.push(`fetch ${String((input as { url?: string })?.url ?? input)}`);
  return Promise.reject(new TypeError('Failed to fetch (単体試験では本物の通信をしない)'));
}) as typeof fetch;
globalThis.fetch = blockedFetch;

beforeEach(() => {
  unmockedRequests.length = 0;
  if (globalThis.fetch === originalFetch) globalThis.fetch = blockedFetch;
});

afterEach(() => {
  if (unmockedRequests.length) {
    const list = unmockedRequests.splice(0).join('\n');
    throw new Error(`差し替えていない通信があります(試験で API を差し替えてください):\n${list}`);
  }
});
