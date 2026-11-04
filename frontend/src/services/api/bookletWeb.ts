/**
 * [Gate BookletWeb] しおりの版を Web のページとして公開する・止める・公開したページを読む。
 * backend/app/api/v1/booklet.py(POST/DELETE /plans/{plan_id}/booklet-exports/{export_id}/publish、
 * GET /public/booklets/{token})。公開の URL は公開した時だけ返る(サーバーは鍵の値を持たない)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { decodeResponse, nullable, object, int, str } from './decode';
import type { Booklet } from './types';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };
const DL = () => import('./decoders');

export async function publishBookletExport(planId: string, exportId: string): Promise<{ url: string; published_at: string | null }> {
  const r = await api.post(`/plans/${planId}/booklet-exports/${exportId}/publish`, {}, SILENT);
  return decodeResponse(r.data, object<{ url: string; published_at: string | null }>({ url: str, published_at: nullable(str) }),
    'POST /plans/{plan_id}/booklet-exports/{export_id}/publish');
}

export async function unpublishBookletExport(planId: string, exportId: string): Promise<void> {
  await api.delete(`/plans/${planId}/booklet-exports/${exportId}/publish`, SILENT);
}

export interface PublicBooklet {
  booklet: Booklet; version_no: number; published_at: string | null; valid_until: string | null; theme: string; density: string;
}

export async function getPublicBooklet(token: string): Promise<PublicBooklet> {
  const r = await api.get(`/public/booklets/${encodeURIComponent(token)}`, SILENT);
  return decodeResponse(r.data, object<PublicBooklet>({
    booklet: (await DL()).booklet, version_no: int, published_at: nullable(str), valid_until: nullable(str), theme: str, density: str,
  }), 'GET /public/booklets/{token}');
}
