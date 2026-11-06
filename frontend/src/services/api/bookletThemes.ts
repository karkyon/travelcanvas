/**
 * [Gate BookletTiers] しおりのデザインの一覧と、この人の会員クラスで使えるか(GET /plans/{id}/booklet/themes)。
 * 使えないデザインはサーバーも 403(tier_feature_not_included)で断る。画面は鍵の印と「○○ から」を出す。
 */
import { api } from './index';
import { arrayOf, bool, decodeResponse, object, str } from './decode';

/** theme は画面が知らない新しいデザインもあり得るため文字列(画面は知っているものだけ使う) */
export interface BookletThemeAccess { theme: string; min_tier: string; available: boolean }
export interface BookletThemeCatalog { user_class: string; themes: BookletThemeAccess[] }

const catalog = object<BookletThemeCatalog>({
  user_class: str,
  themes: arrayOf(object<BookletThemeAccess>({ theme: str, min_tier: str, available: bool })),
});

export async function getBookletThemes(planId: string): Promise<BookletThemeCatalog> {
  const response = await api.get(`/plans/${planId}/booklet/themes`, { skipGlobalErrorHandler: true });
  return decodeResponse(response.data, catalog, 'GET /plans/{plan_id}/booklet/themes');
}

/** クラスの表示名(membership_tiers.TIER_LABEL と同じ) */
export const TIER_LABEL: Record<string, string> = { free: 'Free', trip: 'Trip', journey: 'Journey', explorer: 'Explorer' };
