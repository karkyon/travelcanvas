/**
 * [Gate M9-FE-C2b-3] 残りのAPI応答へのdecoder適用と、API URLの実在検査。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import fx from './__fixtures__/backendContractResponses.json';
import backendRoutes from './__fixtures__/backendRoutes.json';
import { ApiDecodeError } from './decode';
import { api } from './index';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string; config?: { params?: unknown } };

/** 応答を固定し、呼ばれたURL・メソッドを記録するテスト用クライアント。 */
function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const make = (method: string) => async (url: string, a?: unknown, b?: unknown) => {
    const config = (method === 'GET' || method === 'DELETE' ? a : b) as Call['config'];
    calls.push({ url, method, config });
    return { data };
  };
  const client: Partial<MinimalHttpClient> = {
    get: make('GET'), post: make('POST'), put: make('PUT'), patch: make('PATCH'), delete: make('DELETE'),
  };
  api.setHttpClientForTesting(client);
  return calls;
}

describe('getPlaceのURL修正 (Gate M9-FE-C2b-3)', () => {
  it('GET /search/places/{id} を呼ぶ(以前は存在しない /places/{id} で常に404だった)', async () => {
    const calls = respondWith(fx.place);
    await expect(api.getPlace('place-1')).resolves.toMatchObject({ name: fx.place.name });
    expect(calls).toEqual([{ url: '/search/places/place-1', method: 'GET', config: undefined }]);
  });
});

describe('正規化プラン・地図・最適化・共有・通知・認証の応答検証 (Gate M9-FE-C2b-3)', () => {
  it('実応答はそのまま返る', async () => {
    respondWith(fx.plan_detail);
    await expect(api.getPlanDetail('p')).resolves.toEqual({ success: true, message: '', data: fx.plan_detail });
    respondWith(fx.day_created_minimal);
    await expect(api.createDay('p', { local_date: '2026-11-11' }, 'k')).resolves.toEqual(fx.day_created_minimal);
    respondWith(fx.event_moved);
    await expect(api.moveEvent('p', 'e', { sort_order: 0 }, 1, 'k')).resolves.toEqual(fx.event_moved);
    respondWith(fx.route_preview_empty);
    await expect(api.getRoutePreview('p', 'd')).resolves.toEqual(fx.route_preview_empty);
    respondWith(fx.optimization_apply);
    await expect(api.applyOptimizationProposal('p', 'd', [], 1)).resolves.toEqual(fx.optimization_apply);
    respondWith(fx.public_share);
    await expect(api.resolvePublicShare('t')).resolves.toMatchObject({ data: fx.public_share });
    respondWith(fx.invitation_list);
    await expect(api.listMyInvitations()).resolves.toMatchObject({ data: fx.invitation_list });
    respondWith(fx.auth_me);
    await expect(api.getCurrentUser()).resolves.toMatchObject({ data: fx.auth_me });
    respondWith(fx.quickdraft_promoted);
    await expect(api.promoteQuickDraft('d', 'tok', 'k')).resolves.toEqual(fx.quickdraft_promoted);
  });

  it('旧travel-plans応答はid/titleを検証してから従来どおりdaysへ変換する', async () => {
    respondWith(fx.travel_plan_list);
    const res = await api.getPlans();
    expect(res.data).toHaveLength(fx.travel_plan_list.plans.length);
    expect(res.data[0]).toMatchObject({ id: fx.travel_plan_list.plans[0]!.id, days: [] });
    expect(res.data[0]).not.toHaveProperty('itinerary');
    respondWith({ ...fx.travel_plan_get, id: undefined });
    await expect(api.getPlan('p')).rejects.toThrow(/\$\.id/);
  });

  it('形式不正は位置付きのApiDecodeErrorになる', async () => {
    respondWith({ ...fx.plan_detail, days: [{ ...fx.plan_detail.days[0], events: [{ id: 'e' }] }] });
    await expect(api.getPlanDetail('p')).rejects.toThrow(/\$\.days\[0\]\.events\[0\]/);
    respondWith({ ...fx.route_preview, legs: [{ ...fx.route_preview.legs[0], unknown: 'no' }] });
    await expect(api.getRoutePreview('p', 'd')).rejects.toThrow(/\$\.legs\[0\]\.unknown/);
    respondWith([{ ...fx.collaborator_list[0], role: 'admin' }]);
    await expect(api.getCollaborators('p')).rejects.toThrow(/\$\[0\]\.role/);
    respondWith({ ...fx.share_created, permission: 'owner' });
    await expect(api.createShareLink('p', { permission: 'view' })).rejects.toBeInstanceOf(ApiDecodeError);
    respondWith({ unread_count: '3' });
    await expect(api.getUnreadNotificationCount()).rejects.toThrow(/\$\.unread_count/);
    respondWith({ ...fx.auth_me, is_active: 'yes' });
    await expect(api.getCurrentUser()).rejects.toThrow(/\$\.is_active/);
  });
});

// ---------------------------------------------------------------------------
// frontendの全API呼び出しURLが実backendのルートに存在することの検査
// ---------------------------------------------------------------------------
const SRC_ROOT = join(__dirname, '..', '..');

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '__fixtures__') continue;
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const CALL_PATTERNS = [
  /this\.client\.(get|post|put|patch|delete)(?:<[^(]*?>)?\(\s*[`'"]([^`'"]+)[`'"]/g,
  /\bapi\.(get|post|put|delete)(?:<[^(]*?>)?\(\s*[`'"]([^`'"]+)[`'"]/g,
  /method:\s*'(\w+)',\s*url:\s*`([^`]+)`/g,
];

function routeMatcher(path: string): RegExp {
  const body = path.replace(/^\/api\/v1/, '').replace(/\/+$/, '').replace(/\{[^}]+\}/g, '[^/]+');
  return new RegExp(`^${body}/?$`);
}

describe('API URLの実在検査 (Gate M9-FE-C2b-3)', () => {
  const routes = backendRoutes.routes.map((r) => {
    const [method, path] = r.split(' ') as [string, string];
    return { method, re: routeMatcher(path) };
  });

  it('frontendが呼ぶ全URLが実backendのルートに存在する(存在しないURLは常に404になる)', () => {
    const calls: string[] = [];
    const missing: string[] = [];
    for (const file of listSourceFiles(SRC_ROOT)) {
      const text = readFileSync(file, 'utf-8');
      for (const pattern of CALL_PATTERNS) {
        for (const m of text.matchAll(pattern)) {
          const method = m[1]!.toUpperCase();
          const url = m[2]!.replace(/\$\{[^}]+\}/g, 'X').split('?')[0]!.replace(/\/+$/, '');
          calls.push(`${method} ${url}`);
          if (!routes.some((r) => r.method === method && r.re.test(url))) {
            missing.push(`${method} ${m[2]} (${relative(SRC_ROOT, file)})`);
          }
        }
      }
    }
    // 走査自体が機能していることの確認(検出0件で素通りしないように)
    expect(calls.length).toBeGreaterThan(90);
    expect(missing).toEqual([]);
  });
});
