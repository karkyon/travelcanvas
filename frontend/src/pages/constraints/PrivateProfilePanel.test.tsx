import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/services/api';
import PrivateProfilePanel from './PrivateProfilePanel';

const st = (applied: boolean, n = 2) => ({
  plan_id: 'p1', applied, profile_items: n, applied_constraints: applied ? n : 0, profile_revision: 1,
});

describe('PrivateProfilePanel (Gate C1 FR-023)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('この旅行に適用し、制約の一覧を読み直させる', async () => {
    vi.spyOn(api, 'getPlanPrivateProfile').mockResolvedValue(st(false));
    const put = vi.spyOn(api, 'putPlanPrivateProfile').mockResolvedValue(st(true));
    const onChanged = vi.fn();
    render(<MemoryRouter><PrivateProfilePanel planId="p1" onChanged={onChanged} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'この旅行に適用する' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('p1', true));
    expect(await screen.findByText('非公開の条件をこの旅行に適用しました')).toHaveAttribute('role', 'status');
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'この旅行への適用をやめる' })).toBeInTheDocument();
  });

  it('条件が無ければ適用できない', async () => {
    vi.spyOn(api, 'getPlanPrivateProfile').mockResolvedValue(st(false, 0));
    render(<MemoryRouter><PrivateProfilePanel planId="p1" onChanged={() => undefined} /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'この旅行に適用する' })).toBeDisabled();
    expect(screen.getByRole('link', { name: '設定で変更する' })).toHaveAttribute('href', '/settings?tab=conditions');
  });
});
