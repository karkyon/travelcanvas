import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/services/api';
import type { PrivateProfile } from '@/services/api';
import PrivateProfileSection from './PrivateProfileSection';

const profile = (over: Partial<PrivateProfile> = {}): PrivateProfile => ({
  revision: 0, items: [], readable: true, kinds: [], max_items: 20, applied_plans: [], ...over,
});

describe('PrivateProfileSection (Gate C1 FR-023)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('条件を追加して版を付けて保存し、一覧と適用中の旅行を示す', async () => {
    vi.spyOn(api, 'getPrivateProfile').mockResolvedValue(profile());
    const put = vi.spyOn(api, 'putPrivateProfile').mockResolvedValue(profile({
      revision: 1,
      items: [{ id: 'i1', kind: 'earliest_start', label: '朝はゆっくりしたい', hardness: 'hard', value: '11:00', unit: null }],
      applied_plans: [{ plan_id: 'p1', title: '京都' }],
    }));
    render(<MemoryRouter><PrivateProfileSection /></MemoryRouter>);
    expect(await screen.findByText('まだありません')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('名前(あなたにだけ表示)'), { target: { value: '朝はゆっくりしたい' } });
    fireEvent.change(screen.getByLabelText('時刻'), { target: { value: '11:00' } });
    fireEvent.click(screen.getByRole('button', { name: '条件を追加して保存' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith(
      [{ kind: 'earliest_start', label: '朝はゆっくりしたい', hardness: 'hard', value: '11:00', unit: null }], 0));
    expect(await screen.findByText('非公開の条件を保存しました')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('list', { name: '登録した非公開の条件' })).toHaveTextContent('11:00より後に始める');
    expect(screen.getByRole('link', { name: '京都' })).toHaveAttribute('href', '/planner/p1/constraints');
  });

  it('入力が足りなければ保存せずに理由を示す', async () => {
    vi.spyOn(api, 'getPrivateProfile').mockResolvedValue(profile());
    const put = vi.spyOn(api, 'putPrivateProfile');
    render(<MemoryRouter><PrivateProfileSection /></MemoryRouter>);
    await screen.findByText('まだありません');
    fireEvent.click(screen.getByRole('button', { name: '条件を追加して保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('名前は1〜60文字');
    expect(put).not.toHaveBeenCalled();
  });
});
