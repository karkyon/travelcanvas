/**
 * [Gate Remaining-6] FR-052 テーマで絞った Atlas。最初に読む JS を小さく保つため、Atlas の画面(後から読む塊)だけが import する。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { decodeResponse } from './decode';
import type { AtlasPrecision, AtlasResponse } from './types/atlas';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export async function getAtlasThemed(precision: AtlasPrecision, year: number | null, theme: string | null): Promise<AtlasResponse> {
  const params: Record<string, string | number> = { precision };
  if (year) params.year = year;
  if (theme) params.theme = theme;
  const r = await api.get('/atlas', { ...SILENT, params });
  return decodeResponse(r.data, (await import('./decoders')).atlasResponse, 'GET /atlas');
}
