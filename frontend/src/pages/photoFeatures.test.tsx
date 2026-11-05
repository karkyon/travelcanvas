/**
 * [Gate MyMaps・PhotoQR・BookingImport] 新しい画面の試験(API は模擬)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { exifTimeToIso, readExifInfo } from '@/components/search/findModel';
import { jpegWithGps } from '@/components/search/findModel.fixture';
import { loginNextPath } from '@/utils/safeNavigation';

const m = vi.hoisted(() => ({
  getMyMapsPreview: vi.fn(), downloadMyMapsKml: vi.fn(), getExternalMaps: vi.fn(), saveExternalMap: vi.fn(),
  deleteExternalMap: vi.fn(), createUploadLink: vi.fn(), getUploadLinks: vi.fn(), revokeUploadLink: vi.fn(),
  viewUploadLink: vi.fn(), joinUploadLink: vi.fn(), openUploadSession: vi.fn(), uploadWithSession: vi.fn(),
  uploadAsMember: vi.fn(), extractReservationText: vi.fn(), extractReservationFile: vi.fn(),
}));
vi.mock('@/services/api/photoFeatures', () => m);

import MyMapsCard from './exports/MyMapsCard';
import BookingExtractCard from './imports/BookingExtractCard';
import PhotoQrCard from './memories/PhotoQrCard';
import PhotoUploadPage from './PhotoUploadPage';

const preview = {
  precision: 'exact', exclude_accommodation: true, count: 2, excluded: 1, over_limit: false, many_days: false,
  no_location: [{ title: '昼食', date: '2026-04-11' }],
  days: [{ date: '2026-04-10', route_urls: ['https://www.google.com/maps/dir/?api=1&origin=1,2&destination=3,4'],
    points: [{ label: '兼六園', time: '10:00', event_type: 'sight' }, { label: '美術館', time: null, event_type: 'sight' }] }],
};

// jsdom の Blob は arrayBuffer を持たないことがある
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(this);
    });
  };
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.getMyMapsPreview.mockResolvedValue(preview);
  m.getExternalMaps.mockResolvedValue([]);
  m.getUploadLinks.mockResolvedValue([]);
});

describe('EXIF の読み取り', () => {
  it('位置と時刻を別に返し、時刻を ISO にする', () => {
    expect(readExifInfo(jpegWithGps(36.5, 136.6)).gps?.latitude).toBeCloseTo(36.5);
    expect(readExifInfo(new ArrayBuffer(8))).toEqual({ gps: null, takenAt: null });
    expect(exifTimeToIso('2026:04:10 15:12:00')).toBe(new Date(2026, 3, 10, 15, 12, 0).toISOString());
    expect(exifTimeToIso('0000:00:00 00:00:00')).toBeNull();
    expect(exifTimeToIso(null)).toBeNull();
  });
});

describe('ログイン後の戻り先', () => {
  it('写真の投稿ページだけを許す', () => {
    expect(loginNextPath('?next=%2Fu%2Fabcdefghij12')).toBe('/u/abcdefghij12');
    expect(loginNextPath('?next=https%3A%2F%2Fevil.example')).toBeNull();
    expect(loginNextPath('?next=%2F%2Fevil.example%2Fu%2Fabcdefghij')).toBeNull();
    expect(loginNextPath('')).toBeNull();
  });
});

describe('MyMapsCard', () => {
  it('初期値は正確な位置で、地点・位置なし・除外・経路を見せる', async () => {
    render(<MyMapsCard planId="p1" />);
    expect(await screen.findByText(/1\. 兼六園\(10:00\)/)).toBeTruthy();
    expect(m.getMyMapsPreview).toHaveBeenCalledWith('p1', 'exact', true);
    expect(screen.getByText(/位置が無いので載りません: 昼食/)).toBeTruthy();
    expect(screen.getByText(/除外: 1 件/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '経路を Google マップで開く' }).getAttribute('rel')).toContain('noopener');
    expect(screen.getByText(/左の「アップロード」を選び/)).toBeTruthy();
  });

  it('Google 以外のリンクは送らずに理由を出す', async () => {
    render(<MyMapsCard planId="p1" />);
    await screen.findByText(/1\. 兼六園/);
    fireEvent.change(screen.getByLabelText('マイマップのリンク'), { target: { value: 'https://evil.example/maps/d/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'リンクを保存' }));
    expect((await screen.findByRole('alert')).textContent).toContain('https://www.google.com/maps/d/');
    expect(m.saveExternalMap).not.toHaveBeenCalled();
  });
});

describe('PhotoQrCard', () => {
  it('QR と確認コードを発行の時だけ見せ、停止できる', async () => {
    m.createUploadLink.mockResolvedValue({ id: 'l1', plan_id: 'p1', expires_at: '2026-04-12T00:00:00Z', active: true, upload_count: 0, last_used_at: null, token: 'tok', code: '482913' });
    m.revokeUploadLink.mockResolvedValue(undefined);
    render(<PhotoQrCard planId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'QR コードを出す' }));
    expect((await screen.findByTestId('photo-qr-code')).textContent).toBe('482913');
    fireEvent.click(screen.getByRole('button', { name: '停止する' }));
    await waitFor(() => expect(m.revokeUploadLink).toHaveBeenCalledWith('p1', 'l1'));
    expect(screen.queryByTestId('photo-qr-code')).toBeNull();
  });
});

function renderUpload() {
  return render(<MemoryRouter initialEntries={['/u/tok12345678']}><Routes><Route path="/u/:token" element={<PhotoUploadPage />} /></Routes></MemoryRouter>);
}

describe('PhotoUploadPage', () => {
  it('確認コードで開き、写真を送って結果の内訳を出す。失敗は送り直せる', async () => {
    m.viewUploadLink.mockResolvedValue({ plan_title: '金沢', active: true, expires_at: '2026-04-12T00:00:00Z', max_upload_bytes: 1000 });
    m.openUploadSession.mockResolvedValue({ session_token: 's1', expires_at: '2026-04-12T00:00:00Z' });
    m.uploadWithSession.mockResolvedValueOnce({ id: 'a', location_status: 'confirmed', location_source: 'exif' })
      .mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ id: 'b', location_status: null, location_source: null });
    renderUpload();
    expect(await screen.findByRole('heading', { name: /金沢/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('PC に出ている確認コード'), { target: { value: '482913' } });
    fireEvent.click(screen.getByRole('button', { name: '続ける' }));
    const input = await screen.findByTestId('upload-files');
    const gps = new File([jpegWithGps(36.5, 136.6)], 'g.jpg', { type: 'image/jpeg' });
    const plain = new File([new Uint8Array(8)], 'p.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [gps, plain] } });
    const retry = await screen.findByRole('button', { name: '失敗した 1 枚を送り直す' });
    const first = m.uploadWithSession.mock.calls[0]!;
    expect(first[0]).toBe('tok12345678');
    expect(first[3]).toMatchObject({ location_source: 'exif', visibility: 'private' });
    expect(first[3].latitude).toBeCloseTo(36.5);
    const failedId = m.uploadWithSession.mock.calls[1]![3].client_upload_id;
    fireEvent.click(retry);
    await waitFor(() => expect(m.uploadWithSession).toHaveBeenCalledTimes(3));
    expect(m.uploadWithSession.mock.calls[2]![3].client_upload_id).toBe(failedId); // 同じ ID で再送
    expect((await screen.findByTestId('upload-summary')).textContent).toContain('2 枚を送りました');
  });

  it('止められた QR は投稿の入口を出さない', async () => {
    m.viewUploadLink.mockResolvedValue({ plan_title: '金沢', active: false, expires_at: '2026-04-12T00:00:00Z', max_upload_bytes: 1000 });
    renderUpload();
    expect((await screen.findByRole('alert')).textContent).toContain('停止');
    expect(screen.queryByLabelText('PC に出ている確認コード')).toBeNull();
  });
});

describe('BookingExtractCard', () => {
  it('本文を読み取り、注意を出して親へ渡す', async () => {
    const job = { id: 'j', candidates: [], ai_status: 'denied', ai_message: 'AI は使えません', warnings: ['日程の外です'] };
    m.extractReservationText.mockResolvedValue(job);
    const done = vi.fn();
    render(<BookingExtractCard planId="p1" onExtracted={done} />);
    fireEvent.change(screen.getByLabelText('予約確認メールの本文'), { target: { value: '予約番号: A1' } });
    fireEvent.click(screen.getByRole('button', { name: '本文を読み取る' }));
    await waitFor(() => expect(done).toHaveBeenCalledWith(job));
    expect(m.extractReservationText).toHaveBeenCalledWith('p1', '予約番号: A1', false);
    expect(screen.getByTestId('booking-extract-note').textContent).toContain('日程の外です');
  });

  it('画像は同意するまで選べない', async () => {
    render(<BookingExtractCard planId="p1" onExtracted={vi.fn()} />);
    const button = screen.getByRole('button', { name: '画像を選ぶ' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('booking-image-consent'));
    expect(button.disabled).toBe(false);
    const image = new File([new Uint8Array(8)], 's.png', { type: 'image/png' });
    m.extractReservationFile.mockRejectedValue({ response: { status: 403, data: { detail: { message: 'このクラスには AI が含まれません' } } } });
    fireEvent.change(screen.getByTestId('booking-image'), { target: { files: [image] } });
    expect((await screen.findByRole('alert')).textContent).toContain('AI');
    expect(m.extractReservationFile).toHaveBeenCalledWith('p1', image, false, true);
  });
});
