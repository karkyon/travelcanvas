/**
 * DataPrivacyPage - データの書き出しと保持期間(SC-29 プライバシー・セキュリティ / FR-039)。
 *
 * [Gate P6] backend/app/api/v1/data_export.py の画面。
 *   - アカウントのデータを書き出す(本人のプロフィール・所有する旅行すべて・参加している旅行での本人の作成物)
 *   - 削除後・バックアップ・監査の保持期間を説明する
 * 旅行ごとのエクスポートは各旅行の「書き出し」画面で行う(所有者だけ)。
 * [Gate P9] 目的別の同意と撤回(ConsentsCard)、アカウントの削除(AccountDeletionCard)を追加。
 * [Gate G8] FR-039 出典・確認・履歴つきの訂正(CorrectionsCard)を追加。
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { downloadAccountDataExport, getRetentionInfo } from '@/services/api';
import type { RetentionInfo } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { describeDataExport, saveDataExport } from './exports/exportModel';
import AccountDeletionCard from './privacy/AccountDeletionCard';
import ConsentsCard from './privacy/ConsentsCard';
import OfflineDevicesCard from './privacy/OfflineDevicesCard';
import PrivacyZonesCard from './privacy/PrivacyZonesCard';
import CorrectionsCard from './privacy/CorrectionsCard';

const DataPrivacyPage: React.FC = () => {
  const navigate = useNavigate();
  const [retention, setRetention] = useState<RetentionInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRetentionInfo().then(setRetention).catch((e) => setLoadError(errorDetailMessage(e, '保持期間の説明を取得できませんでした')));
  }, []);

  const exportAccount = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const file = await downloadAccountDataExport();
      saveDataExport(file);
      setMessage(describeDataExport(file));
    } catch (e) {
      setError(errorDetailMessage(e, 'データの書き出しに失敗しました'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/settings')} className="mb-2">← 設定へ戻る</Button>
      <h1 className="text-2xl font-bold text-gray-900">データとプライバシー</h1>
      <p className="text-sm text-gray-700 mt-1">
        あなたのデータをファイルとして受け取れます。データの使い方への同意の変更、アカウントの削除、削除したデータがいつまで残るかの確認もできます。
      </p>

      <div aria-live="polite">
        {message && <div className="mt-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm break-all" role="status" data-testid="data-export-result">{message}</div>}
      </div>
      {error && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}

      <Card padding="md" className="mt-6">
        <section aria-labelledby="account-export">
          <h2 id="account-export" className="font-semibold text-gray-900">アカウントのデータを書き出す</h2>
          <p className="text-sm text-gray-700 mt-1">
            プロフィール、あなたが所有する旅行のすべてのデータ、参加している旅行であなたが作成・回答したもの、
            あなた宛ての通知を、1つのJSONファイルにまとめます。
          </p>
          <ul className="text-sm text-gray-700 mt-2 list-disc pl-5 space-y-1">
            <li>予約番号・PIN・名義・電話・チケットの中身は含めません。予約画面の「表示」で個別に確認できます。</li>
            <li>個人の持ち物・秘匿の条件・個人予算は、あなた本人の分だけを含めます。他の参加者の分は含めません。</li>
            <li>文書の原本ファイルは含めず、種類・サイズ・確認用のハッシュ値の一覧を含めます。原本は文書画面から取得できます。</li>
            <li>書き出したファイルは端末に保存されます。共有のパソコンでは保存後に削除してください。</li>
          </ul>
          <Button variant="primary" size="sm" className="mt-3" icon={<Download size={16} />} loading={busy} onClick={exportAccount}>
            アカウントのデータを書き出す
          </Button>
        </section>
      </Card>

      <Card padding="md" className="mt-4">
        <section aria-labelledby="retention-heading">
          <h2 id="retention-heading" className="font-semibold text-gray-900">削除したデータの保持期間</h2>
          {loadError && <p className="text-sm text-red-800 mt-2" role="alert">{loadError}</p>}
          {!retention && !loadError ? (
            <div className="flex justify-center py-6"><LoadingSpinner /></div>
          ) : retention && (
            <dl className="mt-2 divide-y" data-testid="retention-list">
              {retention.items.map((i) => (
                <div key={i.key} className="py-2">
                  <dt className="font-medium text-gray-900">{i.label}<span className="ml-2 text-sm font-normal text-gray-700">{i.period}</span></dt>
                  <dd className="text-sm text-gray-700 mt-0.5">{i.note}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-sm text-gray-700 mt-3">旅行の削除は各旅行の画面から行えます。</p>
        </section>
      </Card>

      <CorrectionsCard />
      <PrivacyZonesCard />
      <OfflineDevicesCard />
      <ConsentsCard />
      <AccountDeletionCard onDeleted={() => navigate('/account-deleted', { replace: true })} />
    </div>
  );
};

export default DataPrivacyPage;
