import React, { useCallback, useEffect, useState } from 'react';
import { api as apiService, AuthApiError } from '@/services/api';
import type { MfaSetup, MfaStatus } from '@/services/api';
import LocalQrCode from '@/components/share/LocalQrCode';

/**
 * [Gate S11] 設定 → セキュリティ「多要素認証(認証アプリ)」。SEC-06。
 *
 * パスワードが漏れても、認証アプリの6桁の確認コードが無ければログインできないようにする。管理者は必須
 * (管理者の画面は、設定した上でこのセッションで確認コードを通した時だけ使える)。会員は任意。
 * - 設定: 現在のパスワード → QR コード(端末内で作る。秘密を外部へ送らない)と手入力用のキー → 確認コード
 *   → 回復コード(1回だけ表示。端末をなくした時に使う)
 * - 有効な時: 回復コードの作り直し、無効化(どちらもパスワード + 確認コード)
 * 秘密・回復コードは画面の状態にだけ持ち、端末に保存しない。
 */

type Step = 'idle' | 'password' | 'scan' | 'codes' | 'disable' | 'regenerate';
type Status = { type: 'success' | 'error'; text: string } | null;

function message(error: unknown, fallback: string): string {
  return error instanceof AuthApiError || error instanceof Error ? error.message || fallback : fallback;
}

function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent';
const primary =
  'px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50';
const secondary =
  'px-4 py-2 rounded-lg text-sm font-medium text-gray-800 border border-gray-400 hover:bg-gray-100 disabled:opacity-50';

const MfaSection: React.FC = () => {
  const [status, setStatusState] = useState<MfaStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Status>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      setStatusState(await apiService.getMfaStatus());
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = () => {
    setStep('idle');
    setPassword('');
    setCode('');
    setSetup(null);
  };

  const startSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      setSetup(await apiService.setupMfa(password));
      setPassword('');
      setStep('scan');
    } catch (error) {
      setNotice({ type: 'error', text: message(error, '設定を始められませんでした') });
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const result = await apiService.enableMfa(code.trim());
      setCodes(result.recovery_codes);
      setSetup(null);
      setCode('');
      setStep('codes');
      await load();
    } catch (error) {
      setNotice({ type: 'error', text: message(error, '有効にできませんでした') });
    } finally {
      setBusy(false);
    }
  };

  const submitWithCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      if (step === 'disable') {
        await apiService.disableMfa(password, code.trim());
        reset();
        setNotice({ type: 'success', text: '多要素認証を無効にしました。ほかの端末はログアウトしました。' });
      } else {
        const result = await apiService.regenerateRecoveryCodes(password, code.trim());
        setPassword('');
        setCode('');
        setCodes(result.recovery_codes);
        setStep('codes');
      }
      await load();
    } catch (error) {
      setNotice({ type: 'error', text: message(error, '操作できませんでした') });
    } finally {
      setBusy(false);
    }
  };

  const copyCodes = async () => {
    if (!codes) return;
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setNotice({ type: 'success', text: '回復コードをコピーしました。安全な場所に保存してください。' });
    } catch {
      setNotice({ type: 'error', text: 'コピーできませんでした。表示されている回復コードを書き写してください。' });
    }
  };

  return (
    <section aria-labelledby="mfa-heading" className="border-t pt-6">
      <h3 id="mfa-heading" className="text-lg font-semibold text-gray-900 mb-2">多要素認証(認証アプリ)</h3>
      <p className="text-sm text-gray-700 mb-4">
        ログインの時に、パスワードに加えて認証アプリ(Google Authenticator・Microsoft Authenticator など)の
        6桁の確認コードを求めます。パスワードが漏れても、確認コードが無ければログインできません。
      </p>

      {loadError && (
        <p role="alert" className="text-sm text-red-700">
          状態を読み込めませんでした。
          <button type="button" className="ml-2 underline" onClick={() => void load()}>再読み込み</button>
        </p>
      )}

      {status && status.required && !status.enabled && (
        <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          管理者のアカウントです。管理者の画面を使うには、多要素認証を有効にしてください。
        </p>
      )}

      {notice && (
        <p role={notice.type === 'error' ? 'alert' : 'status'}
          className={`mb-4 text-sm ${notice.type === 'error' ? 'text-red-700' : 'text-green-800'}`}>
          {notice.text}
        </p>
      )}

      {status && step === 'idle' && (
        status.enabled ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-900" data-testid="mfa-state">
              <span className="font-semibold text-green-800">有効</span>
              (回復コードの残り {status.recovery_codes_remaining} 個)
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secondary} onClick={() => { setNotice(null); setStep('regenerate'); }}>
                回復コードを作り直す
              </button>
              <button type="button" className={secondary} onClick={() => { setNotice(null); setStep('disable'); }}>
                多要素認証を無効にする
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-900" data-testid="mfa-state">未設定</p>
            <button type="button" className={primary} onClick={() => { setNotice(null); setStep('password'); }}>
              多要素認証を設定する
            </button>
          </div>
        )
      )}

      {step === 'password' && (
        <form onSubmit={startSetup} className="space-y-3 max-w-md">
          <label htmlFor="mfa-current-password" className="block text-sm font-medium text-gray-700">
            確認のため、現在のパスワードを入力してください
          </label>
          <input id="mfa-current-password" type="password" autoComplete="current-password" className={inputClass}
            value={password} onChange={(e) => setPassword(e.target.value)} required />
          <div className="flex gap-2">
            <button type="submit" className={primary} disabled={busy || !password}>次へ</button>
            <button type="button" className={secondary} onClick={reset} disabled={busy}>やめる</button>
          </div>
        </form>
      )}

      {step === 'scan' && setup && (
        <form onSubmit={confirmSetup} className="space-y-4 max-w-md">
          <ol className="list-decimal pl-5 text-sm text-gray-800 space-y-1">
            <li>認証アプリで QR コードを読み取ってください(読み取れない時は下のキーを手で入力します)。</li>
            <li>アプリに表示された6桁の確認コードを入力してください。</li>
          </ol>
          <LocalQrCode value={setup.otpauth_uri} size={180} label="認証アプリに登録する QR コード" />
          <div>
            <p className="text-sm font-medium text-gray-700">手入力用のキー</p>
            <code className="block break-all rounded bg-gray-100 px-2 py-1 text-sm text-gray-900" data-testid="mfa-secret"
              data-secret={setup.secret}>
              {groupSecret(setup.secret)}
            </code>
          </div>
          <div>
            <label htmlFor="mfa-setup-code" className="block text-sm font-medium text-gray-700">確認コード(6桁)</label>
            <input id="mfa-setup-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={8}
              className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
          <div className="flex gap-2">
            <button type="submit" className={primary} disabled={busy || !code.trim()}>有効にする</button>
            <button type="button" className={secondary} onClick={reset} disabled={busy}>やめる</button>
          </div>
        </form>
      )}

      {step === 'codes' && codes && (
        <div className="space-y-3 max-w-md" aria-labelledby="mfa-codes-heading">
          <h4 id="mfa-codes-heading" className="font-semibold text-gray-900">回復コード</h4>
          <p className="text-sm text-gray-800">
            端末をなくした時に、確認コードの代わりに1回ずつ使えます。この画面を閉じると二度と表示されません。
            印刷するか、パスワード管理アプリなどの安全な場所に保存してください。
          </p>
          <ul className="grid grid-cols-2 gap-1 rounded bg-gray-100 p-3 font-mono text-sm text-gray-900"
            data-testid="mfa-recovery-codes">
            {codes.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <div className="flex gap-2">
            <button type="button" className={secondary} onClick={() => void copyCodes()}>コピー</button>
            <button type="button" className={primary} onClick={() => { setCodes(null); setStep('idle'); setNotice(null); }}>
              保存しました
            </button>
          </div>
        </div>
      )}

      {(step === 'disable' || step === 'regenerate') && (
        <form onSubmit={submitWithCode} className="space-y-3 max-w-md">
          <p className="text-sm text-gray-800">
            {step === 'disable'
              ? '無効にすると、パスワードだけでログインできるようになり、ほかの端末はログアウトします。'
              : '作り直すと、今までの回復コードは使えなくなります。'}
            {step === 'disable' && status?.is_admin && ' 管理者の画面は使えなくなります。'}
          </p>
          <label htmlFor="mfa-confirm-password" className="block text-sm font-medium text-gray-700">現在のパスワード</label>
          <input id="mfa-confirm-password" type="password" autoComplete="current-password" className={inputClass}
            value={password} onChange={(e) => setPassword(e.target.value)} required />
          <label htmlFor="mfa-confirm-code" className="block text-sm font-medium text-gray-700">
            確認コード{step === 'disable' ? '(または回復コード)' : '(6桁)'}
          </label>
          <input id="mfa-confirm-code" type="text" autoComplete="one-time-code" maxLength={32} className={inputClass}
            value={code} onChange={(e) => setCode(e.target.value)} required />
          <div className="flex gap-2">
            <button type="submit" className={primary} disabled={busy || !password || !code.trim()}>
              {step === 'disable' ? '無効にする' : '作り直す'}
            </button>
            <button type="button" className={secondary} onClick={reset} disabled={busy}>やめる</button>
          </div>
        </form>
      )}
    </section>
  );
};

export default MfaSection;
