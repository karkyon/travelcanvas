/**
 * [Gate P12] MemoriesPage(写真・メモ・旅行記、FR-037)の画面テスト。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { JournalDraft, MemoryList } from '@/services/api';

const m = vi.hoisted(() => ({
  getMemories: vi.fn(), createMemory: vi.fn(), uploadMemory: vi.fn(), updateMemory: vi.fn(), deleteMemory: vi.fn(),
  getMemoryMedia: vi.fn(), createJournalDraft: vi.fn(), getPlanDetail: vi.fn(),
}));
vi.mock('@/services/api', () => ({
  default: { getPlanDetail: m.getPlanDetail },
  getMemories: m.getMemories, createMemory: m.createMemory, uploadMemory: m.uploadMemory, updateMemory: m.updateMemory,
  deleteMemory: m.deleteMemory, getMemoryMedia: m.getMemoryMedia, createJournalDraft: m.createJournalDraft,
}));

// [Gate G6] MEM-01 旅行記の公開・削除の取り消し
const g6 = vi.hoisted(() => ({
  previewPublication: vi.fn(), createPublication: vi.fn(), getPublications: vi.fn(), revokePublication: vi.fn(),
  getMemoryTrash: vi.fn(), restoreMemory: vi.fn(),
}));
vi.mock('@/services/api/g6', () => g6);

import g6fx from '@/services/api/__fixtures__/g6Responses.json';
import type { MemoryPublication, MemoryTrashItem, PublicationPreview } from '@/services/api/types/g6';
import MemoriesPage from './MemoriesPage';

const list = fx.memory_list as MemoryList;
const note = list.memories[0]!;
const detail = {
  id: 'p1', title: '京都の旅', revision: 5,
  days: [
    { id: note.day_id, local_date: '2026-11-01', timezone_id: 'Asia/Tokyo', sort_order: 0,
      events: [{ id: note.event_id, day_id: note.day_id, title: '清水寺', local_start_time: '09:00', locked: false, sort_order: 0 }] },
    { id: list.memories[3]!.day_id, local_date: '2026-11-02', timezone_id: 'Asia/Tokyo', sort_order: 1, events: [] },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/planner/p1/memories']}>
      <Routes>
        <Route path="/planner/:planId/memories" element={<MemoriesPage />} />
        <Route path="/planner/:planId" element={<div>PLANNER</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  for (const fn of [...Object.values(m), ...Object.values(g6)]) fn.mockReset();
  g6.getPublications.mockResolvedValue([]);
  g6.getMemoryTrash.mockResolvedValue([]);
  m.getMemories.mockResolvedValue(list);
  m.getPlanDetail.mockResolvedValue({ success: true, data: detail });
  m.getMemoryMedia.mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
  window.URL.createObjectURL = vi.fn(() => 'blob:memory');
  window.URL.revokeObjectURL = vi.fn();
  window.confirm = vi.fn(() => true);
});

describe('MemoriesPage (Gate P12)', () => {
  it('日ごとに記録を並べ、写真はファイルを読み込んで代替テキスト付きで表示する', async () => {
    renderPage();
    const day1 = await screen.findByRole('region', { name: '2026-11-01' });
    expect(within(day1).getByText(/hanakoと朝の参拝/)).toBeInTheDocument();
    expect(within(day1).getAllByText(/清水寺/).length).toBeGreaterThan(0);
    const img = await within(day1).findByRole('img', { name: '写真' });
    expect(img).toHaveAttribute('src', 'blob:memory');
    expect(m.getMemoryMedia).toHaveBeenCalledWith('p1', list.memories[1]!.id);
    const day2 = screen.getByRole('region', { name: '2026-11-02' });
    expect(within(day2).getByRole('link', { name: '動画を開く(外部のサイト)' })).toHaveAttribute('rel', 'noopener noreferrer');
    const other = screen.getByRole('region', { name: 'そのほかの記録' });
    expect(within(other).getByText('hanakoさんの記録')).toBeInTheDocument();
    // 他人の記録は変更できない(削除は所有者だけ)
    expect(within(other).queryByRole('button', { name: 'メモを編集' })).toBeNull();
  });

  it('メモを記録する(既定は自分だけ)。メモが空なら送らない', async () => {
    m.createMemory.mockResolvedValue(fx.memory_note);
    renderPage();
    const form = await screen.findByRole('form', { name: '記録を追加' });
    fireEvent.click(within(form).getByRole('button', { name: '記録する' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('メモを入力してください');
    expect(m.createMemory).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText('メモの内容'), { target: { value: '湯豆腐がおいしかった' } });
    fireEvent.change(within(form).getByLabelText('予定'), { target: { value: note.event_id } });
    fireEvent.click(within(form).getByRole('button', { name: '記録する' }));
    await waitFor(() => expect(m.createMemory).toHaveBeenCalledWith('p1', expect.objectContaining({
      kind: 'note', body: '湯豆腐がおいしかった', event_id: note.event_id, visibility: 'private', include_in_journal: true,
      video_url: null,
    })));
    expect(await screen.findByText('メモを記録しました')).toBeInTheDocument();
  });

  it('写真は形式を確かめてから送り、動画は https のURLだけ', async () => {
    m.uploadMemory.mockResolvedValue(fx.memory_photo);
    m.createMemory.mockResolvedValue(fx.memory_video);
    renderPage();
    const form = await screen.findByRole('form', { name: '記録を追加' });
    fireEvent.click(within(form).getByLabelText('写真'));
    const input = within(form).getByLabelText('写真のファイル');
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.mp3')] } });
    fireEvent.click(within(form).getByRole('button', { name: '記録する' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('写真の形式に対応していません');
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.change(within(form).getByLabelText('写真のファイル'), { target: { files: [png] } });
    fireEvent.change(within(form).getByLabelText('公開範囲'), { target: { value: 'members' } });
    fireEvent.click(within(form).getByRole('button', { name: '記録する' }));
    await waitFor(() => expect(m.uploadMemory).toHaveBeenCalledWith('p1', expect.objectContaining({
      kind: 'photo', file: png, visibility: 'members',
    })));
    expect(await screen.findByText('写真を記録しました')).toBeInTheDocument();
    await within(form).findByRole('button', { name: '記録する' });

    fireEvent.click(within(form).getByLabelText('動画'));
    fireEvent.change(within(form).getByLabelText('動画のURL(https)'), { target: { value: 'http://video.example/v' } });
    fireEvent.click(within(form).getByRole('button', { name: '記録する' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('https://');
    fireEvent.change(within(form).getByLabelText('動画のURL(https)'), { target: { value: 'https://video.example/v/9' } });
    fireEvent.click(within(form).getByRole('button', { name: '記録する' }));
    await waitFor(() => expect(m.createMemory).toHaveBeenCalledWith('p1', expect.objectContaining({
      kind: 'video', video_url: 'https://video.example/v/9',
    })));
  });

  it('本人は公開範囲を切り替えられ(If-Match用の版を送る)、削除は確認してから行う', async () => {
    m.updateMemory.mockResolvedValue(fx.memory_updated);
    m.deleteMemory.mockResolvedValue(undefined);
    renderPage();
    const day1 = await screen.findByRole('region', { name: '2026-11-01' });
    const card = within(day1).getByText(/hanakoと朝の参拝/).closest('li')!;
    const toggle = within(card).getByRole('button', { name: note.visibility === 'members' ? '自分だけにする' : 'メンバーに公開する' });
    fireEvent.click(toggle);
    await waitFor(() => expect(m.updateMemory).toHaveBeenCalledWith(
      'p1', note.id, { visibility: note.visibility === 'members' ? 'private' : 'members' }, note.revision));
    window.confirm = vi.fn(() => false);
    fireEvent.click(within(card).getByRole('button', { name: '削除' }));
    expect(m.deleteMemory).not.toHaveBeenCalled();
    window.confirm = vi.fn(() => true);
    fireEvent.click(within(card).getByRole('button', { name: '削除' }));
    await waitFor(() => expect(m.deleteMemory).toHaveBeenCalledWith('p1', note.id));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('7日間は「元に戻す」で戻せます'));
    expect(await screen.findByRole('status')).toHaveTextContent('記録を削除しました(7日間は元に戻せます)');
    // [Gate G6] 削除の直後に戻せる
    g6.restoreMemory.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: '削除を元に戻す' }));
    await waitFor(() => expect(g6.restoreMemory).toHaveBeenCalledWith('p1', note.id));
    expect(await screen.findByRole('status')).toHaveTextContent('記録を元に戻しました');
    expect(screen.queryByRole('button', { name: '削除を元に戻す' })).toBeNull();
  });

  it('[Gate G6] 削除した記録の一覧から元に戻せる', async () => {
    const trash = g6fx.memory_trash as MemoryTrashItem[];
    g6.getMemoryTrash.mockResolvedValueOnce(trash).mockResolvedValue([]);
    g6.restoreMemory.mockResolvedValue(undefined);
    renderPage();
    const section = await screen.findByRole('region', { name: '削除した記録' });
    expect(section).toHaveTextContent('メモ: 消して戻すメモ');
    fireEvent.click(within(section).getByRole('button', { name: '消して戻すメモを元に戻す' }));
    await waitFor(() => expect(g6.restoreMemory).toHaveBeenCalledWith('p1', trash[0]!.memory_id));
    await waitFor(() => expect(screen.queryByRole('region', { name: '削除した記録' })).toBeNull());
  });

  it('[Gate G6] 旅行記の公開: 内容と確認の項目を見せ、全て確かめた時だけ公開し、URL を一度だけ出す。公開をやめられる', async () => {
    const preview = g6fx.publication_preview as PublicationPreview;
    const created = g6fx.publication_created as MemoryPublication;
    g6.previewPublication.mockResolvedValue(preview);
    g6.createPublication.mockResolvedValue({ ...created, url: '/journal/abc' });
    renderPage();
    const section = await screen.findByRole('region', { name: '旅行記の公開' });
    fireEvent.click(within(section).getByLabelText('地名と大まかな移動(約1km)だけ'));
    fireEvent.click(within(section).getByLabelText(/写真を含める/));
    fireEvent.click(within(section).getByRole('button', { name: '公開する内容を確認する' }));
    await waitFor(() => expect(g6.previewPublication).toHaveBeenCalledWith('p1', { location_level: 'area', include_photos: true }));
    const content = await within(section).findByLabelText('公開する内容');
    expect(within(content).getByRole('list', { name: '公開する記録' })).toHaveTextContent('清水寺は朝が静か(清水の舞台)');
    const publish = within(section).getByRole('button', { name: 'この内容で公開する' });
    expect(publish).toBeDisabled();
    for (const a of preview.required_acknowledgements) fireEvent.click(within(section).getByLabelText(a.message));
    expect(publish).toBeEnabled();
    g6.getPublications.mockResolvedValue([created]);
    fireEvent.click(publish);
    await waitFor(() => expect(g6.createPublication).toHaveBeenCalledWith('p1', expect.objectContaining({
      location_level: 'area', include_photos: true,
      acknowledge: expect.arrayContaining(preview.required_acknowledgements.map((a) => a.code)) })));
    expect(await within(section).findByLabelText('公開の URL(今だけ表示します)')).toHaveValue(`${window.location.origin}/journal/abc`);
    expect(await screen.findByRole('status')).toHaveTextContent('旅行記を公開しました');
    const list = await within(section).findByRole('list', { name: '公開した旅行記' });
    g6.revokePublication.mockResolvedValue({ ...created, is_active: false });
    g6.getPublications.mockResolvedValue([{ ...created, is_active: false, revoked_at: '2026-10-23T00:00:00Z' }]);
    fireEvent.click(within(list).getByRole('button', { name: `${created.title}の公開をやめる` }));
    await waitFor(() => expect(g6.revokePublication).toHaveBeenCalledWith('p1', created.id));
    expect(await within(list).findByText(/公開をやめました/)).toBeInTheDocument();
  });

  it('[Gate G6] 選び方を変えると確認をやり直す。公開できない理由を示す', async () => {
    g6.previewPublication.mockResolvedValue(g6fx.publication_preview as PublicationPreview);
    g6.createPublication.mockRejectedValue({ response: { status: 403, data: { detail: { code: 'members_only',
      message: '旅行記の公開は会員だけができます(会員登録すると公開できます)' } } } });
    renderPage();
    const section = await screen.findByRole('region', { name: '旅行記の公開' });
    fireEvent.click(within(section).getByRole('button', { name: '公開する内容を確認する' }));
    await within(section).findByLabelText('公開する内容');
    fireEvent.click(within(section).getByLabelText(/写真を含める/));
    expect(within(section).queryByLabelText('公開する内容')).toBeNull();
    g6.previewPublication.mockResolvedValue({ ...(g6fx.publication_preview as PublicationPreview), required_acknowledgements: [] });
    fireEvent.click(within(section).getByRole('button', { name: '公開する内容を確認する' }));
    fireEvent.click(await within(section).findByRole('button', { name: 'この内容で公開する' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('会員だけができます');
  });

  it('旅行記の下書き: 選んだ範囲で作り、公開前の確認を表示する', async () => {
    m.createJournalDraft.mockResolvedValue(fx.journal_draft as JournalDraft);
    renderPage();
    const section = await screen.findByRole('region', { name: '旅行記の下書き' });
    fireEvent.click(within(section).getByLabelText('他のメンバーが公開した記録を含める'));
    fireEvent.click(within(section).getByRole('button', { name: '下書きを作る' }));
    await waitFor(() => expect(m.createJournalDraft).toHaveBeenCalledWith('p1', {
      include_locations: false, include_media: true, include_others: true,
    }));
    const checks = await within(section).findByRole('list', { name: '公開前の確認' });
    expect(within(checks).getAllByRole('listitem')[0]).toHaveTextContent('要確認: 同行者の名前が含まれています');
    expect(within(section).getByLabelText('下書き(Markdown)')).toHaveValue(fx.journal_draft.markdown);
  });

  it('閲覧者には追加の入力欄を出さない。取得に失敗したら案内する', async () => {
    m.getMemories.mockResolvedValue(fx.memory_list_empty);
    m.getMemories.mockResolvedValueOnce({ ...fx.memory_list_empty, can_create: false });
    renderPage();
    expect(await screen.findByText('まだ記録はありません。')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: '記録を追加' })).toBeNull();
  });
});
