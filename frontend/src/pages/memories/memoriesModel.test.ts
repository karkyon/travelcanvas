import { describe, expect, it } from 'vitest';
import type { NormalizedDay, TravelMemory } from '@/services/api';
import { eventLabel, fileProblem, formatSize, groupMemories, journalFileName, videoUrlProblem } from './memoriesModel';

const days: NormalizedDay[] = [
  { id: 'd2', local_date: '2026-11-02', timezone_id: 'Asia/Tokyo', sort_order: 1, events: [] },
  {
    id: 'd1', local_date: '2026-11-01', timezone_id: 'Asia/Tokyo', title: '京都', sort_order: 0,
    events: [{ id: 'e1', day_id: 'd1', title: '清水寺', locked: false, sort_order: 0 } as never],
  },
];

const mem = (over: Partial<TravelMemory>): TravelMemory => ({
  id: 'm', plan_id: 'p', kind: 'note', body: 'x', event_id: null, day_id: null, occurred_at: null, place_name: null,
  latitude: null, longitude: null, video_url: null, has_media: false, mime_type: null, size: null,
  visibility: 'private', include_in_journal: true, author_name: 'me', by_me: true, can_edit: true, can_delete: true,
  revision: 1, created_at: null, updated_at: null, ...over,
});

describe('memoriesModel', () => {
  it('日ごとに並べ、日の無い記録・消えた予定の記録を「そのほか」にまとめる', () => {
    const groups = groupMemories([
      mem({ id: 'a', day_id: 'd2' }), mem({ id: 'b', day_id: 'd1', event_id: 'e1' }), mem({ id: 'c' }),
      mem({ id: 'd', day_id: 'd1', event_id: 'gone' }), mem({ id: 'e', day_id: 'missing' }),
    ], days);
    expect(groups.map((g) => [g.label, g.memories.map((m) => m.id)])).toEqual([
      ['2026-11-01 京都', ['b']], ['2026-11-02', ['a']], ['そのほかの記録', ['c', 'd', 'e']],
    ]);
    expect(eventLabel(mem({ event_id: 'e1' }), days)).toBe('清水寺');
    expect(eventLabel(mem({ event_id: 'gone' }), days)).toBe('(削除された予定)');
    expect(eventLabel(mem({}), days)).toBeNull();
  });

  it('ファイルの形式・大きさを送る前に確かめる', () => {
    const f = (name: string, size: number) => new File([new Uint8Array(size)], name);
    expect(fileProblem('photo', f('a.JPG', 10), 100)).toBeNull();
    expect(fileProblem('photo', f('a.mp3', 10), 100)).toMatch('写真の形式');
    expect(fileProblem('audio', f('v.m4a', 10), 100)).toBeNull();
    expect(fileProblem('audio', f('v.m4a', 0), 100)).toBe('ファイルが空です');
    expect(fileProblem('photo', f('a.png', 3 * 1024 * 1024), 2 * 1024 * 1024)).toBe('ファイルが大きすぎます(上限 2MB)');
  });

  it('動画のURLは https だけ', () => {
    expect(videoUrlProblem('https://video.example/v/1')).toBeNull();
    expect(videoUrlProblem('http://video.example/v/1')).toMatch('https://');
    expect(videoUrlProblem('https://u:p@video.example/')).toMatch('パスワード');
    expect(videoUrlProblem('not a url')).toMatch('形式');
    expect(videoUrlProblem(' ')).toMatch('入力');
  });

  it('下書きのファイル名・サイズの表示', () => {
    expect(journalFileName('京都 旅/2026', '2026-11-03T10:00:00+00:00')).toBe('京都_旅_2026_旅行記_20261103.md');
    expect(journalFileName('', null)).toBe('旅行記_旅行記_draft.md');
    expect(formatSize(512)).toBe('512B');
    expect(formatSize(2048)).toBe('2KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0MB');
    expect(formatSize(null)).toBe('');
  });
});
