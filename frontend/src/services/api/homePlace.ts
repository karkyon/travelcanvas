/**
 * [Gate HomePlace] 自宅の場所(本人だけ)。backend/app/api/v1/home_place.py。
 *
 * - 登録するか・地図に出すか・出発と帰着の経路に使うか・道の経路の提供元へ送るかは、本人が選ぶ
 * - 自宅の位置は本人の GET だけが返す(同行者・共有・しおりには出ない)
 * 最初に読む JS を小さく保つため CompleteTravelAPI には足さず、使う画面がここを直接 import する。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { bool, decodeResponse, nullable, num, object, str, type Decoder } from './decode';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export interface HomePlacePoint { label: string; address: string | null; latitude: number; longitude: number }
export interface HomePlace {
  configured: boolean;
  /** 保存済みの内容を復号できたか(できない時は place が null) */
  readable: boolean;
  revision: number;
  place: HomePlacePoint | null;
  show_on_map: boolean;
  use_for_routes: boolean;
  send_to_route_provider: boolean;
}
export interface HomePlaceInput extends HomePlacePoint {
  show_on_map: boolean;
  use_for_routes: boolean;
  send_to_route_provider: boolean;
}

const point: Decoder<HomePlacePoint> = object<HomePlacePoint>({
  label: str, address: nullable(str), latitude: num, longitude: num,
});
const homePlace: Decoder<HomePlace> = object<HomePlace>({
  configured: bool, readable: bool, revision: num, place: nullable(point),
  show_on_map: bool, use_for_routes: bool, send_to_route_provider: bool,
});

export async function getHomePlace(): Promise<HomePlace> {
  return decodeResponse((await api.get('/privacy/home-place', SILENT)).data, homePlace, 'GET /privacy/home-place');
}

export async function saveHomePlace(input: HomePlaceInput, revision: number): Promise<HomePlace> {
  const body = {
    label: input.label.trim().slice(0, 40) || '自宅',
    address: input.address?.trim() ? input.address.trim().slice(0, 200) : null,
    latitude: input.latitude, longitude: input.longitude,
    show_on_map: input.show_on_map, use_for_routes: input.use_for_routes, send_to_route_provider: input.send_to_route_provider,
  };
  return decodeResponse((await api.put('/privacy/home-place', body, { ...SILENT, headers: { 'If-Match': String(revision) } })).data,
    homePlace, 'PUT /privacy/home-place');
}

export async function deleteHomePlace(): Promise<void> {
  await api.delete('/privacy/home-place', SILENT);
}
