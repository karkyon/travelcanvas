import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/services/api';
import type { AuditLogPage } from '@/services/api';
import AdminAuditLogs from './AdminAuditLogs';

const page = (over: Partial<AuditLogPage> = {}): AuditLogPage => ({
  actions: ['admin_user_suspend', 'login_success'],
  audit_logs: [{
    id: 'l1', user_id: 'u1', action: 'admin_user_suspend', resource_type: 'user', resource_id: 'u2',
    ip_address: '203.0.113.x', user_agent: 'Mozilla', details: { target_user_id: 'u2' }, created_at: '2026-10-19T01:00:00Z',
  }],
  pagination: { page: 1, page_size: 25, total_count: 30, total_pages: 2, has_next: true, has_prev: false },
  ...over,
});

describe('AdminAuditLogs (Gate A2 FR-040)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('一覧を表示し、種類で絞り込み、ページを進める', async () => {
    const get = vi.spyOn(api, 'getAuditLogs').mockResolvedValue(page());
    render(<MemoryRouter><AdminAuditLogs /></MemoryRouter>);
    const table = await screen.findByRole('table', { name: '監査ログの一覧' });
    expect(table).toHaveTextContent('admin_user_suspend');
    expect(table).toHaveTextContent('203.0.113.x');
    expect(table).toHaveTextContent('target_user_id: u2');
    fireEvent.change(screen.getByLabelText('種類'), { target: { value: 'login_success' } });
    fireEvent.click(screen.getByRole('button', { name: '絞り込む' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'login_success', page: 1 })));
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  });

  it('読めなければ理由を出す', async () => {
    vi.spyOn(api, 'getAuditLogs').mockRejectedValue({ response: { status: 403, data: { detail: { code: 'mfa_step_up_required', message: '確認コードを入力してください' } } } });
    render(<MemoryRouter><AdminAuditLogs /></MemoryRouter>);
    expect(await screen.findByText('確認コードを入力してください')).toHaveAttribute('role', 'alert');
  });
});
