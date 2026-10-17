/**
 * [Gate E1] 公開共有リンクの解決は共通エラー処理を通さない。
 *
 * 合言葉が必要・誤りのとき backend は 401 を返す。以前はこれを共通処理が「ログイン切れ」と扱い、
 * トークンを捨てて /login へ移動していたため、合言葉の入力欄が表示されなかった。
 */
import { describe, it, expect } from 'vitest';
import fx from './__fixtures__/backendContractResponses.json';
import { api } from './index';
import type { MinimalHttpClient } from './types';

describe('resolvePublicShare (Gate E1)', () => {
  it('skipGlobalErrorHandler を付けて POST /public/share/{token}/resolve を呼び、合言葉を送る', async () => {
    const calls: Array<{ url: string; data: unknown; config: unknown }> = [];
    const client: Partial<MinimalHttpClient> = {
      post: async (url: string, data?: unknown, config?: unknown) => {
        calls.push({ url, data, config });
        return { data: fx.public_share };
      },
    };
    api.setHttpClientForTesting(client);
    await expect(api.resolvePublicShare('tok123', 'secret')).resolves.toMatchObject({ data: fx.public_share });
    expect(calls).toEqual([
      { url: '/public/share/tok123/resolve', data: { passcode: 'secret' }, config: { skipGlobalErrorHandler: true } },
    ]);
  });

  it('合言葉が空なら送らない', async () => {
    const calls: Array<{ data: unknown }> = [];
    api.setHttpClientForTesting({
      post: async (_url: string, data?: unknown) => {
        calls.push({ data });
        return { data: fx.public_share };
      },
    });
    await api.resolvePublicShare('tok123', '');
    expect(calls).toEqual([{ data: { passcode: undefined } }]);
  });

  it('401 はそのまま呼び出し元へ返す(画面が合言葉の入力を出す)', async () => {
    const error = Object.assign(new Error('401'), { response: { status: 401 } });
    api.setHttpClientForTesting({
      post: async () => {
        throw error;
      },
    });
    await expect(api.resolvePublicShare('tok123')).rejects.toBe(error);
  });
});
