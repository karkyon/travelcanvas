/**
 * [Gate② FC-026] 候補の詳細から、閉業・住所の誤り・危険・重複を報告する。報告の件数を出す(誰が報告したかは出さない)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PlanCandidateItem } from '@/services/api';

const m = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock('@/services/api/candidateReports', async (orig) => ({
  ...(await orig<Record<string, unknown>>()), reportCandidate: m.report,
}));
vi.mock('@/services/api/spotIntake', () => ({ createWishSpot: vi.fn(), enrichWishSpot: vi.fn() }));

import CandidateDetailDialog from './CandidateDetailDialog';

const cand = (over: Partial<PlanCandidateItem> = {}): PlanCandidateItem => ({
  id: 'c1', title: '伊勢の食堂', note: null, source_kind: 'manual', source_url: null, source_label: null, provider: null,
  retrieved_at: null, place_id: 'pl1', category: null, address: '三重県伊勢市', latitude: null, longitude: null, priority: 2,
  tags: [], status: 'open', status_label: '候補', scheduled_event_id: null, merged_into_id: null, created_by: 'A',
  created_at: null, revision: 1, duplicates: [], merged_from: [], ...over,
});
const renderDialog = (c: PlanCandidateItem, canEdit = false) => render(
  <MemoryRouter><CandidateDetailDialog candidate={c} planId="p1" canEdit={canEdit} onClose={vi.fn()} onSchedule={vi.fn()} /></MemoryRouter>);

beforeEach(() => { m.report.mockReset(); });

describe('候補の報告 (FC-026)', () => {
  it('既にある報告の件数を出す', () => {
    renderDialog(cand({ reports: { closed: 2, duplicate: 1 } }));
    expect(screen.getByTestId('candidate-reports')).toHaveTextContent('閉業・休業 2件・重複 1件');
  });

  it('閲覧だけのメンバーでも、理由を選んで報告できる。報告の後は件数と「要確認」にしたことを示す', async () => {
    m.report.mockResolvedValue({ reports: { wrong_address: 1 }, sources_marked_stale: 1 });
    renderDialog(cand(), false);
    fireEvent.click(screen.getByTestId('candidate-report-open'));
    fireEvent.change(screen.getByTestId('candidate-report-reason'), { target: { value: 'wrong_address' } });
    fireEvent.click(screen.getByTestId('candidate-report-send'));
    await waitFor(() => expect(m.report).toHaveBeenCalledWith('p1', 'c1', 'wrong_address', ''));
    expect(await screen.findByRole('status')).toHaveTextContent('「要確認」にしました');
    expect(screen.getByTestId('candidate-reports')).toHaveTextContent('住所・位置の誤り 1件');
    expect(screen.queryByTestId('candidate-report-form')).toBeNull();
  });

  it('報告に失敗した時は理由を示し、窓は残す', async () => {
    m.report.mockRejectedValue(new Error('x'));
    renderDialog(cand());
    fireEvent.click(screen.getByTestId('candidate-report-open'));
    fireEvent.click(screen.getByTestId('candidate-report-send'));
    expect(await screen.findByRole('alert')).toHaveTextContent('報告できませんでした');
    expect(screen.getByTestId('candidate-report-form')).toBeInTheDocument();
  });
});
