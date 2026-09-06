/**
 * [Gate #37] Visited Area Layer: GPS自動判定コアロジック
 *
 * ブラウザの制約について(重要な限界の明記):
 * PWAはネイティブアプリと異なり、タブを閉じた状態でのバックグラウンド
 * GPS追跡はできない。このモジュールはタブが開いている間のみ動作し、
 * 「常時追跡」であるかのような誤解を与える表現は避ける。
 *
 * 判定の考え方:
 * 各対象地点(緯度経度を持つ日程イベント)について、現在地との距離が
 * PROXIMITY_RADIUS_METERS以内である状態がMIN_DWELL_MS以上継続したら
 * 「訪問候補」として呼び出し元へ通知する。信頼度(confidence, 0〜1)は
 * 滞在時間とGPS測位精度から単純な式で算出する — 高度な統計的推定では
 * なく、あくまで目安であることをUI側でも明示すること。
 *
 * 自動確定はしない。呼び出し元(UI)が候補をユーザーに提示し、
 * ユーザーが明示的に確定した場合のみ訪問記録として保存される
 * (DOC-10の「自動処理は無断更新せず承認を要する」方針に従う)。
 */

const PROXIMITY_RADIUS_METERS = 100;
const MIN_DWELL_MS = 3 * 60 * 1000; // 3分
const MAX_USABLE_ACCURACY_METERS = 200; // これより精度が悪い測位は無視する

export interface VisitDetectionTarget {
  /** 日程イベントID(重複通知の抑制に使う) */
  eventId: string;
  /** UserSpotVisit保存に必要なスポットID。無いイベントは対象外。 */
  spotId: string;
  title: string;
  latitude: number;
  longitude: number;
}

export interface VisitSuggestion {
  eventId: string;
  spotId: string;
  title: string;
  confidence: number;
  accuracyMeters: number;
  dwellMs: number;
}

interface DwellState {
  enteredAt: number;
  lastAccuracy: number;
}

/**
 * ハーバサイン公式による2点間の距離(メートル)
 */
export function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // 地球半径(メートル)
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 滞在時間とGPS精度から信頼度(0〜1)を算出する。
 * 単純な線形結合であり、統計的に厳密な推定ではない。
 */
export function calculateConfidence(dwellMs: number, accuracyMeters: number): number {
  const dwellScore = Math.min(dwellMs / (10 * 60 * 1000), 1); // 10分でスコア1.0に到達
  const accuracyPenalty = Math.min(accuracyMeters / MAX_USABLE_ACCURACY_METERS, 1);
  const raw = 0.5 + 0.5 * dwellScore - 0.4 * accuracyPenalty;
  return Math.max(0, Math.min(1, raw));
}

export class VisitDetector {
  private watchId: number | null = null;
  private dwellStates = new Map<string, DwellState>();
  private suggestedEventIds = new Set<string>();

  constructor(
    private targets: VisitDetectionTarget[],
    private onSuggestion: (suggestion: VisitSuggestion) => void,
    private onError?: (message: string) => void
  ) {}

  isSupported(): boolean {
    return 'geolocation' in navigator;
  }

  start(): void {
    if (!this.isSupported()) {
      this.onError?.('このブラウザは位置情報の取得に対応していません');
      return;
    }
    if (this.watchId !== null) {
      return; // 既に開始済み
    }
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handlePosition(pos),
      (err) => {
        this.onError?.(this.describeError(err));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30_000,
        timeout: 20_000,
      }
    );
  }

  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.dwellStates.clear();
  }

  updateTargets(targets: VisitDetectionTarget[]): void {
    this.targets = targets;
  }

  private handlePosition(pos: GeolocationPosition): void {
    const { latitude, longitude, accuracy } = pos.coords;
    const now = Date.now();

    for (const target of this.targets) {
      if (this.suggestedEventIds.has(target.eventId)) {
        continue; // 既にこのセッションで提案済み
      }

      const distance = distanceMeters(latitude, longitude, target.latitude, target.longitude);
      const withinRadius = distance <= PROXIMITY_RADIUS_METERS;

      const state = this.dwellStates.get(target.eventId);

      if (withinRadius) {
        if (!state) {
          this.dwellStates.set(target.eventId, { enteredAt: now, lastAccuracy: accuracy });
        } else {
          state.lastAccuracy = accuracy;
          const dwellMs = now - state.enteredAt;
          if (dwellMs >= MIN_DWELL_MS) {
            const confidence = calculateConfidence(dwellMs, state.lastAccuracy);
            this.suggestedEventIds.add(target.eventId);
            this.dwellStates.delete(target.eventId);
            this.onSuggestion({
              eventId: target.eventId,
              spotId: target.spotId,
              title: target.title,
              confidence,
              accuracyMeters: state.lastAccuracy,
              dwellMs,
            });
          }
        }
      } else if (state) {
        // 範囲外に出たら滞在計測をリセットする(往来しただけの誤検知を防ぐ)
        this.dwellStates.delete(target.eventId);
      }
    }
  }

  private describeError(error: GeolocationPositionError): string {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        return '位置情報の利用が許可されていません。ブラウザの設定を確認してください。';
      case error.POSITION_UNAVAILABLE:
        return '位置情報を取得できませんでした。';
      case error.TIMEOUT:
        return '位置情報の取得がタイムアウトしました。';
      default:
        return '位置情報の取得中に不明なエラーが発生しました。';
    }
  }
}
