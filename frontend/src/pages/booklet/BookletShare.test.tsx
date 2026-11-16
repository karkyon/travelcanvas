/**
 * [Gate BookletShare] しおりの共有の試験。
 * - 文と URL(mailto の作り方・パスの検査・ファイル名・受信箱の URL)
 * - ダイアログ: 公開ページ/同行者用のリンク、未公開なら公開ボタン、QR、メールアプリの宛先(所有者だけ)、
 *   スマホの共有が無い端末の案内、アプリから送る(送り先・添付・リンク・結果・確認用の受信箱・設定が無い時)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BookletShareInfo } from '@/services/api/bookletShare';

const m = vi.hoisted(() => ({
  getBookletShare: vi.fn(),
  sendBookletEmail: vi.fn(),
  publishBookletExport: vi.fn(),
  getCollaborators: vi.fn(),
  downloadBookletPdf: vi.fn(),
  saveBlob: vi.fn(),
}));
vi.mock('@/services/api/bookletShare', () => ({ getBookletShare: m.getBookletShare, sendBookletEmail: m.sendBookletEmail }));
vi.mock('@/services/api/bookletWeb', () => ({ publishBookletExport: m.publishBookletExport }));
vi.mock('@/services/api/remaining5', () => ({ downloadBookletPdf: m.downloadBookletPdf, saveBlob: m.saveBlob }));
vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { ...actual, getCollaborators: m.getCollaborators };
});

import BookletShareDialog from './BookletShareDialog';
import { absoluteUrl, mailtoUrl, pdfFileName, sandboxInboxUrl, shareBody } from './bookletShareModel';

const base: BookletShareInfo = {
  export_id: 'e1', version_no: 3, is_public: true, public_path: '/b/TOKEN123', public_url_recoverable: true,
  can_publish: true, contains_sensitive: false, can_attach_pdf: true, app_path: '/planner/p1/booklet/e1',
  email_available: true, email_sandbox: false,
  recipients: [
    { user_id: 'u1', name: '花子', role: 'editor', has_email: true },
    { user_id: 'u2', name: '太郎', role: 'viewer', has_email: true },
    { user_id: 'u3', name: 'ゲスト', role: 'viewer', has_email: false },
  ],
  max_recipients: 30,
};

const open = (props: Partial<React.ComponentProps<typeof BookletShareDialog>> = {}) =>
  render(<BookletShareDialog planId="p1" exportId="e1" title="伊勢・鳥羽" isOwner onClose={vi.fn()} {...props} />);

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.getCollaborators.mockResolvedValue({ data: [
    { id: 'c1', user_id: 'u1', plan_id: 'p1', role: 'editor', email: 'hanako@example.com', status: 'accepted' },
    { id: 'c2', user_id: 'u9', plan_id: 'p1', role: 'viewer', email: 'pending@example.com', status: 'pending' },
  ] });
});

describe('文と URL', () => {
  it('mailto: 宛先は , 区切りで @ はそのまま。件名・本文は符号化。不正な宛先は入れない', () => {
    const u = mailtoUrl(['a@example.com', 'bad address', 'b+x@example.jp'], '件名 &', '本文\nhttps://x/b/T?y=1');
    expect(u.startsWith('mailto:a@example.com,b%2Bx@example.jp?subject=')).toBe(true);
    expect(u).toContain(`subject=${encodeURIComponent('件名 &')}`);
    expect(u).toContain(`body=${encodeURIComponent('本文\nhttps://x/b/T?y=1')}`);
    expect(mailtoUrl([], 's', 'b').startsWith('mailto:?subject=')).toBe(true);
  });
  it('URL はパスが / で始まる時だけ作る(// は拒む)', () => {
    expect(absoluteUrl('http://192.168.1.11:4173/', '/b/x')).toBe('http://192.168.1.11:4173/b/x');
    expect(() => absoluteUrl('http://a', '//evil.example/x')).toThrow();
    expect(() => absoluteUrl('http://a', 'https://evil')).toThrow();
  });
  it('本文: 公開ページはログイン不要、同行者用はログインして開くと書く', () => {
    expect(shareBody('旅', 'U', 'public')).toContain('ログインなしで見られます');
    expect(shareBody('旅', 'U', 'app')).toContain('ログインして開いてください');
    expect(pdfFileName('伊勢/鳥羽:旅', 2)).toBe('伊勢鳥羽旅_第2版.pdf');
    expect(sandboxInboxUrl({ protocol: 'http:', hostname: '192.168.1.11' })).toBe('http://192.168.1.11:8025');
  });
});

describe('共有のダイアログ', () => {
  it('公開ページのリンク・QR・メールアプリ(所有者は同行者の宛先を入れる)', async () => {
    m.getBookletShare.mockResolvedValue(base);
    open();
    const url = await screen.findByTestId('booklet-share-url');
    expect((url as HTMLInputElement).value).toBe(`${window.location.origin}/b/TOKEN123`);
    expect(await screen.findByTestId('booklet-share-qr')).toHaveAttribute('src', expect.stringMatching(/^data:image\/png/));
    fireEvent.click(screen.getByRole('tab', { name: /メールアプリで送る/ }));
    const a = await screen.findByTestId('booklet-share-mailto');
    await waitFor(() => expect(a.getAttribute('href')).toMatch(/^mailto:hanako@example\.com\?subject=/));
    expect(a.getAttribute('href')).not.toContain('pending@example.com');
    expect(decodeURIComponent(a.getAttribute('href')!)).toContain('/b/TOKEN123');
    // 同行者用に切り替えると、アプリのリンクになる
    fireEvent.click(screen.getByRole('radio', { name: /編集できる同行者用/ }));
    expect((screen.getByTestId('booklet-share-url') as HTMLInputElement).value).toBe(`${window.location.origin}/planner/p1/booklet/e1`);
  });

  it('所有者でなければ、メールアプリの宛先は空(アドレスを読まない)', async () => {
    m.getBookletShare.mockResolvedValue(base);
    open({ isOwner: false });
    fireEvent.click(await screen.findByRole('tab', { name: /メールアプリで送る/ }));
    expect((await screen.findByTestId('booklet-share-mailto')).getAttribute('href')).toMatch(/^mailto:\?subject=/);
    expect(m.getCollaborators).not.toHaveBeenCalled();
  });

  it('未公開なら、公開してリンクを作れる。機密の版は公開できない案内', async () => {
    m.getBookletShare.mockResolvedValueOnce({ ...base, is_public: false, public_path: null })
      .mockResolvedValueOnce(base);
    m.publishBookletExport.mockResolvedValue({ url: '/b/TOKEN123', published_at: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onPublished = vi.fn();
    open({ onPublished });
    // 未公開の時は、最初から同行者用のリンクを選ぶ
    expect((await screen.findByTestId('booklet-share-url') as HTMLInputElement).value).toContain('/planner/p1/booklet/e1');
    fireEvent.click(screen.getByRole('radio', { name: /公開ページ/ }));
    fireEvent.click(within(screen.getByTestId('booklet-share-publish')).getByRole('button', { name: /公開する/ }));
    await waitFor(() => expect(m.publishBookletExport).toHaveBeenCalledWith('p1', 'e1'));
    expect(onPublished).toHaveBeenCalled();
    await waitFor(() => expect((screen.getByTestId('booklet-share-url') as HTMLInputElement).value).toContain('/b/TOKEN123'));
  });

  it('機密の版: 公開の代わりの案内、PDF は付けられない', async () => {
    m.getBookletShare.mockResolvedValue({ ...base, is_public: false, public_path: null, can_publish: false, contains_sensitive: true, can_attach_pdf: false });
    open();
    fireEvent.click(await screen.findByRole('radio', { name: /公開ページ/ }));
    expect(screen.getByTestId('booklet-share-publish')).toHaveTextContent('機密項目を含む版は公開できません');
    fireEvent.click(screen.getByRole('tab', { name: /アプリから送る/ }));
    expect(screen.getByRole('checkbox', { name: /PDF を添付/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /公開ページのリンク/ })).toBeDisabled();
  });

  it('スマホの共有が無い端末では案内を出す', async () => {
    m.getBookletShare.mockResolvedValue(base);
    open();
    fireEvent.click(await screen.findByRole('tab', { name: /スマホで送る/ }));
    expect(screen.getByTestId('booklet-share-noshare')).toBeInTheDocument();
  });

  it('アプリから送る: 選んだメンバーへ、PDF・リンクを付けて送る。結果を出す', async () => {
    m.getBookletShare.mockResolvedValue(base);
    m.sendBookletEmail.mockResolvedValue({ sent: 1, failed: 0, skipped_no_address: 0, sandbox: false });
    open();
    fireEvent.click(await screen.findByRole('tab', { name: /アプリから送る/ }));
    const panel = screen.getByTestId('booklet-share-appmail');
    expect(within(panel).getByRole('checkbox', { name: /ゲスト/ })).toBeDisabled();
    fireEvent.click(within(panel).getByRole('checkbox', { name: /太郎/ }));
    fireEvent.change(within(panel).getByLabelText('ひとこと(任意)'), { target: { value: 'よろしく' } });
    fireEvent.click(within(panel).getByTestId('booklet-share-send'));
    await waitFor(() => expect(m.sendBookletEmail).toHaveBeenCalledWith('p1', 'e1', {
      user_ids: ['u1'], message: 'よろしく', attach_pdf: true, include_web_link: true, include_app_link: true,
      app_origin: window.location.origin,
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('1人に送りました');
  });

  it('送信の設定が無い環境・確認用の受信箱の環境の案内', async () => {
    m.getBookletShare.mockResolvedValueOnce({ ...base, email_available: false });
    const { unmount } = open();
    fireEvent.click(await screen.findByRole('tab', { name: /アプリから送る/ }));
    expect(screen.getByTestId('booklet-share-appmail')).toHaveTextContent('メールを送る設定がありません');
    expect(screen.queryByTestId('booklet-share-send')).toBeNull();
    unmount();
    m.getBookletShare.mockResolvedValueOnce({ ...base, email_sandbox: true });
    open();
    fireEvent.click(await screen.findByRole('tab', { name: /アプリから送る/ }));
    expect(screen.getByTestId('booklet-share-sandbox')).toHaveTextContent(':8025');
  });

  it('PDF を保存', async () => {
    m.getBookletShare.mockResolvedValue(base);
    m.downloadBookletPdf.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    open();
    await screen.findByTestId('booklet-share-url');
    fireEvent.click(screen.getAllByRole('button', { name: /PDF を保存/ })[0]!);
    await waitFor(() => expect(m.saveBlob).toHaveBeenCalledWith(expect.any(Blob), '伊勢・鳥羽_第3版.pdf'));
  });
});
