/**
 * PlannerPage - 旅行プランナー
 *
 * [Gate #11] これまでスタブ("The travel planner interface will be
 * implemented here.")のままだったページを実装。DayView/PlanHeader/planStoreは
 * 既にGate #7g以降で修正・接続済みだったが、実際にレンダリングするページが
 * 存在しなかったため一度も画面に表示されていなかった。
 *
 * /planner        -> プラン一覧 + 新規作成
 * /planner/:planId -> 選択したプランの日程編集画面(PlanHeader + 日タブ + DayView)
 */
import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { Link, useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { usePlanStore } from '@/store/planStore';
import { useAuthStore } from '@/store/authStore';
import PlanHeader from '@/components/PlanHeader';
import DayView from '@/components/DayView';
import OptimizationPanel from '@/components/planner/OptimizationPanel';
import EventTimeImpact, { type EndValue } from '@/components/planner/EventTimeImpact';
import EventPhotoPanel from '@/components/planner/EventPhotoPanel';
import EventRelatedSummary from '@/components/planner/EventRelatedSummary';
import { geocodeAddress, getPlaceInfo, type PlaceInfoResult } from '@/services/api/planEdit';
import { appendNotes, candidateHint, mergeUrlRows, nearPoint } from '@/components/places/placeHelpers';
import PlaceSourcesCredit from '@/components/places/PlaceSourcesCredit';
import { Globe, LocateFixed } from 'lucide-react';
import EventUrlsField from '@/components/planner/EventUrlsField';
import DiningFields from '@/components/dining/DiningFields';
import { cleanDining, mergeEmptyDining, type DiningInfo } from '@/components/dining/diningModel';
import { cleanUrls, sameUrls } from '@/components/planner/spotLinksModel';
import { safeExternalUrl } from '@/utils/safeNavigation';
import Button from '@/components/common/Button';
import UiIcon from '@/components/common/UiIcon';
import {
  BookOpen, Camera, Compass, Download, Earth, FileText, Footprints, Inbox, Lightbulb, ListChecks, Luggage, Map as MapIcon,
  MapPin, Pencil, Route, Scale, Share2, Star, Sun, TriangleAlert, Undo2, Upload, Vote, Wallet, WifiOff,
} from 'lucide-react';
import Card from '@/components/common/Card';
import Input from '@/components/common/Input';
import toast from 'react-hot-toast';
import Modal from '@/components/common/Modal';
import PlanBasicsDialog from '@/components/planner/PlanBasicsDialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useToast } from '@/components/common/toastContext';
import { spotApiService } from '@/services/spotApi';
import { api as apiService } from '@/services/api';
import type { RoutePreview } from '@/services/api';
import PlanMap from '@/components/planner/PlanMap';
import MapTools from '@/components/planner/MapTools';
import MapOverlays from '@/components/planner/MapOverlays';
import MapTimelineFloat from '@/components/planner/MapTimelineFloat';
import { dayCheck } from '@/components/planner/mapCheckModel';
import { mapNumbers } from '@/components/planner/mapNumberModel';
import { localToday, nextEventIndexFor } from '@/components/planner/nextEventModel';
import type { EventBooking } from '@/services/api/bookingStatus';
import type { EventHoursCheck } from '@/services/api/types/g11planner';
import { dayAnchors } from '@/components/planner/journeyModel';
import { buildMapEnds } from '@/components/planner/mapEndsModel';
import AllDaysChart from '@/components/planner/AllDaysChart';
import VariantPanel from '@/components/planner/variants/VariantPanel';
import { usePlanVariants } from '@/components/planner/variants/usePlanVariants';
import { hoursBadge, insertIndexByTime, shiftedEnd, titleOfEvent, zoneOfEvent } from '@/components/planner/plannerModel';

const toMinutesHm = (v?: string | null): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(v ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
import { getSegments } from '@/services/api';
import type { TravelSegment } from '@/services/api/types/segments';
import SyncStatusBar from '@/components/planner/SyncStatusBar';
import PlanningUsageMeter from '@/components/planning/PlanningUsageMeter';
import PaidActionsPanel from '@/components/planning/PaidActionsPanel';
import type { RouteSummaryStatus } from '@/components/planner/RouteSummaryLine';
import DeletedPlansSection from './planner/DeletedPlansSection';
import PageHead from '@/components/shell/PageHead';
import Landscape from '@/components/shell/Landscape';
import TripList from '@/components/trip/TripList';
import type { ScheduleItem as ScheduleItemType, EventCategory, EventUrl } from '@/types';
import { getOfflinePackExpiry } from '@/utils/offlinePack';
import { getStoredOfflineKeyExpiry } from '@/utils/offlineVault';
// [Gate SpotLinks] 編集の窓の地図(開いた時だけ読む)
const SpotMiniMap = React.lazy(() => import('@/components/planner/SpotMiniMap'));
const HomePlaceDialog = React.lazy(() => import('@/components/settings/HomePlaceDialog'));
import { VisitDetector, type VisitSuggestion } from '@/utils/visitDetection';
import PresenceBar from '@/components/planner/PresenceBar';
import { usePlanPresence } from '@/hooks/usePlanPresence';
import MemberPolicyNotice from '@/components/planner/MemberPolicyNotice';
import { othersEditing } from '@/utils/presence';
import { usePlanHolidays } from '@/hooks/usePlanHolidays';
import { FIELD_LABEL, detectConflict, mergeMine, unreadConflict, type EditConflict, type EditFields } from '@/utils/editConflict';

// SearchPage.tsxから渡ってくる検索結果スポットの形状(最小限のフィールドのみ利用)
interface IncomingSpot {
  name: string;
  description?: string;
  category?: string;
  address?: string;
  location?: { latitude?: number; longitude?: number; address?: string };
  estimated_duration?: number;
  estimated_cost?: number;
  /** /search/spots の内部候補ID。旅程に追加する際に正規Placeへ採用する */
  candidate_id?: string;
}

// 日付から曜日を算出(DaySchedule型にday_of_weekフィールドが存在しないため、DayView.tsxと同じ方式)
const getDayOfWeek = (dateStr?: string): string => {
  if (!dateStr) return '';
  const labels = ['日', '月', '火', '水', '木', '金', '土'];
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return labels[d.getDay()] || '';
};

/** [Gate JourneyEnds] 日の最初・最後の行を DayView の引数にする */
const anchorsOf = (a: ReturnType<typeof dayAnchors>) => ({ startAnchor: a.start, endAnchor: a.end });

// [Gate PlanUX] 予定の種類(編集の画面の選択肢。EventCategory)
// [Gate PlanSpotEdit] 場所の情報の出典(OpenStreetMap の著作権と ODbL の案内)。応答の URL は使わず固定の値にする
const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright';

const EDIT_CATEGORIES: Array<[string, string]> = [
  ['sightseeing', '観光・神社・寺'], ['activity', '体験・アクティビティ'], ['dining', '食事・カフェ'], ['shopping', '…17217 tokens truncated…p gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/reservations`)}
                  icon={<UiIcon icon={Luggage} />}
                >
                  予約
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/imports`)}
                  icon={<UiIcon icon={Inbox} />}
                >
                  予約取込
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/documents`)}
                  icon={<UiIcon icon={FileText} />}
                >
                  文書
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/preparation`)}
                  icon={<UiIcon icon={ListChecks} />}
                >
                  準備
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/expenses`)}
                  icon={<UiIcon icon={Wallet} />}
                >
                  予算・費用
                </Button>
              </div>
            </div>
            <div role="group" aria-labelledby="planner-actions-3">
              <p id="planner-actions-3" className="text-xs font-semibold text-ink-700 mb-1">一緒に・出力</p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/share/${currentPlan.id}`)}
                  icon={<UiIcon icon={Share2} />}
                >
                  共有
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/discussion`)}
                  icon={<UiIcon icon={Vote} />}
                >
                  相談・投票
                </Button>
                {/* [Gate SpotMode] FR-060 自由に歩くエリア */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/spot-areas`)}
                  icon={<UiIcon icon={MapIcon} />}
                >
                  自由に歩くエリア
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/corrections`)}
                  icon={<UiIcon icon={Pencil} />}
                >
                  訂正の申し出
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/booklet`)}
                  icon={<UiIcon icon={BookOpen} />}
                >
                  しおり・印刷
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/exports`)}
                  icon={<UiIcon icon={Upload} />}
                >
                  書き出し
                </Button>
              </div>
            </div>
            <div role="group" aria-labelledby="planner-actions-4">
              <p id="planner-actions-4" className="text-xs font-semibold text-ink-700 mb-1">記録・振り返り</p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/memories`)}
                  icon={<UiIcon icon={Camera} />}
                >
                  旅の記録
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/journey`)}
                  icon={<UiIcon icon={Compass} />}
                >
                  振り返り
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/visits`)}
                  icon={<UiIcon icon={MapIcon} />}
                >
                  訪問の地図
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/atlas')}
                  icon={<UiIcon icon={Earth} />}
                >
                  旅の地図
                </Button>
              </div>
            </div>
          </nav>
          </section>

        </div>

        {/* スケジュールアイテム編集モーダル(Gate #18)。[Gate C1] 共同編集の競合を示す */}
        <Modal isOpen={!!editingItem} onClose={closeEditItem} title="スポットを編集">
          <Modal.Body>
            <div className="space-y-4">
              {editingOthers.length > 0 && !editConflict && (
                <p role="status" className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
                  {editingOthers.map((v) => `${v.label}さん`).join('・')}もこの予定を編集中です。先に保存された方が通り、
                  あとから保存した方には違いを示します(黙って上書きしません)。
                </p>
              )}
              {editConflict && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-3 text-sm text-red-900 space-y-2"
                  data-testid="edit-conflict">
                  {editConflict.unread ? (
                    <>
                      <p className="font-medium">
                        保存する前に、ほかの人かほかの端末がこの旅程を変更しました。あなたの入力は残っています。
                      </p>
                      <p data-testid="edit-conflict-unread">
                        最新の内容を読み直せなかったため、どの項目が変わったか(削除されたかどうかを含む)を示せません。
                        読み直してから、違いを確かめて保存してください。
                      </p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="sm" variant="primary" onClick={handleRereadAfterConflict} loading={isRereading}>
                          最新を読み直して違いを確かめる
                        </Button>
                      </div>
                    </>
                  ) : editConflict.deleted ? (
                    <p className="font-medium">この予定は、保存する前にほかの人が削除しました。</p>
                  ) : (
                    <>
                      <p className="font-medium">保存する前に、ほかの人がこの予定を変更しました。あなたの入力は残っています。</p>
                      {editConflict.theirs.length > 0 ? (
                        <ul className="list-disc ml-5">
                          {editConflict.theirs.map((k) => (
                            <li key={k}>
                              {FIELD_LABEL[k]}: ほかの人の値「{editConflict.latest?.[k] || '(空)'}」
                              {editConflict.both.includes(k) && <span>/ あなたの値「{editForm[k] || '(空)'}」</span>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>ほかの人が変えた項目はこの画面の項目にはありません(日程・並び順などの変更です)。</p>
                      )}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="sm" variant="primary" onClick={handleSaveMergedEdit} loading={isSavingItem}
                          disabled={editConflict.mine.length === 0}>
                          自分の変更を最新の内容に重ねて保存
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleEditFromLatest}>最新の内容で編集し直す</Button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {/* [Gate PlanSpotEdit] 写真があれば上に出す(無ければドラッグ&ドロップ・ファイルの選択で入れる) */}
              {currentPlan && editingItem && (
                <EventPhotoPanel planId={currentPlan.id} eventId={editingItem.id} eventTitle={editForm.title || editingItem.title}
                  near={typeof editingItem.latitude === 'number' && typeof editingItem.longitude === 'number'
                    ? { latitude: editingItem.latitude, longitude: editingItem.longitude } : null}
                  onChanged={() => setPhotoSignal((n) => n + 1)} />
              )}
              {/* [Gate PlanUX] 予定の編集: 名前と種類 → 時間(開始・終了を 1 行) → 場所 → メモ。営業時間は入力の必須ではない */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
                <Input
                  label="タイトル"
                  value={editForm.title}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
                  fullWidth
                />
                <label className="text-sm font-medium text-ink-700">
                  種類
                  <select value={editCategory.value} onChange={(e) => setEditCategory((c) => ({ ...c, value: e.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-cloud-200 bg-cloud-0 px-3 py-2 text-sm text-ink-900"
                    data-testid="edit-category">
                    {EDIT_CATEGORIES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                </label>
              </div>
              {/* [Gate EventArea] 同じ日のエリアの中へ入れる・外す(エリアの枠に字下げで並び、中の移動は数えない) */}
              {editingItem && editCategory.value !== 'area' && editAreas.length > 0 && (
                <label className="block text-sm font-medium text-ink-700">
                  エリアの中に入れる
                  <select value={editArea.value} onChange={(e) => setEditArea((a) => ({ ...a, value: e.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-cloud-200 bg-cloud-0 px-3 py-2 text-sm text-ink-900"
                    data-testid="edit-area">
                    <option value="">入れない</option>
                    {editAreas.map((a) => <option key={a.id} value={a.id}>{a.start_time ? `${a.start_time} ${a.title}` : a.title}</option>)}
                  </select>
                </label>
              )}
              {/* [Gate SpotInfo] 食事の情報(種類が「食事」か、もう入っている時) */}
              {(editCategory.value === 'dining' || editDining.value) && (
                <div className="rounded-xl border border-cloud-200 p-3">
                  <DiningFields value={editDining.value} onChange={(value) => setEditDining((d) => ({ ...d, value }))} />
                </div>
              )}
              {/* [Gate EventMoveDay] 日付(別の日へ移す。宿・食事・観光など全ての予定) */}
              {currentPlan && currentPlan.days.length > 1 && (
                <label className="block text-sm font-medium text-ink-700">
                  日付
                  <select value={editDay.value} onChange={(e) => setEditDay((d) => ({ ...d, value: Number(e.target.value) }))}
                    disabled={!!editingItem?.locked} data-testid="edit-day"
                    className="mt-1 block w-full rounded-lg border border-cloud-200 bg-cloud-0 px-3 py-2 text-sm text-ink-900">
                    {currentPlan.days.map((d, i) => <option key={d.id} value={i}>{`${i + 1}日目 ${dayLabel(i)}`}</option>)}
                  </select>
                  <span className="mt-1 block text-xs text-ink-700" data-testid="edit-day-note">
                    {editingItem?.locked ? '固定の予定なので日付は変えられません'
                      : editDay.value !== editDay.original ? `保存すると ${dayLabel(editDay.value)} へ移します(時刻はそのまま)`
                        : '別の日を選ぶと、保存でその日へ移します'}
                  </span>
                </label>
              )}
              <fieldset className="rounded-xl border border-cloud-200 p-3">
                <legend className="px-1 text-sm font-semibold text-ink-900">時間(任意)</legend>
                {/* [Gate PlanSpotEdit] 開始 〜 終了(既定は「この場所での時間」。印で終了時刻・終わる日付に切り替え) */}
                {currentPlan && editingItem && (
                  <EventTimeImpact key={editingItem.id} planId={currentPlan.id} eventId={editingItem.id} startTime={editForm.start_time}
                    onStartChange={(v) => setEditForm((prev) => ({ ...prev, start_time: v }))}
                    dayDate={currentPlan.days.find((d) => d.events.some((e) => e.id === editingItem.id))?.date ?? null}
                    end={editEnd} onEndChange={setEditEnd} />
                )}
              </fieldset>
              {/* [Gate G2] FR-045 所有者が見せない設定にした項目は入力を出さない */}
              {!currentPlan?.hidden_fields?.includes('event_address') && (
                <div className="space-y-2">
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <Input
                        label="場所・住所"
                        value={editForm.location_name}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, location_name: e.target.value }))}
                        fullWidth
                      />
                    </div>
                    {/* [Gate PlanSpotEdit] 課題 #3-⑤ 押した時に 1 回だけ OpenStreetMap で住所・電話番号・種類を調べる(入れる前に確かめる) */}
                    <Button type="button" variant="outline" size="sm" className="min-h-10 shrink-0" onClick={() => void lookupPlaceInfo()}
                      loading={placeInfo.busy && placeInfo.mode !== 'geo'} disabled={!editForm.title.trim() && typeof editingItem?.latitude !== 'number'}
                      icon={<Globe size={15} aria-hidden="true" />} data-testid="place-info-lookup"
                      title="名前と位置から、住所・電話番号・公式サイト・種類を調べます(入れる前に確かめられます)">
                      自動取得
                    </Button>
                  </div>
                  {placeInfo.error && <p role="status" className="text-xs text-ink-700" data-testid="place-info-error">{placeInfo.error}</p>}
                  {placeInfo.result && placeInfo.result.candidates.length > 0 && (
                    <div className="rounded-lg border border-cloud-200 bg-cloud-50 p-2 text-sm" data-testid="place-info-result">
                      <ul className="space-y-2">
                        {placeInfo.result.candidates.map((c, i) => (
                          <li key={`${c.source_url ?? i}`} className="flex items-start justify-between gap-2">
                            <span className="min-w-0">
                              <b className="block truncate text-ink-900">{c.name ?? '(名前なし)'}</b>
                              {c.address && <span className="block text-xs text-ink-700">{c.address}</span>}
                              {c.phone && <span className="block text-xs text-ink-700">{`TEL ${c.phone}`}</span>}
                              {c.website && <span className="block truncate text-xs text-ink-700">{c.website}</span>}
                              {c.notes?.map((n) => <span key={n} className="block text-xs text-ink-700">{n}</span>)}
                              {c.links?.map((l) => <span key={l.url} className="block truncate text-xs text-ink-700">{`${l.label ?? 'リンク'}: ${l.url}`}</span>)}
                              {candidateHint(c, placeInfo.result?.area) && (
                                <span className="block text-[11px] text-ink-600" data-testid={`place-info-hint-${i}`}>{candidateHint(c, placeInfo.result?.area)}</span>)}
                            </span>
                            <Button type="button" size="sm" variant="primary" className="shrink-0" onClick={() => applyPlaceInfo(c)}
                              data-testid={`place-info-use-${i}`}>{placeInfo.mode === 'geo' ? 'この位置にする' : '入れる'}</Button>
                          </li>
                        ))}
                      </ul>
                      {placeInfo.result.sources ? <PlaceSourcesCredit sources={placeInfo.result.sources} className="mt-2 text-[11px] text-ink-700" /> : (
                        <p className="mt-2 text-[11px] text-ink-700">
                          出典: <a href={safeExternalUrl(OSM_COPYRIGHT) ?? undefined} target="_blank" rel="noopener noreferrer" className="underline">
                            {placeInfo.result.attribution}</a>({placeInfo.result.license})。情報が古い・違う場合があります
                        </p>)}
                    </div>
                  )}
                  <Input
                    label="電話番号"
                    type="tel"
                    value={editPhone.value}
                    onChange={(e) => setEditPhone((p) => ({ ...p, value: e.target.value }))}
                    maxLength={40}
                    fullWidth
                  />
                  {/* [Gate SpotLinks] 場所の URL(初めは 1 行・＋で 5 件まで) */}
                  <EventUrlsField rows={editUrls.rows} onChange={(rows) => { setEditUrls((u) => ({ ...u, rows })); setUrlError(null); }}
                    error={urlError} />
                  {/* [Gate SpotLinks] 地図(位置がある時は街の縮尺で。印を動かして直せる)。位置が無ければ住所から探す */}
                  <div className="space-y-2" data-testid="edit-map">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink-700">地図の位置</span>
                      <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => void lookupPosition()}
                        loading={placeInfo.busy && placeInfo.mode === 'geo'}
                        disabled={!editForm.location_name.trim() && !editForm.title.trim()}
                        icon={<LocateFixed size={15} aria-hidden="true" />} data-testid="edit-map-lookup"
                        title="住所(無ければ名前)から地図の位置を探します(選んでから入れます)">
                        {editCoords.lat !== null ? '住所から位置を探し直す' : '住所から位置を探す'}
                      </Button>
                    </div>
                    {editCoords.lat !== null && editCoords.lng !== null ? (
                      <>
                        <React.Suspense fallback={<div className="h-[220px] rounded-xl bg-cloud-100" aria-hidden="true" />}>
                          <SpotMiniMap latitude={editCoords.lat} longitude={editCoords.lng} label={editForm.title || '予定の場所'}
                            onMove={(lat, lng) => setEditCoords({ lat, lng, changed: true })} />
                        </React.Suspense>
                        <p className="text-xs text-ink-700" data-testid="edit-map-note">
                          {editCoords.changed ? '位置を変えました(保存すると旅程の地図・移動の計算に使います)' : '印を動かすと位置を直せます'}
                        </p>
                      </>
                    ) : (
                      <p className="rounded-lg bg-cloud-100 px-3 py-2 text-xs text-ink-700" data-testid="edit-map-empty">
                        まだ地図の位置がありません。「住所から位置を探す」か「自動取得」で入れると、ここに地図が出ます。
                      </p>
                    )}
                  </div>
                </div>
              )}
              {!currentPlan?.hidden_fields?.includes('event_notes') && (
                <label className="block text-sm font-medium text-ink-700">
                  メモ(見どころ・予約の要否・持ち物など)
                  <textarea rows={3} value={editForm.notes} aria-label="メモ"
                    onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-cloud-200 bg-cloud-0 px-3 py-2 text-sm text-ink-900" />
                </label>
              )}
              {/* [Gate PlanSpotEdit] 課題 #3-⑧ この予定の予約・費用の要約(読むだけ) */}
              {currentPlan && editingItem && <EventRelatedSummary planId={currentPlan.id} eventId={editingItem.id} />}
              {currentPlan && (
                <p className="text-xs text-ink-700">
                  予約番号・チケットは
                  <Link to={`/planner/${currentPlan.id}/reservations`} className="mx-1 font-semibold text-accent underline">予約</Link>
                  、費用は
                  <Link to={`/planner/${currentPlan.id}/expenses`} className="mx-1 font-semibold text-accent underline">費用</Link>
                  に保存します。
                </p>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline" onClick={closeEditItem}>
              {editConflict?.deleted ? '閉じる' : 'キャンセル'}
            </Button>
            {!editConflict && (
              <Button
                variant="primary"
                onClick={handleSaveEditItem}
                loading={isSavingItem}
                disabled={!editForm.title.trim()}
              >
                保存
              </Button>
            )}
          </Modal.Footer>
        </Modal>
      </div>
    );
  }

  // [Gate MockScreens] クイック(モックの QUICK PLAN)の入力と旅行カードの予告。作成の画面と、クイックのページで同じものを使う
  const quickLayout = (
          <div className="tc-quick-layout">
            <div className="tc-card tc-quick-form">
              <div className="tc-section-row mb-2">
                <h3 className="tc-section-title">旅行の基本</h3>
                <span className="tc-pill tc-pill--blue">かんたん入力</span>
              </div>
              <div className="space-y-4">
                <Input
                  label="旅行の名前(任意、未入力なら自動で名付けます)"
                  value={newPlanTitle}
                  onChange={(e) => setNewPlanTitle(e.target.value)}
                  placeholder="例: 東京旅行"
                  fullWidth
                  autoFocus
                />
                <Input
                  label="行き先(任意)"
                  value={newPlanDestination}
                  onChange={(e) => setNewPlanDestination(e.target.value)}
                  placeholder="例: 東京"
                  fullWidth
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="出発日(任意)"
                    type="date"
                    value={newPlanStartDate}
                    onChange={(e) => setNewPlanStartDate(e.target.value)}
                    fullWidth
                  />
                  <Input
                    label="帰着日(任意)"
                    type="date"
                    value={newPlanEndDate}
                    onChange={(e) => setNewPlanEndDate(e.target.value)}
                    fullWidth
                  />
                </div>
                <div className="pt-2 border-t border-cloud-200">
                  <p className="text-sm font-medium text-ink-700 mb-3">最初に行きたい場所・予定(任意)</p>
                  <div className="space-y-3">
                    <Input
                      label="予定名"
                      value={newEventTitle}
                      onChange={(e) => setNewEventTitle(e.target.value)}
                      placeholder="例: ホテルチェックイン"
                      fullWidth
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label="時刻(任意)"
                        type="time"
                        value={newEventTime}
                        onChange={(e) => setNewEventTime(e.target.value)}
                        fullWidth
                      />
                      <Input
                        label="場所(任意)"
                        value={newEventLocation}
                        onChange={(e) => setNewEventLocation(e.target.value)}
                        placeholder="例: 東京駅"
                        fullWidth
                      />
                    </div>
                    <p className="text-xs text-ink-500">場所がまだ決まらなくても旅行を作れます。</p>
                  </div>
                </div>
              </div>
            </div>
            <aside className="tc-card tc-quick-preview" aria-label="旅行カードの予告">
              <p className="tc-label">旅行カード · プレビュー</p>
              <div className="tc-preview-card">
                <div className="tc-trip-thumb" style={{ width: '100%', height: 122 }}><Landscape /></div>
                <span className="tc-pill tc-pill--good mt-3">新しい旅行</span>
                <h3 data-testid="quick-preview-title">{newPlanTitle.trim() || (newPlanDestination.trim() ? `${newPlanDestination.trim()}の旅` : '名前は保存の時に付きます')}</h3>
                <p className="text-xs text-ink-500">
                  {[newPlanDestination.trim() || '行き先は未定',
                    newPlanStartDate ? `${newPlanStartDate}${newPlanEndDate && newPlanEndDate !== newPlanStartDate ? `〜${newPlanEndDate}` : ''}` : '日付は未定']
                    .join(' · ')}
                </p>
                {newEventTitle.trim() && (
                  <p className="text-xs text-ink-700 mt-1">{`最初の予定: ${newEventTime ? `${newEventTime} ` : ''}${newEventTitle.trim()}`}</p>
                )}
                <p className="text-xs text-ink-500 mt-2">行きたい場所から、あとで予定を整えられます。</p>
              </div>
              <ol className="mt-4" aria-label="旅行ができるまで">
                {['① 旅行を作る', '② 場所を集める', '③ 日程に並べる', '④ みんなと共有'].map((t) => (
                  <li key={t} className="tc-step-chip">{t}</li>
                ))}
              </ol>
            </aside>
          </div>
  );

  // [Gate MockScreens] 左の帯の「クイック」・ホームの「旅行をつくる」(/planner?new=1)は、モックと同じくページで開く
  if (isQuickPage) {
    return (
      <div className="tc-page tc-quick-page">
        <PageHead
          eyebrow="QUICK PLAN · クイック"
          title="まず、行きたい気持ちから"
          sub="目的地と日付だけで保存できます。時刻や予約はあとから追加できます。"
          actions={<button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => setIsQuickPage(false)}>旅行の一覧へ</button>}
        />
        <form onSubmit={(e) => { e.preventDefault(); void handleCreatePlan(); }} aria-label="クイックで旅行を作る">
          {quickLayout}
          <div className="tc-quick-submit">
            <Button variant="primary" type="submit" loading={isCreating}>この旅を保存して旅程へ →</Button>
          </div>
        </form>
      </div>
    );
  }

  // ===== 一覧画面 =====
  return (
    <div className="min-h-screen bg-cloud-50">
      <div className="tc-page">
        {/* [Gate AppShell] モックの page-head */}
        <PageHead
          eyebrow="TRIPS · 旅行の一覧"
          title="旅行"
          sub="旅行ごとに、日程・地図・予約・準備をひとつにまとめます。カードから旅程を開けます。"
          actions={(
            <>
              {/* [Gate G11] 行き先が未定なら相談から(段階5) */}
              <Button variant="outline" onClick={() => navigate('/trip-consult')}>✦ 条件から旅行先を相談</Button>
              <Button variant="primary" onClick={() => setIsCreateModalOpen(true)}>
                ＋ 新しい旅行
              </Button>
            </>
          )}
        />

        {isLoading ? (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" />
          </div>
        ) : plans.length === 0 ? (
          // [Gate AppShell] 監査 Gate App UX: 空の時は始め方を2つ(行き先が決まっている / まだ決まっていない)
          <section aria-labelledby="planner-empty-title" data-testid="planner-empty">
            <h2 id="planner-empty-title" className="tc-section-title mb-3">まだ旅行がありません。どちらから始めますか?</h2>
            <div className="tc-planner-empty">
              <div className="tc-card">
                <div className="tc-detail-art w-full">
                  <img src="/start/quick-plan.webp" alt="" loading="lazy" decoding="async" width={1200} height={526}
                    style={{ objectPosition: '50% 45%' }} />
                </div>
                <p className="tc-eyebrow">QUICK PLAN · 行き先が決まっている</p>
                <h2>行き先と日付だけで、旅行を作る</h2>
                <p>時刻・予約・持ち物は、あとから同じ旅行に足せます。決まっていない項目は空のままで保存できます。</p>
                <Button variant="primary" onClick={() => setIsCreateModalOpen(true)}>行き先を入れて作る →</Button>
              </div>
              <div className="tc-card">
                <div className="tc-detail-art w-full">
                  <img src="/start/trip-consult.webp" alt="" loading="lazy" decoding="async" width={1200} height={675}
                    style={{ objectPosition: '50% 40%' }} />
                </div>
                <p className="tc-eyebrow">TRIP CONSULT · まだ決まっていない</p>
                <h2>条件から、行き先を相談する</h2>
                <p>出発地・時期・人数・したいことから、方面の候補を並べて比べられます。</p>
                {isGuest && (
                  // [Gate DashPlan] ゲストは無料の範囲だけ(条件の整理・方面の比較・下書き)。AI の提案・Google の検索は会員の有料のクラス
                  <p className="rounded-lg border border-cloud-200 bg-cloud-100 px-3 py-2 text-xs text-ink-900" data-testid="planner-consult-guest">
                    ゲストでは、AI の方面の提案・おすすめの場所・Google の検索は使えません。条件の整理・方面の比較・下書きは使えます。
                    <Link to="/guest/upgrade" className="ml-1 font-semibold text-accent underline">アカウントを作成すると AI も使えます</Link>
                  </p>
                )}
                <Button variant="outline" onClick={() => navigate('/trip-consult')}>
                  {isGuest ? '✦ AI なしで相談をはじめる' : '✦ 旅行相談をはじめる'}
                </Button>
              </div>
            </div>
          </section>
        ) : (
          // [Gate TripsWish] 旅行のカード(表紙・状態・出発日と最終日・泊数・人数・メンバー・予定と写真の数・備考)と状態のタブ
          <TripList plans={plans} cloningId={cloningPlanId} onOpen={(id) => navigate(`/planner/${id}`)}
            onClone={(id, title) => handleClonePlan(id, title)} onDelete={(id) => handleDeletePlan(id)} />
        )}

        <DeletedPlansSection refreshKey={trashRefreshKey} onRestored={() => loadPlans()} />
      </div>

      {/* [Gate AppShell] モックの QUICK PLAN: 左に入力、右に旅行カードの予告。全て任意(未定でも保存できる) */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="新しい旅行プラン" size="xl">
        <Modal.Body>
          <p className="tc-eyebrow">QUICK PLAN · まず、行きたい気持ちから</p>
          <p className="tc-subhead mb-4">目的地と日付だけで保存できます。時刻や予約はあとから追加できます。</p>
          {quickLayout}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>
            キャンセル
          </Button>
          <Button
            variant="primary"
            onClick={handleCreatePlan}
            loading={isCreating}
          >
            作成して旅程へ →
          </Button>
        </Modal.Footer>

      </Modal>

      {/* 検索結果からのスポット追加モーダル(Gate #16) */}
      <Modal
        isOpen={isAddSpotModalOpen}
        onClose={() => {
          setIsAddSpotModalOpen(false);
          navigate('/planner', { replace: true, state: null });
        }}
        title="プランに追加"
      >
        <Modal.Body>
          <p className="text-sm text-ink-700 mb-4">
            「{incomingSpot?.name}」をどのプランに追加しますか？
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {plans.map((plan) => (
              <button
                key={plan.id}
                onClick={() => addSpotToExistingOrNewPlan(plan.id)}
                disabled={isAddingSpot}
                className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors disabled:opacity-50"
              >
                <div className="font-medium text-ink-900">{plan.title}</div>
                {plan.destination && (
                  <div className="text-xs text-ink-500"><UiIcon icon={MapPin} size={14} className="mr-1 align-[-2px]" />{plan.destination}</div>
                )}
              </button>
            ))}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="primary"
            onClick={() => addSpotToExistingOrNewPlan(undefined)}
            loading={isAddingSpot}
          >
            ＋ 新しいプランを作成して追加
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default PlannerPage;
