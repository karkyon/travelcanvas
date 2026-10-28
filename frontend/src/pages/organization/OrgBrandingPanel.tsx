/**
 * [Gate G5] ORG-01 組織のロゴ・席の上限・独自のドメインの確認と、BILL-02 組織の使用量(管理者の画面)。
 *
 * - ロゴ: PNG・JPEG・WebP(1MB・4096ピクセルまで)。サーバーが検査して 512 ピクセル以内の PNG に作り直す
 *   (撮影情報などは残らない)。メンバー全員に見える
 * - 席: 上限(空欄は上限なし。変えられるのは owner だけ)。上限に達するとメンバーを足せない
 * - ドメイン: 登録すると DNS の TXT に置く値を表示する。置いた後に「確認する」。確認済みは1つの組織だけ
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  addOrgDomain, deleteOrgLogo, getOrgDomains, getOrgSeats, getOrgUsage, putSeatLimit, revokeOrgDomain, uploadOrgLogo,
  verifyOrgDomain,
} from '@/services/api/g5';
import type { DomainStatus, OrgDomain, OrgSeats, UsageSummary } from '@/services/api/types/g5';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import OrgLogo from './OrgLogo';
import UsageList from '../settings/UsageList';

const sectionClass = 'bg-surface rounded-xl shadow-xs p-6 mb-6';
const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg';
const btn = 'px-3 py-2 rounded-lg text-sm disabled:opacity-50';
const DOMAIN_STATUS_LABEL: Record<DomainStatus, string> = {
  pending: '確認待ち', verified: '確認済み', failed: '確認できませんでした', revoked: '取り消し済み',
};
const SEAT_EVENT_LABEL = { join: '参加', leave: '脱退', limit: '上限の変更' } as const;

interface Props {
  orgId: string;
  isOwner: boolean;
  hasLogo: boolean;
  logoVersion: string | null;
  seatLimit: number | null;
  /** メンバーの数(変わったら席を読み直す) */
  memberCount?: number;
  /** ロゴ・席の上限を変えた後に組織を読み直す */
  onChanged: () => Promise<void> | void;
}

const OrgBrandingPanel: React.FC<Props> = ({ orgId, isOwner, hasLogo, logoVersion, seatLimit, memberCount, onChanged }) => {
  const [domains, setDomains] = useState<OrgDomain[]>([]);
  const [seats, setSeats] = useState<OrgSeats | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [domain, setDomain] = useState('');
  const [limit, setLimit] = useState(seatLimit === null ? '' : String(seatLimit));
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, s, u] = await Promise.all([getOrgDomains(orgId), getOrgSeats(orgId), getOrgUsage(orgId)]);
      setDomains(d);
      setSeats(s);
      setUsage(u);
    } catch (e) {
      setError(errorDetailMessage(e, '組織の設定を取得できませんでした'));
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load, memberCount]);

  useEffect(() => {
    setLimit(seatLimit === null ? '' : String(seatLimit));
  }, [seatLimit]);

  const run = async (fn: () => Promise<unknown>, ok: string, fallback: string, parent = false) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      await load();
      if (parent) await onChanged();
    } catch (e) {
      setError(errorDetailMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const limitValue = limit.trim() === '' ? null : Number(limit);
  const limitValid = limitValue === null || (Number.isInteger(limitValue) && limitValue >= 1);

  return (
    <>
      {error && <p role="alert" className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 border border-red-200">{error}</p>}
      {notice && <p role="status" className="mb-4 p-3 rounded-lg bg-green-50 text-green-900 border border-green-200">{notice}</p>}

      <section className={sectionClass} aria-labelledby="logo-heading">
        <h2 id="logo-heading" className="text-lg font-semibold text-ink-900 mb-3">ロゴ</h2>
        <div className="flex flex-wrap items-center gap-4">
          {hasLogo ? <OrgLogo orgId={orgId} version={logoVersion} size={64} /> : <p className="text-ink-700">ロゴはまだありません。</p>}
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
            e.preventDefault();
            if (!file) return;
            void run(() => uploadOrgLogo(orgId, file), 'ロゴを保存しました', 'ロゴを保存できませんでした', true).then(() => setFile(null));
          }}>
            <div>
              <label htmlFor="org-logo-file" className="block text-sm font-medium text-ink-900 mb-1">画像(PNG・JPEG・WebP、1MBまで)</label>
              <input id="org-logo-file" type="file" accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
            </div>
            <button type="submit" disabled={busy || !file} className={`${btn} bg-blue-700 text-white`}>ロゴを保存</button>
            {hasLogo && (
              <button type="button" disabled={busy} className={`${btn} border border-gray-400 text-ink-900`}
                onClick={() => void run(() => deleteOrgLogo(orgId), 'ロゴを外しました', 'ロゴを外せませんでした', true)}>
                ロゴを外す
              </button>
            )}
          </form>
        </div>
      </section>

      <section className={sectionClass} aria-labelledby="seats-heading">
        <h2 id="seats-heading" className="text-lg font-semibold text-ink-900 mb-3">席</h2>
        {seats && (
          <p className="text-ink-900 mb-3" data-testid="org-seats">
            使用中 {seats.seats_used}人・上限 {seats.seat_limit === null ? 'なし' : `${seats.seat_limit}人(残り ${seats.seats_remaining}人)`}
          </p>
        )}
        {isOwner && (
          <form className="flex flex-wrap items-end gap-2 mb-3" onSubmit={(e) => {
            e.preventDefault();
            if (!limitValid) return;
            void run(() => putSeatLimit(orgId, limitValue), '席の上限を保存しました', '席の上限を保存できませんでした', true);
          }}>
            <div>
              <label htmlFor="seat-limit" className="block text-sm font-medium text-ink-900 mb-1">席の上限(空欄は上限なし)</label>
              <input id="seat-limit" inputMode="numeric" className={inputClass} value={limit} onChange={(e) => setLimit(e.target.value)} />
            </div>
            <button type="submit" disabled={busy || !limitValid} className={`${btn} bg-blue-700 text-white`}>席の上限を保存</button>
          </form>
        )}
        {seats && seats.events.length > 0 && (
          <ul className="text-sm text-ink-700 space-y-1" aria-label="席の記録">
            {seats.events.slice(0, 5).map((ev, i) => (
              <li key={i}>{SEAT_EVENT_LABEL[ev.event]}(その後 {ev.seats_after}人){ev.created_at ? `・${ev.created_at.slice(0, 10)}` : ''}</li>
            ))}
          </ul>
        )}
      </section>

      <section className={sectionClass} aria-labelledby="domains-heading">
        <h2 id="domains-heading" className="text-lg font-semibold text-ink-900 mb-3">独自のドメイン</h2>
        {domains.length === 0 ? (
          <p className="text-ink-700 mb-3">登録したドメインはありません。</p>
        ) : (
          <ul className="space-y-3 mb-3" aria-label="ドメイン">
            {domains.map((d) => (
              <li key={d.id} className="border border-gray-200 rounded-lg p-3">
                <p className="font-medium text-ink-900">{d.domain}・{DOMAIN_STATUS_LABEL[d.status]}</p>
                {d.status !== 'verified' && d.status !== 'revoked' && (
                  <p className="text-sm text-ink-900 mt-1 break-all">
                    DNS の TXT レコード <code>{d.txt_name}</code> に <code>{d.txt_value}</code> を置いてから確認してください。
                  </p>
                )}
                {d.last_error && d.status !== 'verified' && (
                  <p className="text-sm text-amber-900 mt-1">
                    {d.last_error === 'txt_not_found' ? 'TXT レコードが見つかりませんでした(反映まで時間がかかることがあります)' : '名前解決に失敗しました'}
                  </p>
                )}
                {d.status !== 'revoked' && (
                  <div className="flex gap-2 mt-2">
                    {d.status !== 'verified' && (
                      <button type="button" disabled={busy} className={`${btn} bg-blue-700 text-white`}
                        aria-label={`${d.domain}を確認する`}
                        onClick={() => void run(() => verifyOrgDomain(orgId, d.id), `${d.domain}を確かめました`, 'ドメインを確認できませんでした', true)}>
                        確認する
                      </button>
                    )}
                    <button type="button" disabled={busy} className={`${btn} border border-gray-400 text-ink-900`}
                      aria-label={`${d.domain}を取り消す`}
                      onClick={() => {
                        if (!window.confirm(`${d.domain}を取り消しますか?`)) return;
                        void run(() => revokeOrgDomain(orgId, d.id), `${d.domain}を取り消しました`, 'ドメインを取り消せませんでした', true);
                      }}>
                      取り消す
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
          e.preventDefault();
          void run(() => addOrgDomain(orgId, domain.trim()), 'ドメインを登録しました。TXT レコードを置いてから確認してください',
            'ドメインを登録できませんでした').then(() => setDomain(''));
        }}>
          <div className="flex-1 min-w-48">
            <label htmlFor="org-domain" className="block text-sm font-medium text-ink-900 mb-1">ドメイン(例: example.co.jp)</label>
            <input id="org-domain" className={inputClass} value={domain} onChange={(e) => setDomain(e.target.value)} />
          </div>
          <button type="submit" disabled={busy || !domain.trim()} className={`${btn} bg-blue-700 text-white`}>ドメインを登録</button>
        </form>
      </section>

      {usage && (
        <section className={sectionClass} aria-labelledby="org-usage-heading">
          <h2 id="org-usage-heading" className="text-lg font-semibold text-ink-900 mb-3">今月の使用量({usage.period})</h2>
          <UsageList usage={usage} />
        </section>
      )}
    </>
  );
};

export default OrgBrandingPanel;
