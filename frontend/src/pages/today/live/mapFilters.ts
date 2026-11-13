/** [Gate TDay-Mock] 地図に出すもの(今日の予定・足跡・寄り道・雨雲・同行者) */
export interface MapFilters { plan: boolean; trail: boolean; detour: boolean; rain: boolean; crew: boolean }
export const ALL_FILTERS: MapFilters = { plan: true, trail: true, detour: true, rain: true, crew: true };
