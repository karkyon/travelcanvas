/**
 * [Gate G6] OFF-01 オフラインで使う端末の一覧と失効。
 * 鍵は端末ごとに作り(30日で期限切れ)、失くした端末だけを失効できる。失効した端末は次に通信した時に保存データを消す。
 * この端末を失効した時は、すぐにこの端末の保存データ(オフラインの旅行・当日の画面の写し)を消し、端末の ID を作り直す。
 */
import React, { useCallback, useEffect, useState } from 'react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { getOfflineDevices, revokeOfflineDevice } from '@/services/api/g6';
import type { OfflineDevice, OfflineDeviceList } from '@/services/api/types/g6';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { clearAllOfflinePacks } from '@/utils/offlinePack';
import { clearSnapshots, forgetOfflineKeys, offlineDeviceId, resetOfflineDeviceId } from '@/utils/offlineVault';

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP') : '—');

const OfflineDevicesCard: React.FC = () => {
  const [data, setData] = useState<OfflineDeviceList | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getOfflineDevices(await offlineDeviceId()));
    } catch (e) {
      setError(errorDetailMessage(e, 'オフラインで使う端末の一覧を取得できませんでした'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (d: OfflineDevice) => {
    setBusy(d.id);
    setError(null);
    setMessage(null);
    try {
      await revokeOfflineDevice(d.id);
      if (d.is_current) {
        await Promise.allSettled([forgetOfflineKeys(), clearAllOfflinePacks(), clearSnapshots(), resetOfflineDeviceId()]);
        setMessage('この端末を失効し、この端末に保存していたオフラインのデータを消しました。');
      } else {
        setMessage(`「${d.label}」を失効しました。その端末は次に通信した時に保存データを消します。`);
      }
      await load();
    } catch (e) {
      setError(errorDetailMessage(e, '端末を失効できませんでした'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card padding="md" className="mt-4">
      <section aria-labelledby="offline-devices-heading">
        <h2 id="offline-devices-heading" className="font-semibold text-gray-900">オフラインで使う端末</h2>
        <p className="text-sm text-gray-700 mt-1">
          旅行をオフラインで使うために保存した端末です。保存データは端末ごとの鍵で暗号化し、鍵は30日で期限が切れます。
          失くした端末は失効すると、その端末の保存データは開けなくなります(他の端末はそのまま使えます)。
          端末の名前はブラウザとOSの種類だけです。
        </p>
        <div aria-live="polite">{message && <p className="text-sm text-green-900 mt-2" role="status">{message}</p>}</div>
        {error && <p className="text-sm text-red-800 mt-2" role="alert">{error}</p>}
        {!data && !error ? <div className="flex justify-center py-6"><LoadingSpinner /></div> : data && (
          data.devices.length === 0 ? (
            <p className="text-sm text-gray-700 mt-3">オフラインで使う端末はまだありません。</p>
          ) : (
            <ul className="mt-3 divide-y" aria-label="オフラインで使う端末の一覧">
              {data.devices.map((d) => (
                <li key={d.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-medium text-gray-900">{d.label}</span>
                    {d.is_current && <span className="ml-2 text-sm text-gray-700">(この端末)</span>}
                    <span className="block text-sm text-gray-700">
                      {d.revoked_at ? `失効しました(${formatDate(d.revoked_at)})` : `最後に鍵を受け取った日時: ${formatDate(d.last_key_at)}`}
                    </span>
                  </span>
                  {!d.revoked_at && (
                    <Button variant="outline" size="sm" loading={busy === d.id} disabled={busy !== null}
                      aria-label={`${d.label}${d.is_current ? '(この端末)' : ''}を失効する`} onClick={() => void revoke(d)}>
                      失効する
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
        {data && <p className="text-xs text-gray-700 mt-2">登録できる端末は{data.max_devices}台までです(失効した端末は数えません)。</p>}
      </section>
    </Card>
  );
};

export default OfflineDevicesCard;
