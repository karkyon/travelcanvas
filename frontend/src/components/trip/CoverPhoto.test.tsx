/**
 * [Gate G11] 旅行の表紙の写真: TripCover の写真(位置・拡大・出典・読めない時のグラデーション)、useCoverPhoto(一時の URL・
 * 失敗・読み直し)、CoverPhotoDialog(選ぶ・取り込む・位置・非公開の注意・外す・失敗の案内)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';

const { getMemories, getMemoryMedia, uploadMemory, setPlanCover, clearPlanCover, getPlanCoverMedia } = vi.hoisted(() => ({
  getMemories: vi.fn(), getMemoryMedia: vi.fn(), uploadMemory: vi.fn(), setPlanCover: vi.fn(), clearPlanCover: vi.fn(),
  getPlanCoverMedia: vi.fn(),
}));
vi.mock('@/services/api', () => ({ getMemories, getMemoryMedia, uploadMemory }));
vi.mock('@/services/api/g11', () => ({ setPlanCover, clearPlanCover, getPlanCoverMedia }));

import { MemoryRouter } from 'react-router-dom';
import TripCover from './TripCover';
import { TripHero } from '@/pages/dashboard/DashboardParts';
import type { DashboardTrip } from '@/services/api/types/g9';
import CoverPhotoDialog from './CoverPhotoDialog';
import { bumpCover, creditOf, useCoverPhoto } from '@/hooks/useCoverPhoto';
import type { PlanCover } from '@/services/api/types/g11';
import type { TravelMemory } from '@/services/api/types/memories';

const cover = (over: Partial<PlanCover> = {}): PlanCover => ({
  memory_id: 'm1', focus_x: 30, focus_y: 70, zoom: 150, visibility: 'private', by_me: true, source: null, revision: 1,
  ...over,
});

const memory = (id: string, over: Partial<TravelMemory> = {}): TravelMemory => ({
  id, plan_id: 'p1', kind: 'photo', body: `写真${id}`, event_id: null, day_id: null, occurred_at: null, place_name: null,
  latitude: null, longitude: null, video_url: null, has_media: true, mime_type: 'image/png', size: 10,
  visibility: 'private', include_in_journal: true, author_name: '自分', by_me: true, can_edit: true, can_delete: true,
  revision: 1, created_at: null, updated_at: null, source: null, ...over,
});

let urls = 0;
beforeEach(() => {
  urls = 0;
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:test/${(urls += 1)}`),
    revokeObjectURL: vi.fn(),
  }));
  [getMemories, getMemoryMedia, uploadMemory, setPlanCover, clearPlanCover, getPlanCoverMedia].forEach((f) => f.mockReset());
  getMemoryMedia.mockResolvedValue(new Blob(['x']));
});
afterEach(() => vi.unstubAllGlobals());

describe('TripCover の写真', () => {
  it('写真が無い時はグラデーションだけ、ある時は位置・拡大・出典を当てる', () => {
    const { rerender } = render(<TripCover tripTitle="京都" data-testid="c">題</TripCover>);
    expect(screen.getByTestId('c')).not.toHaveAttribute('data-has-photo');
    expect(screen.queryByTestId('trip-cover-photo')).toBeNull();
    rerender(
      <TripCover tripTitle="京都" data-testid="c"
        photo={{ src: 'blob:x', focusX: 30, focusY: 70, zoom: 150, credit: '写真: A / CC BY 4.0' }}>題</TripCover>,
    );
    expect(screen.getByTestId('c')).toHaveAttribute('data-has-photo', 'true');
    const img = screen.getByTestId('trip-cover-photo') as HTMLImageElement;
    expect(img.style.objectPosition).toBe('30% 70%');
    expect(img.style.transform).toBe('scale(1.5)');
    expect(img.getAttribute('alt')).toBe('');
    expect(screen.getByTestId('trip-cover-credit')).toHaveTextContent('CC BY 4.0');
    expect(screen.getByText('題')).toBeInTheDocument();
  });

  it('範囲の外の値は丸め、読めない時は onPhotoError を呼ぶ', () => {
    const onPhotoError = vi.fn();
    render(<TripCover tripTitle="京都" photo={{ src: 'blob:x', focusX: 500, focusY: -3, zoom: 50 }}
      onPhotoError={onPhotoError} />);
    const img = screen.getByTestId('trip-cover-photo') as HTMLImageElement;
    expect(img.style.objectPosition).toBe('100% 0%');
    expect(img.style.transform).toBe('scale(1)');
    fireEvent.error(img);
    expect(onPhotoError).toHaveBeenCalled();
  });
});

describe('useCoverPhoto', () => {
  it('表紙が無ければ読まない。あれば一時の URL、失敗はグラデーションへ、bumpCover で読み直す', async () => {
    const { result, rerender } = renderHook(({ c }) => useCoverPhoto('p1', c), { initialProps: { c: null as PlanCover | null } });
    expect(result.current.photo).toBeNull();
    expect(getPlanCoverMedia).not.toHaveBeenCalled();

    getPlanCoverMedia.mockResolvedValue(new Blob(['x']));
    rerender({ c: cover() });
    await waitFor(() => expect(result.current.photo?.src).toBe('blob:test/1'));
    expect(result.current.photo).toMatchObject({ focusX: 30, focusY: 70, zoom: 150, credit: null });

    act(() => bumpCover('p1'));
    await waitFor(() => expect(getPlanCoverMedia).toHaveBeenCalledTimes(2));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/1');

    getPlanCoverMedia.mockRejectedValue(new Error('offline'));
    act(() => bumpCover('p1'));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.photo).toBeNull();
  });

  it('出典の表示は外部の写真だけ', () => {
    expect(creditOf(null)).toBeNull();
    expect(creditOf({ kind: 'upload' })).toBeNull();
    expect(creditOf({ kind: 'external', author: 'A', license: 'CC BY-SA 4.0', provider: 'wikimedia_commons' }))
      .toBe('写真: A / CC BY-SA 4.0 / Wikimedia Commons');
  });
});

describe('CoverPhotoDialog', () => {
  const open = (props: Partial<React.ComponentProps<typeof CoverPhotoDialog>> = {}) => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<CoverPhotoDialog isOpen onClose={onClose} planId="p1" tripTitle="京都の旅" current={null}
      onSaved={onSaved} {...props} />);
    return { onSaved, onClose };
  };

  it('写真を選び、位置を整えて保存する。非公開の写真は他の人に見えないと示す', async () => {
    getMemories.mockResolvedValue({ memories: [memory('m1'), memory('m2', { visibility: 'members' }),
      memory('n1', { kind: 'note', has_media: false })], can_create: true, max_upload_bytes: 10 * 1024 * 1024 });
    setPlanCover.mockResolvedValue({ cover: cover({ memory_id: 'm1', focus_x: 35, zoom: 100, focus_y: 50 }), can_edit: true });
    const { onSaved, onClose } = open();
    expect(await screen.findByTestId('cover-choice-m1')).toHaveTextContent('自分だけ');
    expect(screen.getByTestId('cover-choice-m2')).toHaveTextContent('メンバー');
    expect(screen.queryByTestId('cover-choice-n1')).toBeNull();
    expect(screen.getByTestId('cover-save')).toBeDisabled();

    fireEvent.click(screen.getByTestId('cover-choice-m1'));
    expect(screen.getByTestId('cover-choice-m1')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('cover-private-note')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('cover-focus-x'), { target: { value: '35' } });
    await waitFor(() => expect(screen.getByTestId('cover-preview-hero')).toHaveAttribute('data-has-photo', 'true'));
    expect(screen.getByTestId('cover-preview-card')).toHaveAttribute('data-has-photo', 'true');
    expect(screen.getByRole('button', { name: '拡大を増やす' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cover-save'));
    await waitFor(() => expect(setPlanCover).toHaveBeenCalledWith('p1', 'm1', { focus_x: 35, focus_y: 50, zoom: 100 }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ memory_id: 'm1' }));
    expect(onClose).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('cover-choice-m2'));
    expect(screen.queryByTestId('cover-private-note')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('cover-preview-hero')).toHaveAttribute('data-has-photo', 'true'));
  });

  it('取り込みは非公開で保存し、上限を超えるファイルは送らない。失敗は理由を出す', async () => {
    getMemories.mockResolvedValue({ memories: [], can_create: true, max_upload_bytes: 1024 });
    open();
    expect(await screen.findByText(/まだ選べる写真がありません/)).toBeInTheDocument();
    expect(screen.getByText(/1KB まで/)).toBeInTheDocument();
    const input = screen.getByTestId('cover-upload-input');
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(2048)], 'big.jpg', { type: 'image/jpeg' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('ファイルが大きすぎます');
    expect(uploadMemory).not.toHaveBeenCalled();

    uploadMemory.mockResolvedValue(memory('m9'));
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(uploadMemory).toHaveBeenCalledWith('p1', expect.objectContaining({
      kind: 'photo', visibility: 'private', include_in_journal: false,
    })));
    expect(await screen.findByText((t) => t.includes('で保存しました'))).toBeInTheDocument();
    expect(screen.getByTestId('cover-choice-m9')).toHaveAttribute('aria-pressed', 'true');

    uploadMemory.mockRejectedValue({ response: { status: 422, data: { detail: { code: 'metadata_unremovable',
      message: '写真の撮影情報(撮影位置など)を取り除けないため、受け付けられません' } } } });
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], 'b.jpg', { type: 'image/jpeg' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('撮影情報');
    await waitFor(() => expect(screen.getByTestId('cover-preview-hero')).toHaveAttribute('data-has-photo', 'true'));
  });

  it('今の表紙を外せる。通信できない時は案内する', async () => {
    getMemories.mockResolvedValue({ memories: [memory('m1')], can_create: true, max_upload_bytes: 1024 });
    clearPlanCover.mockRejectedValueOnce(new Error('Network Error'));
    const { onSaved } = open({ current: cover() });
    fireEvent.click(await screen.findByTestId('cover-clear'));
    expect(await screen.findByRole('alert')).toHaveTextContent('通信できませんでした');
    clearPlanCover.mockResolvedValue({ cover: null, can_edit: true });
    fireEvent.click(screen.getByTestId('cover-clear'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(null));
  });
});

describe('ダッシュボードの表紙', () => {
  const trip = (c: PlanCover | null): DashboardTrip => ({
    id: 'p1', title: '京都', destination: '京都', role: 'viewer', can_edit: false, start_date: '2026-11-04',
    end_date: '2026-11-05', timezone_id: 'Asia/Tokyo', local_today: '2026-10-28', day_count: 2, total_days: 2,
    phase: 'upcoming', days_until_start: 7, day_number: null, days_since_end: null, member_count: 2,
    created_at: null, cover: c,
  });

  it('表紙の写真があれば写真、読めなければグラデーションのまま', async () => {
    getPlanCoverMedia.mockResolvedValue(new Blob(['x']));
    const { unmount } = render(<MemoryRouter><TripHero trip={trip(cover())} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('dashboard-hero')).toHaveAttribute('data-has-photo', 'true'));
    unmount();
    getPlanCoverMedia.mockRejectedValue({ response: { status: 404 } });
    render(<MemoryRouter><TripHero trip={trip(cover())} /></MemoryRouter>);
    await waitFor(() => expect(getPlanCoverMedia).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('dashboard-hero')).not.toHaveAttribute('data-has-photo'));
    expect(screen.getByText('京都', { selector: 'h2' })).toBeInTheDocument();
  });
});
