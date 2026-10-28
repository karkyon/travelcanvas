/**
 * [Gate G11] 発見(UIX-M08)・SNS の投稿の取り込み(UIX-M09)・外部の写真(UIX-M14)・予定の写真(UIX-M10)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  searchNearby: vi.fn(), previewSocialUrl: vi.fn(), searchExternalImages: vi.fn(), getExternalThumb: vi.fn(),
  importExternalImage: vi.fn(), setEventImage: vi.fn(), clearEventImage: vi.fn(), getMediaProviderStatus: vi.fn(),
  getMemories: vi.fn(), getMemoryMedia: vi.fn(),
}));
vi.mock('@/services/api/g11discover', () => api);
vi.mock('@/services/api', () => ({ getMemories: api.getMemories, getMemoryMedia: api.getMemoryMedia }));

import NearbyDiscover from './NearbyDiscover';
import SocialImportCard from './SocialImportCard';
import { distanceLabel } from './discoverModel';
import ExternalPhotoPicker from '@/components/media/ExternalPhotoPicker';
import EventPhotoDialog from '@/components/planner/EventPhotoDialog';
import type { ExternalImage, NearbyResult } from '@/services/api/types/g11discover';

const result = (over: Partial<NearbyResult>): NearbyResult => ({
  id: 'c1', provider: 'overpass', name: '甘味処', category: 'cafe',
  location: { latitude: 35.0, longitude: 135.7, address: null }, retrieved_at: '2026-10-28T10:00:00+00:00',
  distance_m: 650, within_radius: true, radius_guaranteed: true, ...over,
});
const image = (over: Partial<ExternalImage>): ExternalImage => ({
  provider: 'wikimedia_commons', provider_id: 'File:A.jpg', title: '清水寺', author: '山田', license: 'CC BY-SA 4.0',
  license_url: null, attribution: null, source_page_url: 'https://commons.wikimedia.org/wiki/File:A.jpg', width: 40,
  height: 30, mime: 'image/jpeg', retrieved_at: '2026-10-28T10:00:00+00:00', importable: true, ...over,
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
  api.getExternalThumb.mockResolvedValue(new Blob(['x']));
  api.getMemoryMedia.mockResolvedValue(new Blob(['x']));
});

describe('距離の言い方', () => {
  it('半径を保証する提供元だけ「半径内」、それ以外は「周辺優先」、座標が無ければ「距離不明」', () => {
    expect(distanceLabel(result({}))).toBe('半径内 · 650m');
    expect(distanceLabel(result({ distance_m: 1400, radius_guaranteed: false }))).toBe('周辺優先 · 1.4km');
    expect(distanceLabel(result({ within_radius: false, distance_m: 6000 }))).toBe('半径の外 · 6.0km');
    expect(distanceLabel(result({ distance_m: null, within_radius: null }))).toBe('距離不明');
  });
});

describe('近くの「行きたい」を集める', () => {
  it('旅程の場所を基点にカテゴリと半径で探し、近い順に出典つきで出す。候補箱へ入れられる', async () => {
    api.searchNearby.mockResolvedValue({ query: '', category: 'food', radius_km: 2, base: null, total: 2, candidates: [
      result({ id: 'far', name: '遠い店', distance_m: 1400, radius_guaranteed: false, within_radius: true }),
      result({}),
    ] });
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<NearbyDiscover bases={[{ id: 'e1', label: '11/14 清水寺', latitude: 35.0, longitude: 135.78 }]} canEdit
      onAddCandidate={onAdd} />);
    fireEvent.click(screen.getByTestId('nearby-search'));
    expect(await screen.findByRole('alert')).toHaveTextContent('探す言葉を入力');
    fireEvent.click(screen.getByTestId('nearby-category-food'));
    expect(screen.getByTestId('nearby-category-food')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('nearby-search'));
    await waitFor(() => expect(api.searchNearby).toHaveBeenCalledWith({ query: '', category: 'food', latitude: 35.0,
      longitude: 135.78, radius_km: 2 }));
    const rows = await screen.findAllByTestId(/nearby-result-/);
    expect(rows[0]).toHaveTextContent('甘味処');
    expect(rows[0]).toHaveTextContent('半径内 · 650m');
    expect(rows[1]).toHaveTextContent('周辺優先 · 1.4km');
    expect(rows[0]).toHaveTextContent('出典: OpenStreetMap(近くの場所)');
    fireEvent.click(screen.getByTestId('nearby-add-c1'));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' })));
    expect(await screen.findByText('候補箱に入れました')).toBeInTheDocument();
  });

  it('座標の手入力は範囲を確かめる。失敗は値を作らずに知らせる', async () => {
    api.searchNearby.mockRejectedValue(new Error('x'));
    render(<NearbyDiscover bases={[]} canEdit onAddCandidate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('探す言葉(カテゴリで探す時は空でも可)'), { target: { value: '甘味' } });
    fireEvent.change(screen.getByLabelText('緯度'), { target: { value: '95' } });
    fireEvent.change(screen.getByLabelText('経度'), { target: { value: '135' } });
    fireEvent.click(screen.getByTestId('nearby-search'));
    expect(await screen.findByRole('alert')).toHaveTextContent('探す基点を選んでください');
    fireEvent.change(screen.getByLabelText('緯度'), { target: { value: '35' } });
    fireEvent.click(screen.getByTestId('nearby-search'));
    expect(await screen.findByRole('alert')).toHaveTextContent('探せませんでした');
    expect(screen.queryAllByTestId(/nearby-result-/)).toHaveLength(0);
  });
});

describe('SNS の投稿から取り込む', () => {
  it('確かめたら確認のカード、場所の候補を選んで social で保存する', async () => {
    api.previewSocialUrl.mockResolvedValue({ platform: 'youtube', status: 'ok', url: 'https://www.youtube.com/watch?v=a',
      title: '<img src=x onerror=alert(1)>清水寺', author: '旅人', retrieved_at: '2026-10-28T10:00:00+00:00', reason: null,
      fallback: null, place_suggestions: [{ word: '清水寺', name: '清水寺', address: '京都市', latitude: 35, longitude: 135.7,
        provider: 'nominatim', confidence: 'medium' }] });
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SocialImportCard planId="p1" canEdit onSave={onSave} />);
    fireEvent.change(screen.getByTestId('social-url'), { target: { value: 'https://www.youtube.com/watch?v=a' } });
    fireEvent.click(screen.getByTestId('social-check'));
    expect(await screen.findByTestId('social-preview')).toHaveAttribute('data-status', 'ok');
    // 外部の題名は文字として出すだけ(HTML として描かない)
    expect(screen.getByTestId('social-title').textContent).toContain('<img src=x onerror=alert(1)>');
    expect(document.querySelector('[data-testid="social-title"] img')).toBeNull();
    expect(screen.getByText(/確からしさ 中/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('social-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      title: '清水寺', source_url: 'https://www.youtube.com/watch?v=a', social: true, platform: 'youtube', latitude: 35,
    })));
    expect(await screen.findByText('候補箱に入れました')).toBeInTheDocument();
  });

  it('取れない時は URL とメモを出典として保存に切り替え、取れたように見せない', async () => {
    api.previewSocialUrl.mockResolvedValue({ platform: 'instagram', status: 'unavailable', url: 'https://www.instagram.com/p/x/',
      title: null, author: null, retrieved_at: null, reason: 'token_required', fallback: 'url_and_note', place_suggestions: [] });
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SocialImportCard planId="p1" canEdit onSave={onSave} />);
    fireEvent.change(screen.getByTestId('social-url'), { target: { value: 'https://www.instagram.com/p/x/' } });
    fireEvent.click(screen.getByTestId('social-check'));
    expect(await screen.findByTestId('social-fallback')).toHaveTextContent('鍵');
    fireEvent.change(screen.getByTestId('social-name'), { target: { value: '気になる店' } });
    fireEvent.click(screen.getByTestId('social-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ social: false, retrieved_at: null,
      title: '気になる店' })));
  });
});

describe('外部の写真', () => {
  it('作者・ライセンス・出典を出し、使えないライセンスは取り込めない。使うと取り込んで返す', async () => {
    api.searchExternalImages.mockResolvedValue({ images: [image({}), image({ provider_id: 'File:NC.jpg', license: 'CC BY-NC 4.0',
      importable: false })], unavailable: [], retrieved_at: '2026-10-28T10:00:00+00:00' });
    api.importExternalImage.mockResolvedValue({ id: 'm9' });
    const onImported = vi.fn();
    render(<ExternalPhotoPicker isOpen onClose={vi.fn()} planId="p1" initialQuery="清水寺" onImported={onImported}
      purposeLabel="旅行の表紙" />);
    fireEvent.click(screen.getByRole('button', { name: '探す' }));
    const card = await screen.findByTestId('external-image-File:A.jpg');
    expect(card).toHaveTextContent('作者: 山田');
    expect(card).toHaveTextContent('ライセンス: CC BY-SA 4.0');
    expect(screen.getByTestId('external-blocked-File:NC.jpg')).toHaveTextContent('使えないライセンス');
    expect(screen.queryByTestId('external-use-File:NC.jpg')).toBeNull();
    await waitFor(() => expect(api.getExternalThumb).toHaveBeenCalledWith('wikimedia_commons', 'File:A.jpg'));
    fireEvent.click(screen.getByTestId('external-use-File:A.jpg'));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith({ id: 'm9' }));
    expect(api.importExternalImage).toHaveBeenCalledWith('p1', 'wikimedia_commons', 'File:A.jpg', null);
  });
});

describe('予定の写真', () => {
  it('旅行の写真から選んで予定に使い、外す', async () => {
    api.getMemories.mockResolvedValue({ memories: [{ id: 'm1', kind: 'photo', has_media: true, visibility: 'private',
      body: '本堂', place_name: null, source: null }], can_create: true, max_upload_bytes: 1 });
    api.setEventImage.mockResolvedValue({ event_id: 'e1', image: { memory_id: 'm1', visibility: 'private', source: null } });
    api.clearEventImage.mockResolvedValue({ event_id: 'e1', image: null });
    const onChanged = vi.fn();
    const { rerender } = render(<EventPhotoDialog isOpen onClose={vi.fn()} planId="p1" eventId="e1" eventTitle="清水寺"
      near={null} current={null} externalEnabled={false} onChanged={onChanged} />);
    expect(screen.queryByTestId('event-photo-external')).toBeNull();
    fireEvent.click(await screen.findByTestId('event-photo-choice-m1'));
    fireEvent.click(screen.getByTestId('event-photo-save'));
    await waitFor(() => expect(api.setEventImage).toHaveBeenCalledWith('p1', 'e1', 'm1'));
    expect(onChanged).toHaveBeenCalledWith({ memory_id: 'm1', visibility: 'private', source: null });
    rerender(<EventPhotoDialog isOpen onClose={vi.fn()} planId="p1" eventId="e1" eventTitle="清水寺" near={null}
      current={{ memory_id: 'm1', visibility: 'private', source: null }} externalEnabled onChanged={onChanged} />);
    expect(await screen.findByTestId('event-photo-external')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('event-photo-clear'));
    await waitFor(() => expect(onChanged).toHaveBeenLastCalledWith(null));
  });
});
