/**
 * [Gate TDay-Push] 端末への通知(Web Push)。backend/app/api/v1/push.py と、ブラウザの購読(Push API)。
 * 最初に読む JS を小さく保つため、当日の設定を開いた時だけ読む(CompleteTravelAPI には足さない)。
 *
 * - https で開いた画面だけ(ブラウザの決まり)。iPhone はホーム画面に追加したアプリから(iOS 16.4 以降)
 * - 購読は送り手の公開鍵(VAPID)ごと。backend の鍵が替わったら、開いた時に取り直す(ensureFresh)
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { arrayOf, bool, decodeResponse, nullable, object, str, type Decoder } from './decode';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };
export const PUSH_SW_URL = '/tc-push-sw.js';

export type PushKind = 'depart' | 'rain' | 'morning' | 'crew';
export type PushKinds = Record<PushKind, boolean>;
export interface PushDevice { id: string | null; label: string | null; at: string | null; current_key: boolean }
export interface PushConfig {
  available: boolean; public_key: string | null; kinds: PushKinds; devices: PushDevice[]; notice: string;
}
export interface PushTestResult extends PushConfig { sent: number; removed: number; failed: number }

const kinds: Decoder<PushKinds> = object<PushKinds>({ depart: bool, rain: bool, morning: bool, crew: bool });
const config: Decoder<PushConfig> = object<PushConfig>({
  available: bool, public_key: nullable(str), kinds, notice: str,
  devices: arrayOf(object<PushDevice>({ id: nullable(str), label: nullable(str), at: nullable(str), current_key: bool })),
});

export async function getPushConfig(): Promise<PushConfig> {
  return decodeResponse((await api.get('/push/config', SILENT)).data, config, 'GET /push/config');
}
export async function putPushKinds(changes: Partial<PushKinds>): Promise<PushConfig> {
  return decodeResponse((await api.put('/push/settings', changes, SILENT)).data, config, 'PUT /push/settings');
}
export async function sendTestPush(): Promise<PushTestResult> {
  const r = await api.post('/push/test', {}, SILENT);
  const base = decodeResponse(r.data, config, 'POST /push/test');
  const raw = r.data as Record<string, unknown>;
  const n = (k: string) => (typeof raw[k] === 'number' ? (raw[k] as number) : 0);
  return { ...base, sent: n('sent'), removed: n('removed'), failed: n('failed') };
}

// ---- ブラウザ側 ------------------------------------------------------------------------------------------------

export type PushSupport = 'ok' | 'insecure' | 'unsupported' | 'ios_needs_home_screen';

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  const nav = window.navigator;
  const hasApi = 'serviceWorker' in nav && 'PushManager' in window && 'Notification' in window;
  const ios = /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || (nav as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return 'ios_needs_home_screen';
  return hasApi ? 'ok' : 'unsupported';
}

export function permissionState(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** URL 安全な base64 → applicationServerKey に渡すバイト列 */
export function keyBytes(b64u: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
  const raw = atob((b64u + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function toB64u(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sameKey(sub: PushSubscription, publicKey: string): boolean {
  return toB64u(sub.options?.applicationServerKey ?? null) === publicKey;
}

export function deviceLabel(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iPhone' : /Mac OS X/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'この端末';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} ${br}` : os;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register(PUSH_SW_URL, { scope: '/' });
  await navigator.serviceWorker.ready;
  return reg;
}

async function register(sub: PushSubscription): Promise<PushConfig> {
  const json = sub.toJSON();
  const body = { endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    label: deviceLabel() };
  return decodeResponse((await api.post('/push/subscriptions', body, SILENT)).data, config, 'POST /push/subscriptions');
}

/** 通知を許可してもらい、この端末を登録する(押した時だけ呼ぶ。許可の確認はブラウザが出す) */
export async function enablePush(publicKey: string): Promise<PushConfig> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied'
    ? '通知がブロックされています。ブラウザ(端末)の設定でこのサイトの通知を許可してください'
    : '通知の許可がありませんでした');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, publicKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub = sub ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  return register(sub);
}

/** この端末の登録をやめる */
export async function disablePush(): Promise<PushConfig> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  let out: PushConfig | null = null;
  if (sub) {
    out = decodeResponse((await api.post('/push/subscriptions/remove', { endpoint: sub.endpoint }, SILENT)).data,
      config, 'POST /push/subscriptions/remove');
    await sub.unsubscribe();
  }
  return out ?? getPushConfig();
}

/**
 * この端末が登録済みか。許可があれば backend の登録を合わせ直す(窓口に外された・送り手の鍵が替わった時に取り直す)。
 * 戻り値は合わせ直した後の設定(登録していなければ null)
 */
export async function syncThisDevice(cfg: PushConfig): Promise<PushConfig | null> {
  if (pushSupport() !== 'ok' || !cfg.available || !cfg.public_key) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub || permissionState() !== 'granted') return null;
  if (!sameKey(sub, cfg.public_key)) return enablePush(cfg.public_key);
  return register(sub);
}
