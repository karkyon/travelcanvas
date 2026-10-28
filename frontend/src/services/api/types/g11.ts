/** [Gate G11] 旅行の表紙の写真(backend/app/services/plan_cover.py の cover_dict)の型 */
export interface CoverPosition {
  /** 写真のどこを中心に見せるか(横、0〜100 %) */
  focus_x: number;
  /** 縦、0〜100 % */
  focus_y: number;
  /** 拡大(100〜300 %) */
  zoom: number;
}

export interface PlanCover extends CoverPosition {
  memory_id: string;
  visibility: 'private' | 'members';
  by_me: boolean;
  /** 外部の写真の出典(作者・ライセンス等)。手で上げた写真は null */
  source: Record<string, unknown> | null;
  revision: number;
}

export interface PlanCoverState {
  cover: PlanCover | null;
  can_edit: boolean;
}
