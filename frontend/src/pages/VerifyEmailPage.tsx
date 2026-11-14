/** [Gate Remaining-6] FR-003 メールの確認(/verify-email?token=…)。開くと確認を送り、結果を出す */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { verifyEmail } from '@/services/api/accountRecovery';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const VerifyEmailPage: React.FC = () => {
  const [params] = useSearchParams();
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const token = params.get('token');
    if (!token) { setState({ ok: false, text: 'リンクが正しくありません' }); return; }
    verifyEmail(token).then((r) => setState({ ok: true, text: r.message }))
      .catch((e) => setState({ ok: false, text: errorDetailMessage(e, 'メールを確認できませんでした') }));
  }, [params]);
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 space-y-4">
        <h1 className="text-2xl font-bold text-ink-900">メールの確認</h1>
        {!state ? <p role="status" className="text-sm text-ink-700">確かめています…</p> : (
          <p role={state.ok ? 'status' : 'alert'} className={`p-3 rounded-lg text-sm ${state.ok ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-800'}`}>{state.text}</p>
        )}
        <p className="text-center text-sm"><Link to="/dashboard" className="text-blue-700 underline">ホームへ</Link></p>
      </div>
    </main>
  );
};

export default VerifyEmailPage;
