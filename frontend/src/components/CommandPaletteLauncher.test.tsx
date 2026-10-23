/**
 * [Gate G3] CommandPaletteLauncher: 読み込みの途中・読み込み直後(描画の待ち)に押された Ctrl+K を失わない。
 */
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/services/api', () => ({ searchPlan: vi.fn(), searchEverything: vi.fn() }));

import CommandPaletteLauncher from './CommandPaletteLauncher';

describe('CommandPaletteLauncher (Gate G3)', () => {
  it('描画の直後に押した Ctrl+K で開く', async () => {
    render(<MemoryRouter><CommandPaletteLauncher /></MemoryRouter>);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: '検索' })).toBeInTheDocument();
  });

  it('読み込みが終わった後に押した Ctrl+K でも開く(1回で開き、もう1回で閉じる)', async () => {
    render(<MemoryRouter><CommandPaletteLauncher /></MemoryRouter>);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(await screen.findByRole('button', { name: '検索(Ctrl+K)' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: '検索' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog', { name: '検索' })).toBeNull();
  });
});
