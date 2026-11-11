/**
 * [Gate MyMaps・PhotoQR・BookingImport] 新しい画面の試験(API は模擬)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { exifTimeToIso, readExifInfo, spotsFromTimeline } from '@/components/search/findModel';
import { jpegWithGps } from '@/components/search/findModel.fixture';
import { loginNextPath } from '@/utils/safeNavigation';

const m = vi.hoisted(() => ({
  getMyMapsPreview: vi.fn(), downloadMyMapsKml: vi.fn(), getExternalMaps: vi.fn(), saveExternalMap: vi.fn(),
  deleteExternalMap: vi.fn(), createUploadLink: vi.fn(), getUploadLinks: vi.fn(), revokeUploadLink: vi.fn(),
  viewUploadLink: vi.fn(), joinUploadLink: vi.fn(), openUploadSession: vi.fn(), uploadWithSession: vi.fn(),
  uploadAsMember: vi.fn(), extractReservationText: vi.fn(), extractReservationFile: vi.fn(), applyExtraction: vi.fn(),
  getPlanBasics: vi.fn(), savePlanBasics: vi.fn(), reschedulePlan: vi.fn(),
}));
vi.mock('@/services/api/photoFeatures', () => m);
const cov = vi.hoisted(() => ({ getPlanCover: vi.fn() }));
vi.mock('@/services/api/g11', async (orig) => ({ ...(await orig<object>()), getPlanCover: cov.getPlanCover }));

import MyMapsCard from './exports/MyMapsCard';
import BookingExtractCard from './imports/BookingExtractCard';
import BookingReviewForm from './imports/BookingReviewForm';
import PlanBasicsDialog from '@/components/planner/PlanBasicsDialog';
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
  it('本文を読み取って親へ渡す。AI は選んだ時だけ', async () => {
    const job = { id: 'j', candidates: [], ai_status: 'off', ai_message: null, warnings: [] };
    m.extractReservationText.mockResolvedValue(job);
    const done = vi.fn();
    render(<BookingExtractCard planId="p1" onExtracted={done} />);
    fireEvent.change(screen.getByLabelText('予約確認メールの本文を貼る'), { target: { value: '予約番号: A1' } });
    fireEvent.click(screen.getByRole('button', { name: '本文を読み取る' }));
    await waitFor(() => expect(done).toHaveBeenCalledWith(job));
    expect(m.extractReservationText).toHaveBeenCalledWith('p1', '予約番号: A1', false);
  });

  it('画像は同意なしでも選べ(サーバーの OCR)、AI を選んだ時だけ送信の同意を付ける。失敗の理由を出す', async () => {
    render(<BookingExtractCard planId="p1" onExtracted={vi.fn()} />);
    const image = new File([new Uint8Array(8)], 's.png', { type: 'image/png' });
    m.extractReservationFile.mockRejectedValue({ response: { status: 422, data: { detail: { message: '読み取れませんでした' } } } });
    fireEvent.change(screen.getByTestId('booking-image'), { target: { files: [image] } });
    expect((await screen.findByRole('alert')).textContent).toContain('読み取れません');
    expect(m.extractReservationFile).toHaveBeenLastCalledWith('p1', image, false, false);
    fireEvent.click(screen.getByTestId('booking-use-ai'));
    fireEvent.change(screen.getByTestId('booking-image'), { target: { files: [image] } });
    await waitFor(() => expect(m.extractReservationFile).toHaveBeenLastCalledWith('p1', image, true, true));
  });

  it('[BookingImportYahoo] PDF も選べる', async () => {
    m.extractReservationFile.mockReset().mockResolvedValue({ id: 'j', candidates: [], ai_status: 'off', ai_message: null, warnings: [] });
    const done = vi.fn();
    render(<BookingExtractCard planId="p1" onExtracted={done} />);
    const pdf = new File([new Uint8Array(8)], 'booking.pdf', { type: 'application/pdf' });
    expect(screen.getByTestId('booking-pdf')).toHaveAttribute('accept', 'application/pdf,.pdf');
    fireEvent.change(screen.getByTestId('booking-pdf'), { target: { files: [pdf] } });
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(m.extractReservationFile).toHaveBeenLastCalledWith('p1', pdf, false, false);
  });
});

const stay = [
  ['type', 'accommodation'], ['provider_name', '都リゾート'], ['start_at', '2026-11-28T15:00:00+09:00'], ['end_at', '2026-11-29T11:00:00+09:00'],
  ['detail.room', 'ツイン'], ['detail.meal', '夕朝食付'], ['guest_count', '4'],
].map(([field_path, value]) => ({ field_path: field_path as string, value, evidence_locator: '見出し', review_status: 'pending' }));

describe('BookingReviewForm', () => {
  it('読み取った値を項目ごとに出し、直した値で登録する', async () => {
    m.applyExtraction.mockResolvedValue({ reservation_id: 'r', event_id: 'e', itinerary_note: null });
    const done = vi.fn();
    render(<MemoryRouter><BookingReviewForm planId="p1" jobId="j1" candidates={stay} notes={['注意です']} onDone={done} onDiscard={vi.fn()} /></MemoryRouter>);
    expect((screen.getByLabelText('施設・事業者の名前') as HTMLInputElement).value).toBe('都リゾート');
    expect((screen.getByLabelText('部屋') as HTMLTextAreaElement).value).toBe('ツイン');
    expect((screen.getByLabelText('開始(チェックイン・出発)') as HTMLInputElement).value).toBe('2026-11-28T15:00');
    expect(screen.getByTestId('booking-review-notes').textContent).toContain('注意です');
    fireEvent.change(screen.getByLabelText('人数'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('食事'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('booking-review-submit'));
    await waitFor(() => expect(done).toHaveBeenCalled());
    const [plan, job, fields, add] = m.applyExtraction.mock.calls[0]!;
    expect([plan, job, add]).toEqual(['p1', 'j1', true]);
    expect(fields).toMatchObject({ guest_count: '5', 'detail.meal': null, start_at: '2026-11-28T15:00:00+09:00', provider_name: '都リゾート' });
  });

  it('種類が無いと登録しない', async () => {
    render(<MemoryRouter><BookingReviewForm planId="p1" jobId="j1" candidates={[]} onDone={vi.fn()} onDiscard={vi.fn()} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('booking-review-submit'));
    expect((await screen.findByRole('alert')).textContent).toContain('種類');
    expect(m.applyExtraction).not.toHaveBeenCalled();
  });
});

describe('PlanBasicsDialog', () => {
  const open = (extra = {}) => render(<PlanBasicsDialog planId="p1" revision={7} firstDate="2026-11-28" lastDate="2026-11-29" isOpen onClose={vi.fn()} onSaved={vi.fn()} {...extra} />);
  beforeEach(() => {
    m.getPlanBasics.mockResolvedValue({ title: '鳥羽', destination: '鳥羽', description: null, budget: null, start_date: null, end_date: null, preferences: { x: 1 } });
    m.savePlanBasics.mockResolvedValue(undefined);
    cov.getPlanCover.mockResolvedValue({ cover: null, can_edit: false });
  });

  it('背景の写真: 変えられる人だけに欄を出し、押すと写真の選択を上に開く', async () => {
    cov.getPlanCover.mockResolvedValue({ cover: null, can_edit: true });
    open();
    const btn = await screen.findByTestId('basics-cover-change');
    expect(btn).toHaveTextContent('写真を設定');
    expect(screen.queryByTestId('cover-photo-dialog')).toBeNull();
  });

  it('背景の写真: 変えられない人には出さない', async () => {
    open();
    await waitFor(() => expect(cov.getPlanCover).toHaveBeenCalledWith('p1'));
    expect(screen.queryByTestId('basics-cover')).toBeNull();
  });

  it('[BasicsRace] 読み込みが終わるまで入力・保存させず、後から届いた旅程の日付で入力を上書きしない', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    m.getPlanBasics.mockReturnValue(new Promise((r) => { resolve = r; }));
    m.reschedulePlan.mockResolvedValue({ revision: 8, days: 2, reservations_not_moved: 0 });
    const saved = vi.fn();
    const view = render(<PlanBasicsDialog planId="p1" revision={7} isOpen onClose={vi.fn()} onSaved={saved} />);
    expect(screen.getByLabelText('出発日')).toBeDisabled();
    expect(screen.getByTestId('plan-basics-save')).toBeDisabled();
    resolve({ title: '金沢', destination: null, description: null, budget: null, start_date: '2026-04-10', end_date: '2026-04-10', preferences: {} });
    await waitFor(() => expect(screen.getByLabelText('出発日')).not.toBeDisabled());
    expect(screen.getByLabelText('出発日')).toHaveValue('2026-04-10');
    fireEvent.change(screen.getByLabelText('出発日'), { target: { value: '2026-05-01' } });
    fireEvent.change(screen.getByLabelText('最終日'), { target: { value: '2026-05-02' } });
    // 旅程が後から読み込まれても(firstDate が届いても)入力は残る
    view.rerender(<PlanBasicsDialog planId="p1" revision={7} firstDate="2026-04-10" lastDate="2026-04-10" isOpen onClose={vi.fn()} onSaved={saved} />);
    expect(screen.getByLabelText('出発日')).toHaveValue('2026-05-01');
    fireEvent.click(screen.getByTestId('plan-basics-save'));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(m.reschedulePlan).toHaveBeenCalledWith('p1', 7, '2026-05-01', '2026-05-02', false);
  });

  it('題名・方面・人数を保存する。日程が同じなら日程の変更は呼ばない', async () => {
    const saved = vi.fn();
    open({ onSaved: saved });
    await waitFor(() => expect((screen.getByLabelText('題名') as HTMLInputElement).value).toBe('鳥羽'));
    fireEvent.change(screen.getByLabelText('題名'), { target: { value: '伊勢志摩' } });
    fireEvent.change(screen.getByLabelText('人数'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('plan-basics-save'));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(null));
    expect(m.reschedulePlan).not.toHaveBeenCalled();
    expect(m.savePlanBasics.mock.calls[0]![1]).toMatchObject({ title: '伊勢志摩', preferences: { x: 1, party_size: 4 } });
  });

  it('日程を変えると予定ごと動かし、消える予定があれば一覧を見せて確認してから消す', async () => {
    m.reschedulePlan.mockRejectedValueOnce({ response: { status: 409, data: { detail: { code: 'days_have_events', days: [{ date: '2026-11-29', events: ['水族館'] }] } } } })
      .mockResolvedValueOnce({ revision: 8, days: 1, reservations_not_moved: 2 });
    const saved = vi.fn();
    open({ onSaved: saved });
    await waitFor(() => expect((screen.getByLabelText('題名') as HTMLInputElement).value).toBe('鳥羽'));
    fireEvent.change(screen.getByLabelText('最終日'), { target: { value: '2026-11-28' } });
    fireEvent.click(screen.getByTestId('plan-basics-save'));
    expect((await screen.findByTestId('basics-lost')).textContent).toContain('水族館');
    expect(m.savePlanBasics).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '消して日程を変える' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(m.reschedulePlan).toHaveBeenLastCalledWith('p1', 7, '2026-11-28', '2026-11-28', true);
    expect(saved.mock.calls[0]![0]).toContain('予約 2 件');
  });

  it('[JourneyEnds] 出発・到着を出すを選ぶと場所・時刻を入れられ、一緒に保存する', async () => {
    m.getPlanBasics.mockResolvedValue({ title: '鳥羽', destination: '鳥羽', description: null, budget: null, start_date: null, end_date: null,
      preferences: {}, journey_enabled: false, journey_start_place: null, journey_start_time: null, journey_end_place: null, journey_end_time: null });
    const saved = vi.fn();
    open({ onSaved: saved });
    await waitFor(() => expect((screen.getByLabelText('題名') as HTMLInputElement).value).toBe('鳥羽'));
    expect(screen.queryByLabelText('出発の場所')).toBeNull();
    fireEvent.click(screen.getByTestId('basics-journey-on'));
    fireEvent.change(screen.getByLabelText('出発の場所'), { target: { value: ' 自宅 ' } });
    fireEvent.change(screen.getByLabelText('出発の時刻'), { target: { value: '07:30' } });
    // [Gate JourneyMove] 出発地からの移動手段と所要時間
    fireEvent.change(screen.getByLabelText('出発地から最初の予定までの移動手段'), { target: { value: 'driving' } });
    fireEvent.change(screen.getAllByLabelText('所要時間(分)')[0]!, { target: { value: '40' } });
    fireEvent.click(screen.getByTestId('plan-basics-save'));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(m.savePlanBasics.mock.calls[0]![1]).toMatchObject({ journey_enabled: true, journey_start_place: '自宅', journey_start_time: '07:30',
      journey_end_place: null, journey_end_time: null, journey_start_mode: 'driving', journey_start_minutes: 40,
      journey_end_mode: null, journey_end_minutes: null });
  });

  it('最終日が出発日より前なら送らない', async () => {
    open();
    await waitFor(() => expect((screen.getByLabelText('題名') as HTMLInputElement).value).toBe('鳥羽'));
    fireEvent.change(screen.getByLabelText('最終日'), { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByTestId('plan-basics-save'));
    expect((await screen.findByRole('alert')).textContent).toContain('最終日');
    expect(m.reschedulePlan).not.toHaveBeenCalled();
  });
});

describe('spotsFromTimeline', () => {
  it('YouTube の説明欄の行から場所を拾う', () => {
    const got = spotsFromTimeline('説明です\n00:00 start.内宮前バス停\n01:20 内宮入口.宇治橋\n01:50 おはらい町\n07:40 五十鈴川カフェ.五十鈴川\n09:35 赤福本店.おかげ横丁入口\n16:55 浦田町バス停\n17:15 アクセスガイド.五十鈴川野遊びどころ\nhttps://example.com');
    expect(got.map((s) => s.name)).toEqual(['内宮前バス停', '内宮入口', 'おはらい町', '五十鈴川カフェ', '赤福本店', '浦田町バス停', 'アクセスガイド']);
    expect(got[1]!.note).toBe('宇治橋');
    expect(spotsFromTimeline('ふつうの文')).toEqual([]);
  });
});
