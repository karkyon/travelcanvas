/**
 * [Gate P15] AtlasPage(Personal Travel Atlas、FR-052)の画面テスト。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { AtlasResponse } from '@/services/api';

const m = vi.hoisted(() => ({ getAtlas: vi.fn(), updateAtlasSettings: vi.fn() }));
vi.mock('@/services/api', () => ({ ...m }));

import AtlasPage from './AtlasPage';

const region = fx.atlas_region as AtlasResponse;

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getAtlas.mockResolvedValue(region);
  m.updateAtlasSettings.mockResolvedValue(fx.atlas_settings_saved);
});

const renderPage = () => render(<MemoryRouter><AtlasPage /></MemoryRouter>);

describe('AtlasPage (Gate P15)', () => {
  it('概要・凡例・略図と、地図の代わりの一覧を表示する(状態は文字でも示す)', async () => {
    renderPage();
    const summary = await screen.findByRole('region', { name: 'Atlasの概要' });
    expect(within(summary).getByText(/区画4件\(滞在1・訪問2・通過1・予定0\)・再訪率 33%/)).toBeInTheDocument();
    expect(within(summary).getByRole('img', { name: /訪れた地域の略図\(区画4件/ })).toBeInTheDocument();
    const table = within(screen.getByRole('region', { name: '区画の一覧' })).getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(5);
    expect(rows[1]).toHaveTextContent('◆ 滞在北緯34.9〜35°・東経135.7〜135.8°京都2026');
    expect(within(rows[1]!).getByRole('link', { name: '京都2026' })).toHaveAttribute('href', expect.stringMatching(/^\/planner\//));
  });

  it('区画の大きさ・年を切り替えて読み直す', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Atlasの概要' });
    fireEvent.change(screen.getByLabelText('区画の大きさ'), { target: { value: 'area' } });
    await waitFor(() => expect(m.getAtlas).toHaveBeenLastCalledWith('area', null));
    fireEvent.change(screen.getByLabelText('年'), { target: { value: '2026' } });
    await waitFor(() => expect(m.getAtlas).toHaveBeenLastCalledWith('area', 2026));
  });

  it('旅行をAtlasから除く', async () => {
    renderPage();
    const plans = await screen.findByRole('region', { name: 'Atlasに含める旅行' });
    const box = within(plans).getByRole('checkbox', { name: /京都2027/ });
    expect(box).toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(m.updateAtlasSettings).toHaveBeenCalledWith([region.plans[1]!.plan_id]));
    expect(box).not.toBeChecked(); // 押した直後に切り替わる
    expect(await screen.findByText('Atlasから除きました')).toBeInTheDocument();
  });

  it('保存に失敗したらチェックを元に戻して案内する', async () => {
    m.updateAtlasSettings.mockRejectedValue(new Error('network'));
    renderPage();
    const plans = await screen.findByRole('region', { name: 'Atlasに含める旅行' });
    const box = within(plans).getByRole('checkbox', { name: /京都2027/ });
    fireEvent.click(box);
    expect(await screen.findByRole('alert')).toHaveTextContent('設定を保存できませんでした');
    expect(within(plans).getByRole('checkbox', { name: /京都2027/ })).toBeChecked();
  });

  it('区画が無ければ記録の方法を案内する', async () => {
    m.getAtlas.mockResolvedValue(fx.atlas_empty);
    renderPage();
    expect(await screen.findByText(/まだ訪れた地域はありません/)).toBeInTheDocument();
  });
});
