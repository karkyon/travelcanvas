/**
 * [Gate Remaining-7] 第7弾の画面の部品:
 * Gmail の連携(FR-011)・予定の経路との比べ(FR-054)・ゲストを既存のアカウントへまとめる(FR-002)・
 * passkey(FR-003)・画像と声から候補の名前(FR-007)・準備状況の予算(FR-026)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const r7 = vi.hoisted(() => ({
  getGmailStatus: vi.fn(), connectGmail: vi.fn(), syncGmail: vi.fn(), disconnectGmail: vi.fn(),
  getTrackComparison: vi.fn(), mergeGuestIntoAccount: vi.fn(), listPasskeys: vi.fn(), deletePasskey: vi.fn(),
  registerPasskey: vi.fn(), loginWithPasskey: vi.fn(), passkeySupported: vi.fn(() => true), undoConstraintChange: vi.fn(),
}));
vi.mock('@/services/api/remaining6', () => r7);
const spot = vi.hoisted(() => ({ readPlaceImage: vi.fn() }));
vi.mock('@/services/api/spotIntake', () => spot);
const apiMock = vi.hoisted(() => ({ api: { setAccessToken: vi.fn(), setGuestMode: vi.fn(), setMemberSession: vi.fn() } }));
vi.mock('@/services/api', () => apiMock);

import GmailCard from '@/pages/imports/GmailCard';
import TrackComparisonPanel from '@/pages/track/TrackComparisonPanel';
import GuestMergeForm from '@/components/auth/GuestMergeForm';
import PasskeySection from '@/components/settings/PasskeySection';
import PasskeyLoginButton from '@/components/auth/PasskeyLoginButton';
import CandidateInputHelpers from '@/components/candidates/CandidateInputHelpers';
import ReadinessPanel from '@/pages/preparation/ReadinessPanel';
import { useAuthStore } from '@/store/authStore';
import type { Readiness } from '@/services/api';

const status = (over: Record<string, unknown> = {}) => ({
  available: true, connected: false, google_email: null, last_sync_at: null, imported_count: 0, last_error: null,
  scope: 'gmail.readonly', max_messages: 20, ...over,
});

beforeEach(() => {
  Object.values(r7).forEach((f) => f.mockReset());
  spot.readPlaceImage.mockReset();
  (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = function PublicKeyCredential() { /* jsdom */ };
});
afterEach(() => { delete (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential; });

describe('GmailCard (FR-011)', () => {
  it('使えない環境では案内だけ。つないでいなければ「つなぐ」で Google の画面へ移る', async () => {
    r7.getGmailStatus.mockResolvedValue(status({ available: false }));
    const { unmount } = render(<MemoryRouter><GmailCard planId="p1" /></MemoryRouter>);
    expect(await screen.findByText(/Gmail の連携が使えません/)).toBeInTheDocument();
    unmount();
    r7.getGmailStatus.mockResolvedValue(status());
    r7.connectGmail.mockResolvedValue({ authorize_url: 'https://evil.example/x' });
    render(<MemoryRouter><GmailCard planId="p1" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Gmail とつなぐ' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Gmail とつなげませんでした'); // Google 以外の URL へは移らない
    expect(r7.connectGmail).toHaveBeenCalledWith('p1');
  });

  it('つないでいれば取り込みと外すができ、戻った時の結果を出す', async () => {
    r7.getGmailStatus.mockResolvedValue(status({ connected: true, google_email: 'me@gmail.example' }));
    r7.syncGmail.mockResolvedValue({ ...status({ connected: true, imported_count: 2 }), messages: 3, jobs: 2 });
    r7.disconnectGmail.mockResolvedValue(status());
    const onImported = vi.fn();
    render(<MemoryRouter initialEntries={['/x?gmail=connected']}><GmailCard planId="p1" onImported={onImported} /></MemoryRouter>);
    expect(await screen.findByTestId('gmail-connected')).toHaveTextContent('me@gmail.example');
    expect(screen.getByRole('status')).toHaveTextContent('Gmail とつなぎました');
    fireEvent.click(screen.getByRole('button', { name: 'Gmail から取り込む' }));
    expect(await screen.findByText(/3 通を読み、2 件の読み取りを作りました/)).toBeInTheDocument();
    expect(onImported).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '連携を外す' }));
    expect(await screen.findByRole('button', { name: 'Gmail とつなぐ' })).toBeInTheDocument();
  });
});

describe('TrackComparisonPanel (FR-054)', () => {
  it('押した時だけ比べ、到達・未到達・寄り道を出す', async () => {
    r7.getTrackComparison.mockResolvedValue({
      track_id: 't1', days: ['2026-11-01'], algorithm_version: 'track-compare-v1',
      events: [
        { event_id: 'e1', title: '清水寺', date: '2026-11-01', planned_time: '10:00', radius_m: 200, nearest_m: 20,
          nearest_at: '2026-11-01T01:00:00Z', reached: true },
        { event_id: 'e2', title: '大阪城', date: '2026-11-01', planned_time: null, radius_m: 200, nearest_m: 45000,
          nearest_at: null, reached: false },
      ],
      summary: { planned_count: 2, reached_count: 1, skipped: ['大阪城'], planned_distance_km: 42, actual_distance_km: 5.1,
        points: 20, off_route_ratio: 0.5, max_deviation_m: 5000, off_route_threshold_m: 1000 },
      unplanned_stops: [{ from: '2026-11-01T02:00:00Z', to: '2026-11-01T02:12:00Z', minutes: 12, latitude: 35.04, longitude: 135.78 }],
      planned_route: [],
    });
    render(<TrackComparisonPanel planId="p1" trackId="t1" />);
    expect(r7.getTrackComparison).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '予定の経路と比べる' }));
    expect(await screen.findByTestId('track-comparison-summary')).toHaveTextContent('予定 2か所のうち 1か所に到達');
    expect(screen.getByText('× 未到達(半径200m)')).toBeInTheDocument();
    expect(screen.getByText(/12分/)).toBeInTheDocument();
    expect(screen.getByText('45.0km')).toBeInTheDocument();
  });
});

describe('GuestMergeForm (FR-002)', () => {
  afterEach(() => useAuthStore.setState({ guestToken: null, isGuest: false }));
  it('ゲストのトークンで送り、確認コードが要れば欄を出し、まとめたらログインした状態にする', async () => {
    useAuthStore.setState({ guestToken: 'gt', isGuest: true });
    r7.mergeGuestIntoAccount
      .mockRejectedValueOnce({ response: { status: 401, data: { detail: { code: 'mfa_required', message: '確認コードが要ります' } } } })
      .mockResolvedValueOnce({ access_token: 'at', user: { id: 'u1', email: 'a@example.com' }, merge: { moved_total: 4, kept_total: 0 } });
    render(<MemoryRouter><GuestMergeForm /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('メール'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'このアカウントへまとめる' }));
    const code = await screen.findByLabelText('確認コード(認証アプリ)');
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'このアカウントへまとめる' }));
    await waitFor(() => expect(useAuthStore.getState().isGuest).toBe(false));
    expect(r7.mergeGuestIntoAccount).toHaveBeenLastCalledWith('a@example.com', 'pw', '123456', 'gt');
    expect(apiMock.api.setAccessToken).toHaveBeenCalledWith('at');
    expect(useAuthStore.getState().guestToken).toBeNull();
  });
});

describe('passkey (FR-003)', () => {
  it('一覧・作る・消す', async () => {
    r7.listPasskeys.mockResolvedValue({ passkeys: [{ id: 'k1', name: '古い端末', created_at: '2026-11-01T00:00:00Z',
      last_used_at: null, backed_up: false }], rp_id: 'x' });
    r7.registerPasskey.mockResolvedValue({ id: 'k2', name: 'この端末', created_at: null, last_used_at: null, backed_up: true });
    r7.deletePasskey.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PasskeySection />);
    expect(await screen.findByText(/古い端末/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'passkey を作る' }));
    expect(await screen.findByRole('status')).toHaveTextContent('「この端末」を作りました');
    fireEvent.click(screen.getAllByRole('button', { name: '消す' })[0]!);
    await waitFor(() => expect(r7.deletePasskey).toHaveBeenCalledWith('k1'));
    confirmSpy.mockRestore();
  });

  it('使えないブラウザではログインのボタンを出さない。使えれば押すとログインした状態にする', async () => {
    delete (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential;
    const { unmount } = render(<PasskeyLoginButton onDone={vi.fn()} />);
    expect(screen.queryByTestId('passkey-login')).toBeNull();
    unmount();
    (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = function PublicKeyCredential() { /* jsdom */ };
    r7.loginWithPasskey.mockResolvedValue({ access_token: 'at2', user: { id: 'u2' } });
    const onDone = vi.fn();
    render(<PasskeyLoginButton onDone={onDone} />);
    fireEvent.click(screen.getByTestId('passkey-login'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(useAuthStore.getState().token).toBe('at2');
  });
});

describe('CandidateInputHelpers (FR-007)', () => {
  it('画像の文字から名前を選んで入れる', async () => {
    spot.readPlaceImage.mockResolvedValue({ words: ['清水寺', '音羽の滝'], ocr_available: true });
    const onPick = vi.fn();
    render(<CandidateInputHelpers onPick={onPick} />);
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('candidate-image-input'), { target: { files: [file] } });
    fireEvent.click(await screen.findByRole('button', { name: '音羽の滝' }));
    expect(onPick).toHaveBeenCalledWith('音羽の滝');
  });

  it('声: 使えるブラウザだけボタンを出し、聞き取った文を入れる', async () => {
    const onPick = vi.fn();
    class FakeRec {
      lang = ''; interimResults = false; maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null; onerror = null; onend: (() => void) | null = null;
      start() { this.onresult?.({ results: [[{ transcript: '伏見稲荷' }]] }); this.onend?.(); }
      stop() { /* noop */ }
    }
    (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRec;
    render(<CandidateInputHelpers onPick={onPick} />);
    fireEvent.click(screen.getByTestId('candidate-voice'));
    expect(onPick).toHaveBeenCalledWith('伏見稲荷');
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });
});

describe('ReadinessPanel の予算 (FR-026)', () => {
  it('予算・使った額・未払いの予約・残りの見込みを出す', () => {
    const r = {
      plan_id: 'p1', algorithm_version: 'readiness-v1', checked_at: '', is_ready: false,
      counts: { total: 1, by_severity: { high: 0, medium: 1, low: 0 },
        by_category: { unreserved: 0, unconfirmed: 0, unpaid: 0, deadline: 0, unassigned: 0, packing: 0, budget: 1 } },
      resolved_by_tasks: 0, tasks: { open: 0, done: 0 }, packing: { total: 0, packed: 0, required_total: 0, required_ready: 0 },
      items: [],
      budget: { base_currency: 'JPY', total: '40000', spent: '15000', unpaid_reserved: '30000', unpaid_reserved_foreign: 1,
        projected: '45000', remaining: '-5000', over: false, projected_over: true, categories_over: [] },
    } as Readiness;
    render(<MemoryRouter><ReadinessPanel readiness={r} canEdit onMakeTask={vi.fn()} onCompleteTask={vi.fn()} /></MemoryRouter>);
    const box = screen.getByTestId('readiness-budget');
    expect(box).toHaveTextContent('40,000 JPY');
    expect(box).toHaveTextContent('-5,000 JPY');
    expect(box).toHaveTextContent('外貨の予約 1 件');
    expect(screen.getByText('予算 1件')).toBeInTheDocument();
  });
});
