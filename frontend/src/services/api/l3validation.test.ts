/**
 * [Gate L3] 実行可能性検証API(FR-017)のクライアント。送信内容(URL・メソッド・limit)と、
 * 実backendから採取した応答(__fixtures__)のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import { ApiDecodeError } from './decode';
import { api, getValidationRun, getValidationRuns, runValidation } from './index';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const client: Partial<MinimalHttpClient> = {
    get: async (url: string, config?: AxiosRequestConfig) => { calls.push({ url, method: 'GET', config }); return { data }; },
    post: async (url: string, body?: unknown, config?: AxiosRequestConfig) => {
      calls.push({ url, method: 'POST', data: body, config });
      return { data };
    },
  };
  api.setHttpClientForTesting(client);
  return calls;
}

describe('実行可能性検証APIクライアント (Gate L3)', () => {
  it('実行は POST /plans/{id}/validation-runs で、違反と検証不能を含む結果を返す', async () => {
    const calls = respondWith(fx.validation_run_created);
    const run = await runValidation('p1');
    expect(calls).toEqual([{ url: '/plans/p1/validation-runs', method: 'POST', data: undefined, config: undefined }]);
    expect(run).toEqual(fx.validation_run_created);
    expect(run.issues.some((i) => i.kind === 'unverified')).toBe(true);
    expect(run.issues.some((i) => i.kind === 'violation' && i.severity === 'ERROR')).toBe(true);
  });

  it('履歴は limit をクエリで渡し、指定しなければ付けない', async () => {
    let calls = respondWith(fx.validation_run_list);
    await expect(getValidationRuns('p1', 1)).resolves.toEqual(fx.validation_run_list);
    expect(calls).toEqual([{ url: '/plans/p1/validation-runs', method: 'GET', config: { params: { limit: 1 } } }]);
    calls = respondWith([]);
    await expect(getValidationRuns('p1')).resolves.toEqual([]);
    expect(calls).toEqual([{ url: '/plans/p1/validation-runs', method: 'GET', config: { params: undefined } }]);
  });

  it('詳細は GET /plans/{id}/validation-runs/{runId}', async () => {
    const calls = respondWith(fx.validation_run_stale);
    const run = await getValidationRun('p1', 'r1');
    expect(calls).toEqual([{ url: '/plans/p1/validation-runs/r1', method: 'GET', config: undefined }]);
    expect(run.is_stale).toBe(true);
  });

  it('他のメンバーの秘匿制約に関する問題は内容を持たず、作成者本人には題名が付く', () => {
    const others = fx.validation_run_created.issues.filter((i) => i.is_private_constraint);
    expect(others.length).toBeGreaterThan(0);
    for (const i of others) {
      expect(i).toMatchObject({ is_masked: true, constraint_title: null, evidence: null, suggestion: null });
    }
    expect(JSON.stringify(fx.validation_run_created)).not.toContain('甲殻類');
    const mine = fx.validation_run_detail_owner_private.issues.filter((i) => i.is_private_constraint);
    expect(mine.every((i) => !i.is_masked && i.constraint_title === '甲殻類は食べられない')).toBe(true);
  });

  it('件数や区分の形式が崩れた応答は拒否する(問題なしと誤表示しない)', async () => {
    respondWith({ ...fx.validation_run_created, counts: { ...fx.validation_run_created.counts, error: '4' } });
    await expect(runValidation('p1')).rejects.toThrow(/\$\.counts\.error/);
    const bad = { ...fx.validation_run_created, issues: [{ ...fx.validation_run_created.issues[0], kind: 'ok' }] };
    respondWith(bad);
    await expect(runValidation('p1')).rejects.toThrow(/\$\.issues\[0\]\.kind/);
    respondWith({ ...fx.validation_run_created, status: 'running' });
    await expect(runValidation('p1')).rejects.toBeInstanceOf(ApiDecodeError);
    respondWith([{ ...fx.validation_run_list[0], is_stale: 'no' }]);
    await expect(getValidationRuns('p1')).rejects.toThrow(/\$\[0\]\.is_stale/);
  });
});
