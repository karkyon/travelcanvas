/**
 * [Gate② FC-045] 文書の差し替え: 「差し替え」でファイルを選ぶと新しい版として送り、一覧を読み直す。版の番号を出す。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { TravelDocument } from '@/services/api';

const doc = (over: Partial<TravelDocument> = {}): TravelDocument => ({
  id: 'd1', plan_id: 'p1', owner_user_id: 'u1', classification: 'confidential', document_type: 'ticket',
  original_filename: 'ticket.pdf', mime_type: 'application/pdf', size: 10, sha256: 'x', malware_status: 'clean',
  ocr_status: 'not_requested', retention_until: null, revision: 1, created_at: '2026-11-22T00:00:00Z', updated_at: null,
  link_count: 0, receipt_count: 0, ...over,
} as TravelDocument);
const m = vi.hoisted(() => ({ getDocuments: vi.fn(), replace: vi.fn() }));
vi.mock('@/services/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()), getDocuments: m.getDocuments, getDocumentLinks: () => Promise.resolve([]),
}));
vi.mock('@/services/api/documentVersions', () => ({ replaceDocument: m.replace, getDocumentVersions: vi.fn() }));
vi.mock('@/hooks/useTripContext', () => ({ useTripContext: () => ({ title: '旅', destination: null, startDate: null, endDate: null }) }));

import DocumentsPage from './DocumentsPage';

beforeEach(() => { m.getDocuments.mockReset(); m.replace.mockReset(); });

describe('文書の差し替え (FC-045)', () => {
  it('差し替えで選んだファイルを新しい版として送り、一覧を読み直す。第 2 版の札を出す', async () => {
    m.getDocuments.mockResolvedValueOnce([doc()]).mockResolvedValue([doc({ id: 'd2', version: 2, replaces_document_id: 'd1' })]);
    m.replace.mockResolvedValue(undefined);
    render(<MemoryRouter initialEntries={['/planner/p1/documents']}>
      <Routes><Route path="/planner/:planId/documents" element={<DocumentsPage />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('doc-replace-d1'));
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'new.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('doc-replace-input'), { target: { files: [file] } });
    await waitFor(() => expect(m.replace).toHaveBeenCalledWith('p1', 'd1', file));
    expect(await screen.findByTestId('doc-version-d2')).toHaveTextContent('第 2 版');
  });
});
