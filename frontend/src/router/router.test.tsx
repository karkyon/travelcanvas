/**
 * [Gate M9-FE-C3] ルーティングの契約テスト。
 * - ルート定義(パス一覧)は遅延読込化の前(HEAD e10c8b7)と同一であること
 * - ページは遅延読込で描画され、読込中はLayoutのSuspense表示になること
 * - ルートで例外が起きた場合はRouteErrorBoundaryの回復画面を出すこと
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { lazy } from 'react';

// Header(通知ポーリング等)は本テストの対象外
vi.mock('@/components/Header', () => ({ default: () => <div>HEADER</div> }));

import { router } from './index';
import Layout from '@/components/Layout';
import RouteErrorBoundary from './RouteErrorBoundary';

const EXPECTED_ROUTE_PATHS = [
  '/', '/(index)', '/login', '/register', '/account-deleted', '/guest/upgrade', '/dashboard', '/planner', '/planner/(index)',
  '/planner/:planId?', '/planner/:planId/reservations', '/planner/:planId/imports', '/planner/:planId/documents',
  '/planner/:planId/today', '/planner/:planId/segments', '/planner/:planId/route-options',
  '/planner/:planId/constraints', '/planner/:planId/preparation', '/planner/:planId/expenses', '/planner/:planId/discussion',
  '/planner/:planId/booklet', '/planner/:planId/booklet/:exportId', '/planner/:planId/exports',
  '/planner/:planId/branches', '/planner/:planId/branches/:branchId',
  '/planner/:planId/corrections', '/design-system',
  '/planner/:planId/calendar-import', '/planner/:planId/alerts', '/planner/:planId/replans/:replanId',
  '/planner/:planId/sync', '/planner/:planId/memories', '/planner/:planId/track', '/planner/:planId/journey', '/planner/:planId/visits', '/organizations', '/organizations/:orgId', '/organizations/:orgId/distributions/:distId', '/trip-consult', '/planner/:planId/draft', '/planner/:planId/candidates', '/planner/:planId/places/:placeId', '/planner/:planId/memory-replan', '/search',
  '/search/(index)', '/search/settings', '/search/spots', '/spots', '/spots/(index)', '/spots/search',
  '/spots/register', '/settings', '/settings/data', '/atlas', '/profile', '/admin', '/admin/(index)', '/admin/users', '/admin/audit-logs', '/admin/support', '/admin/abuse', '/admin/ops', '/notifications',
  '/share/:planId', '/s/:token', '/journal/:token', '/optimization', '/404', '/*',
];

function collectPaths(routes: RouteObject[], prefix = ''): string[] {
  const out: string[] = [];
  for (const r of routes) {
    out.push(r.index ? `${prefix}(index)` : `${prefix}${r.path ?? ''}`);
    if (r.children) {
      const next = r.path ? `${prefix}${r.path === '/' ? '/' : `${r.path}/`}` : prefix;
      out.push(...collectPaths(r.children, next));
    }
  }
  return out;
}

describe('router (Gate M9-FE-C3)', () => {
  it('ルート定義のパス一覧は遅延読込化の前と同一', () => {
    expect(collectPaths(router.routes as RouteObject[])).toEqual(EXPECTED_ROUTE_PATHS);
  });

  it('ルートにはerrorElementが設定されている', () => {
    const root = (router.routes as RouteObject[])[0]!;
    expect(root.errorElement).toBeTruthy();
  });

  it('遅延読込中はヘッダーを残したまま本文に読込表示を出し、読込後にページを描画する', async () => {
    let resolvePage: (m: { default: () => JSX.Element }) => void = () => {};
    const LazyPage = lazy(
      () => new Promise<{ default: () => JSX.Element }>((resolve) => (resolvePage = resolve))
    );
    const memory = createMemoryRouter(
      // [Gate LP] ランディング(/)は全体の見出しを出さないため、ほかの画面で確かめる
      [{ path: '/', element: <Layout />, children: [{ path: 'dashboard', element: <LazyPage /> }] }],
      { initialEntries: ['/dashboard'] }
    );
    render(<RouterProvider router={memory} />);
    expect(screen.getByText('HEADER')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中');

    resolvePage({ default: () => <div>PAGE-BODY</div> });
    expect(await screen.findByText('PAGE-BODY')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('chunk読込失敗は「更新された可能性」として再読込を案内する', async () => {
    const Broken = () => {
      throw new TypeError('Failed to fetch dynamically imported module: /assets/X.js');
    };
    const memory = createMemoryRouter(
      [{ path: '/', element: <Broken />, errorElement: <RouteErrorBoundary /> }],
      { initialEntries: ['/'] }
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // [Gate G3] DEP-04 React(開発版)が投げ直す想定した例外を、jsdom が「捕まえていない例外」として出力しないよう捕まえる
    const swallow = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', swallow);
    render(<RouterProvider router={memory} />);
    expect(await screen.findByText('画面を読み込めませんでした')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalled();
    window.removeEventListener('error', swallow);
    errorSpy.mockRestore();
  });

  it('その他の例外は開発者向け表示ではなく一般的なエラー画面を出す', async () => {
    const Broken = () => {
      throw new Error('unexpected');
    };
    const memory = createMemoryRouter(
      [{ path: '/', element: <Broken />, errorElement: <RouteErrorBoundary /> }],
      { initialEntries: ['/'] }
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // [Gate G3] DEP-04 React(開発版)が投げ直す想定した例外を、jsdom が「捕まえていない例外」として出力しないよう捕まえる
    const swallow = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', swallow);
    render(<RouterProvider router={memory} />);
    expect(await screen.findByText('予期しないエラーが発生しました')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ホームへ' })).toHaveAttribute('href', '/');
    expect(errorSpy).toHaveBeenCalled();
    window.removeEventListener('error', swallow);
    errorSpy.mockRestore();
  });
});
