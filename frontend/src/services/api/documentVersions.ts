/**
 * [Gate② FC-045] 文書の差し替え(新しい版として保存し、前の版を残す)と版の履歴。
 */
import { api } from './index';

export async function replaceDocument(planId: string, documentId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  await api.post(`/plans/${planId}/documents/${documentId}/replace`, form);
}

export interface DocumentVersionRow { id: string; version: number; created_at: string; superseded_at: string | null }

export async function getDocumentVersions(planId: string, documentId: string): Promise<DocumentVersionRow[]> {
  const r = await api.get(`/plans/${planId}/documents/${documentId}/versions`);
  return (r.data as Array<Record<string, unknown>>).map((v) => ({
    id: String(v.id), version: Number(v.version ?? 1), created_at: String(v.created_at ?? ''),
    superseded_at: (v.superseded_at as string | null) ?? null,
  }));
}
