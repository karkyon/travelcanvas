/** [Gate G11] 表紙の写真の decoder(ダッシュボードの decoder と g11.ts の両方が使う) */
import { bool, int, nullable, object, oneOf, optional, record, str, type Decoder } from './decode';
import type { PlanCover } from './types/g11';

export const planCover: Decoder<PlanCover> = object<PlanCover>({
  memory_id: str, focus_x: int, focus_y: int, zoom: int, visibility: oneOf('private', 'members'), by_me: bool,
  source: nullable(record), revision: int,
});

/** 一覧・ダッシュボードの各旅行の表紙(古い backend では項目が無い → null) */
export const optionalPlanCover: Decoder<PlanCover | null> = (v, path) =>
  (optional(nullable(planCover))(v, path) ?? null);
