/**
 * [Gate HomeHeroVideo] HOME の「最初の旅行を始めましょう」の背景の動画(4場面・7秒ごと)。
 *
 * **素材は利用者から受け取った、利用権のある版だけを書く**(透かし入りのプレビュー・想像で作った素材・他の画面の流用は書かない)。
 * 受け取った素材の名前・長さ・比率・解像度・codec・容量・権利は `docs/ux/home-hero-video-assets.md` の台帳に書いてから、ここへ足す。
 * 空の間は、以前と同じ山並みの絵を表示する(画面は変わらない)。
 *
 * - src は配信の場所(CDN・object storage・`/hero/…`)。版を URL に含め(例 `…/v1/…`)、長い Cache-Control で配る
 * - sources は端末が読める形式を上から選ぶ(例: AV1/WebM → H.264/MP4)。poster は軽い静止画(動きを減らす設定・読めない時に表示)
 */
export interface HeroVideoSource {
  src: string;
  /** 例 'video/webm; codecs="av01.0.05M.08"'、'video/mp4; codecs="avc1.640028"' */
  type: string;
}

export interface HeroScene {
  id: string;
  /** 画面に出す短い説明(読み上げには出さない飾りの背景のため、表示しない時は空でよい) */
  label: string;
  sources: HeroVideoSource[];
  poster: string;
}

export const HERO_ROTATE_MS = 7000;
export const HERO_FADE_MS = 600;
/** 次の場面を読み始める時刻(切り替えの何ミリ秒前か)。4本を一度に読まない */
export const HERO_PRELOAD_LEAD_MS = 2500;

/** 受け取った素材(台帳に書いた後に足す)。最大 4 */
export const HERO_SCENES: HeroScene[] = [];
