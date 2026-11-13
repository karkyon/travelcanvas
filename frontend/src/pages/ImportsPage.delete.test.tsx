import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = vi.hoisted(() => ({
  getImportJobs: vi.fn(), getImportJob: vi.fn(), createImportJob: vi.fn(), createExtractionCandidate: vi.fn(),
  acceptExtractionCandidate: vi.fn(), rejectExtractionCandidate: vi.fn(), confirmImportJob: vi.fn(), rejectImportJob: vi.fn(),
}));
const pf = vi.hoisted(() => ({ deleteImportJob: vi.fn(), extractReservationText: vi.fn(), extractReservationFile: vi.fn(), applyExtraction: vi.fn() }));
vi.mock('@/services/api', () => api);
vi.mock('@/services/api/photoFeatures', () => pf);
// [Gate Remaining-3] 転送アドレスは「設定なし」で返す
vi.mock('@/services/api/remaining2', () => ({
  getInboundMail: vi.fn().mockResolvedValue({ configured: false, address: null, received_count: 0, last_received_at: null,
    created_at: null, daily_limit: 30 }),
  createInboundMail: vi.fn(), revokeInboundMail: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import ImportsPage from './ImportsPage';

describe('[BookingImportYahoo] 取込ジョブの削除', () => {
  it('確かめてから消し、一覧から外す', async () => {
    api.getImportJobs.mockResolvedValue([
      { id: 'j1', plan_id: 'p1', provider: 'rules', status: 'rejected', created_at: '2026-11-07T11:06:00Z' },
      { id: 'j2', plan_id: 'p1', provider: 'rules', status: 'confirmed', created_at: '2026-11-05T06:35:00Z' },
    ]);
    pf.deleteImportJob.mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<MemoryRouter initialEntries={['/planner/p1/imports']}><Routes><Route path="/planner/:planId/imports" element={<ImportsPage />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('import-job-delete-j2'));
    expect(pf.deleteImportJob).not.toHaveBeenCalled();
    expect(confirm.mock.calls[0]![0]).toContain('登録した予約は消えません');
    fireEvent.click(screen.getByTestId('import-job-delete-j2'));
    await waitFor(() => expect(pf.deleteImportJob).toHaveBeenCalledWith('p1', 'j2'));
    await waitFor(() => expect(screen.queryByTestId('import-job-delete-j2')).toBeNull());
    expect(screen.getByTestId('import-job-delete-j1')).toBeInTheDocument();
  });
});
