/**
 * スポットAPIの型
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
// [Gate M9-FE-A2] createSpot()のペイロード形状。travelAPI.createSpot/
// 便利関数createSpotからも同じ形状を参照する。
export interface CreateSpotData {
  name: string;
  description?: string;
  category: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  price_range?: string;
  image_url?: string;
  is_public?: boolean;
}
