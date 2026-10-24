/** [Gate G6] 守る範囲(LOC-02)とオフラインで使う端末(OFF-01)のカードの画面テスト。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fx from '@/services/api/__fixtures__/g6Responses.json';
import type { OfflineDeviceList, PrivacyZoneList } from '@/services/api/types/g6';

const g6 = vi.hoisted(() => ({
  getPrivacyZones: vi.fn(), createPrivacyZone: vi.fn(), deletePrivacyZone: vi.fn(),
  getOfflineDevices: vi.fn(), revokeOfflineDevice: vi.fn(),
}));
vi.mock('@/services/api/g6', () => g6);
const local = vi.hoisted(() => ({ forgetOfflineKeys: vi.fn(), clearSnapshots: vi.fn(), clearAllOfflinePacks: vi.fn(),
  offlineDeviceId: vi.fn(), resetOfflineDeviceId: vi.fn() }));
vi.mock('@/utils/offlineVault', () => ({ forgetOfflineKeys: local.forgetOfflineKeys, clearSnapshots: local.clearSnapshots,
  offlineDeviceId: local.offlineDeviceId, resetOfflineDeviceId: local.resetOfflineDeviceId }));
vi.mock('@/utils/offlinePack', () => ({ clearAllOfflinePacks: local.clearAllOfflinePacks }));

import OfflineDevicesCard from './OfflineDevicesCard';
import PrivacyZonesCard from './PrivacyZonesCard';
import { zoneInputProblem } from './privacyModel';

const zones = fx.privacy_zones as PrivacyZoneList;
const devices = fx.offline_devices as OfflineDeviceList;

beforeEach(() => {
  for (const fn of [...Object.values(g6), ...Object.values(local)]) fn.mockReset();
  for (const fn of Object.values(local)) fn.mockResolvedValue(undefined);
  local.offlineDeviceId.mockResolvedValue('this-device');
});

describe('PrivacyZonesCard', () => {
  it('一覧を出し、入力を確かめてから追加し、削除できる', async () => {
    g6.getPrivacyZones.mockResolvedValue({ ...zones, zones: [] });
    g6.createPrivacyZone.mockResolvedValue(zones.zones[0]);
    render(<PrivacyZonesCard />);
    expect(await screen.findByText('守る範囲はまだありません。')).toBeInTheDocument();
    const form = screen.getByRole('form', { name: '守る範囲を追加する' });
    fireEvent.click(within(form).getByRole('button', { name: '守る範囲を追加する' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('名前を入力してください');
    expect(g6.createPrivacyZone).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText('名前'), { target: { value: '自宅' } });
    fireEvent.change(within(form).getByLabelText('中心の緯度'), { target: { value: '35.0116' } });
    fireEvent.change(within(form).getByLabelText('中心の経度'), { target: { value: '135.7681' } });
    fireEvent.change(within(form).getByLabelText('半径'), { target: { value: '500' } });
    g6.getPrivacyZones.mockResolvedValue(zones);
    fireEvent.click(within(form).getByRole('button', { name: '守る範囲を追加する' }));
    await waitFor(() => expect(g6.createPrivacyZone).toHaveBeenCalledWith(
      { label: '自宅', latitude: 35.0116, longitude: 135.7681, radius_m: 500 }));
    expect(await screen.findByText('「自宅」を守る範囲にしました。')).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: '守る範囲の一覧' });
    expect(list).toHaveTextContent('半径 300m');
    g6.deletePrivacyZone.mockResolvedValue(undefined);
    g6.getPrivacyZones.mockResolvedValue({ ...zones, zones: [] });
    fireEvent.click(within(list).getByRole('button', { name: '自宅を削除する' }));
    await waitFor(() => expect(g6.deletePrivacyZone).toHaveBeenCalledWith(zones.zones[0]!.id));
    expect(await screen.findByText('守る範囲はまだありません。')).toBeInTheDocument();
  });

  it('読めない範囲は、その旨を出す。取得の失敗はエラー表示', async () => {
    g6.getPrivacyZones.mockResolvedValueOnce({ ...zones, zones: [{ ...zones.zones[0], latitude: null, longitude: null, readable: false }] });
    const { unmount } = render(<PrivacyZonesCard />);
    expect(await screen.findByText(/中心を読めません/)).toBeInTheDocument();
    unmount();
    g6.getPrivacyZones.mockRejectedValueOnce(new Error('x'));
    render(<PrivacyZonesCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('守る範囲を取得できませんでした');
  });

  it('入力の検査', () => {
    expect(zoneInputProblem('自宅', '91', '0')).toMatch(/緯度/);
    expect(zoneInputProblem('自宅', '35', '')).toMatch(/経度/);
    expect(zoneInputProblem('自宅', '35', '135')).toBeNull();
  });
});

describe('OfflineDevicesCard', () => {
  it('この端末を示し、別の端末の失効では保存データを消さない。この端末の失効では消す', async () => {
    const other = { ...devices.devices[0]!, id: 'd-other', label: 'Safari / iOS', is_current: false };
    g6.getOfflineDevices.mockResolvedValue({ ...devices, devices: [devices.devices[0], other] });
    g6.revokeOfflineDevice.mockResolvedValue({ ...other, revoked_at: '2026-10-23T00:00:00Z' });
    render(<OfflineDevicesCard />);
    const list = await screen.findByRole('list', { name: 'オフラインで使う端末の一覧' });
    expect(g6.getOfflineDevices).toHaveBeenCalledWith('this-device');
    expect(list).toHaveTextContent('(この端末)');
    fireEvent.click(within(list).getByRole('button', { name: 'Safari / iOSを失効する' }));
    expect(await screen.findByText(/「Safari \/ iOS」を失効しました/)).toBeInTheDocument();
    expect(local.forgetOfflineKeys).not.toHaveBeenCalled();
    fireEvent.click(within(list).getByRole('button', { name: `${devices.devices[0]!.label}(この端末)を失効する` }));
    expect(await screen.findByText(/この端末を失効し/)).toBeInTheDocument();
    expect(local.forgetOfflineKeys).toHaveBeenCalled();
    expect(local.clearAllOfflinePacks).toHaveBeenCalled();
    expect(local.clearSnapshots).toHaveBeenCalled();
    expect(local.resetOfflineDeviceId).toHaveBeenCalled();
  });

  it('失効の失敗はエラー表示', async () => {
    g6.getOfflineDevices.mockResolvedValue(devices);
    g6.revokeOfflineDevice.mockRejectedValue({ response: { status: 404, data: { detail: { code: 'offline_device_not_found', message: '端末が見つかりません' } } } });
    render(<OfflineDevicesCard />);
    fireEvent.click(await screen.findByRole('button', { name: /を失効する/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('端末が見つかりません');
  });
});
