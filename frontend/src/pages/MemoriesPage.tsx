/**
 * MemoriesPage - 写真・メモ・旅行記(DOC-04 SC-28、FR-037)。
 *
 * [Gate P12] backend/app/api/v1/memories.py の画面。
 * - 予定・日へ、文章のメモ・写真・音声メモ・動画の参照(URL)を記録する。公開範囲は既定で「自分だけ」
 * - 記録を日ごとに一覧し、本人は内容・公開範囲・旅行記に使うかを変えられる(If-Match: 記録の版)
 * - 計画と記録から旅行記の下書きを作り、公開前の検査(同行者の名前・予約番号・電話番号・位置・写真)を表示する。
 *   下書きはコピー・Markdownファイルとして保存できる(公開ページへの掲載はまだ無い)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import api, {
  createJournalDraft, createMemory, deleteMemory, getMemories, getMemoryMedia, updateMemory, uploadMemory,
} from '@/services/api';
import type { JournalDraft, MemoryKind, MemoryList, MemoryVisibility, NormalizedDay, TravelMemory } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { safeExternalUrl } from '@/utils/safeNavigation';
import {
  AUDIO_EXTENSIONS, KIND_LABEL, PHOTO_EXTENSIONS, VISIBILITY_LABEL, eventLabel, fileProblem, formatSize,
  groupMemories, journalFileName, videoUrlProblem,
} from './memories/memoriesModel';
import JournalPublishCard from './memories/JournalPublishCard';
import MemoryTrashCard from './memories/MemoryTrashCard';
import { restoreMemory } from '@/services/api/g6';

const MemoryMedia: React.FC<{ planId: string; memory: TravelMemory; alt: string }> = ({ planId, memory, alt }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let active = true;
    getMemoryMedia(planId, memory.id)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [planId, memory.id]);
  if (failed) return <p className="text-sm text-red-800">ファイルを読み込めませんでした</p>;
  if (!url) return <p className="text-sm text-ink-700">読み込み中…</p>;
  if (memory.kind === 'photo') {
    return <img src={url} alt={alt} className="max-h-64 rounded-lg border border-gray-200" />;
  }
  return <audio controls src={url} aria-label={alt} className="w-full" />;
};

const toIso = (local: string): string | null => {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const showTime = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
};

const MemoriesPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<MemoryList | null>(null);
  const [days, setDays] = useState<NormalizedDay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState<MemoryKind>('note');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [eventId, setEventId] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [visibility, setVisibility] = useState<MemoryVisibility>('private');
  const [includeInJournal, setIncludeInJournal] = useState(true);
  const [fileInputKey, setFileInputKey] = useState(0);

  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  const [includeLocations, setIncludeLocations] = useState(false);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [includeOthers, setIncludeOthers] = useState(false);
  const [draft, setDraft] = useState<JournalDraft | null>(null);
  // [Gate G6] MEM-01 削除の取り消し
  const [lastDeleted, setLastDeleted] = useState<string | null>(null);
  const [trashKey, setTrashKey] = useState(0);

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      const [list, detail] = await Promise.all([getMemories(planId), api.getPlanDetail(planId)]);
      setData(list);
      setDays(detail.data?.days ?? []);
    } catch (e) {
      setError(errorDetailMessage(e, '旅の記録の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    load();
  }, [load]);

  const events = useMemo(() => [...days]
    .sort((a, b) => a.local_date.localeCompare(b.local_date))
    .flatMap((d) => (d.events ?? []).map((e) => ({ id: e.id, label: `${d.local_date} ${e.local_start_time ?? ''} ${e.title}`.replace(/\s+/g, ' ') }))),
  [days]);
  const groups = useMemo(() => groupMemories(data?.memories ?? [], days), [data, days]);

  const resetForm = () => {
    setBody('');
    setFile(null);
    setVideoUrl('');
    setOccurredAt('');
    setPlaceName('');
    setFileInputKey((k) => k + 1);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId || !data) return;
    setError(null);
    setMessage(null);
    const common = {
      body: body.trim() || null, event_id: eventId || null, occurred_at: toIso(occurredAt),
      place_name: placeName.trim() || null, visibility, include_in_journal: includeInJournal,
    };
    if (kind === 'photo' || kind === 'audio') {
      if (!file) {
        setError(`${KIND_LABEL[kind]}のファイルを選んでください`);
        return;
      }
      const problem = fileProblem(kind, file, data.max_upload_bytes);
      if (problem) {
        setError(problem);
        return;
      }
    } else if (kind === 'video') {
      const problem = videoUrlProblem(videoUrl);
      if (problem) {
        setError(problem);
        return;
      }
    } else if (!common.body) {
      setError('メモを入力してください');
      return;
    }
    setBusy(true);
    try {
      if (kind === 'photo' || kind === 'audio') {
        await uploadMemory(planId, { kind, file: file as File, ...common });
      } else {
        await createMemory(planId, { kind, ...common, video_url: kind === 'video' ? videoUrl.trim() : null });
      }
      setMessage(`${KIND_LABEL[kind]}を記録しました`);
      resetForm();
      await load();
    } catch (err) {
      setError(errorDetailMessage(err, '記録できませんでした。もう一度お試しください'));
    } finally {
      setBusy(false);
    }
  };

  const change = async (m: TravelMemory, input: Parameters<typeof updateMemory>[2], done: string) => {
    if (!planId) return;
    setError(null);
    setMessage(null);
    try {
      await updateMemory(planId, m.id, input, m.revision);
      setMessage(done);
      setEditing(null);
    } catch (err) {
      setError(errorDetailMessage(err, '記録を変更できませんでした。画面を読み込み直してください'));
    } finally {
      await load();
    }
  };

  const remove = async (m: TravelMemory) => {
    if (!planId) return;
    const what = m.has_media ? `この${KIND_LABEL[m.kind]}(ファイルも消えます)` : `この${KIND_LABEL[m.kind]}`;
    if (!window.confirm(`${what}を削除します。削除から7日間は「元に戻す」で戻せます。よろしいですか?`)) return;
    setError(null);
    setMessage(null);
    setLastDeleted(null);
    try {
      await deleteMemory(planId, m.id);
      setMessage('記録を削除しました(7日間は元に戻せます)');
      setLastDeleted(m.id);
    } catch (err) {
      setError(errorDetailMessage(err, '記録を削除できませんでした'));
    } finally {
      setTrashKey((k) => k + 1);
      await load();
    }
  };

  const restore = async (memoryId: string) => {
    if (!planId) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await restoreMemory(planId, memoryId);
      setMessage('記録を元に戻しました');
      setLastDeleted(null);
    } catch (err) {
      setError(errorDetailMessage(err, '記録を元に戻せませんでした'));
    } finally {
      setBusy(false);
      setTrashKey((k) => k + 1);
      await load();
    }
  };

  const makeDraft = async () => {
    if (!planId) return;
    setError(null);
    try {
      setDraft(await createJournalDraft(planId, {
        include_locations: includeLocations, include_media: includeMedia, include_others: includeOthers,
      }));
    } catch (err) {
      setError(errorDetailMessage(err, '下書きを作れませんでした'));
    }
  };

  const copyDraft = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.markdown);
      setMessage('下書きをコピーしました');
    } catch {
      setError('コピーできませんでした。下の欄から選択してコピーしてください');
    }
  };

  const saveDraft = () => {
    if (!draft) return;
    const url = URL.createObjectURL(new Blob([draft.markdown], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = journalFileName(draft.title, draft.generated_at);
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!planId) return <div className="p-8 text-center text-ink-700">プランが選択されていません。</div>;

  const describe = (m: TravelMemory) => [eventLabel(m, days), m.place_name, showTime(m.occurred_at)].filter(Boolean).join('・');

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">← プランへ戻る</Button>
      <h1 className="text-2xl font-bold text-ink-900">旅の記録</h1>
      <p className="text-sm text-ink-700 mt-1">
        予定ごとにメモ・写真・音声メモ・動画のURLを残し、旅行記の下書きを作れます。記録は最初「自分だけ」に見えます。
      </p>
      {error && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
      {message && <div className="mt-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{message}</div>}
      {lastDeleted && (
        <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => void restore(lastDeleted)}>
          削除を元に戻す
        </Button>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : (
        <>
          {data?.can_create && (
            <Card padding="md" className="mt-6">
              <form onSubmit={submit} aria-label="記録を追加" className="space-y-3">
                <h2 className="font-semibold text-ink-900">記録を追加</h2>
                <fieldset>
                  <legend className="text-sm text-ink-900">種類</legend>
                  <div className="flex flex-wrap gap-3 mt-1">
                    {(['note', 'photo', 'audio', 'video'] as MemoryKind[]).map((k) => (
                      <label key={k} className="flex items-center gap-1 text-sm text-ink-900">
                        <input type="radio" name="memory-kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                        {KIND_LABEL[k]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {(kind === 'photo' || kind === 'audio') && (
                  <label className="block text-sm text-ink-900">
                    {`${KIND_LABEL[kind]}のファイル`}
                    <input
                      key={fileInputKey} type="file" className="block mt-1"
                      accept={(kind === 'photo' ? PHOTO_EXTENSIONS : AUDIO_EXTENSIONS).join(',')}
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                )}
                {kind === 'video' && (
                  <label className="block text-sm text-ink-900">
                    動画のURL(https)
                    <input type="url" className="block w-full mt-1 border rounded-sm px-2 py-1" value={videoUrl}
                      onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://" />
                  </label>
                )}
                <label className="block text-sm text-ink-900">
                  {kind === 'note' ? 'メモの内容' : 'メモの内容(任意)'}
                  <textarea className="block w-full mt-1 border rounded-sm px-2 py-1" rows={3} maxLength={5000} value={body}
                    onChange={(e) => setBody(e.target.value)} />
                </label>
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="block text-sm text-ink-900">
                    予定
                    <select className="block w-full mt-1 border rounded-sm px-2 py-1" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                      <option value="">(予定に紐付けない)</option>
                      {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.label}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm text-ink-900">
                    日時(任意)
                    <input type="datetime-local" className="block w-full mt-1 border rounded-sm px-2 py-1" value={occurredAt}
                      onChange={(e) => setOccurredAt(e.target.value)} />
                  </label>
                  <label className="block text-sm text-ink-900">
                    場所の名前(任意)
                    <input type="text" className="block w-full mt-1 border rounded-sm px-2 py-1" maxLength={200} value={placeName}
                      onChange={(e) => setPlaceName(e.target.value)} />
                  </label>
                  <label className="block text-sm text-ink-900">
                    公開範囲
                    <select className="block w-full mt-1 border rounded-sm px-2 py-1" value={visibility}
                      onChange={(e) => setVisibility(e.target.value as MemoryVisibility)}>
                      <option value="private">自分だけ</option>
                      <option value="members">旅行のメンバー</option>
                    </select>
                  </label>
                </div>
                <label className="flex items-center gap-2 text-sm text-ink-900">
                  <input type="checkbox" checked={includeInJournal} onChange={(e) => setIncludeInJournal(e.target.checked)} />
                  旅行記の下書きに使う
                </label>
                <Button type="submit" variant="primary" size="sm" disabled={busy}>{busy ? '記録しています…' : '記録する'}</Button>
              </form>
            </Card>
          )}

          <section aria-label="記録の一覧" className="mt-6">
            {groups.length === 0 ? (
              <Card padding="lg" className="text-center text-ink-700">まだ記録はありません。</Card>
            ) : groups.map((g) => (
              <section key={g.key} aria-label={g.label} className="mt-4">
                <h2 className="font-semibold text-ink-900">{g.label}</h2>
                <ul className="mt-2 space-y-2">
                  {g.memories.map((m) => (
                    <li key={m.id}>
                      <Card padding="md" className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-medium text-ink-900">{KIND_LABEL[m.kind]}</span>
                          <span className="px-2 py-0.5 rounded-sm bg-gray-100 text-ink-900">{VISIBILITY_LABEL[m.visibility]}</span>
                          {!m.by_me && <span className="text-ink-700">{`${m.author_name}さんの記録`}</span>}
                          {!m.include_in_journal && <span className="text-ink-700">旅行記に使わない</span>}
                          {m.size !== null && <span className="text-ink-700">{formatSize(m.size)}</span>}
                        </div>
                        {describe(m) && <p className="text-sm text-ink-700">{describe(m)}</p>}
                        {m.has_media && planId && (
                          <MemoryMedia planId={planId} memory={m}
                            alt={`${KIND_LABEL[m.kind]}${m.body ? `: ${m.body.slice(0, 40)}` : ''}`} />
                        )}
                        {safeExternalUrl(m.video_url) && (
                          <a href={safeExternalUrl(m.video_url) ?? undefined} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-800 underline break-all">
                            動画を開く(外部のサイト)
                          </a>
                        )}
                        {editing === m.id ? (
                          <div className="space-y-2">
                            <label className="block text-sm text-ink-900">
                              メモを編集
                              <textarea className="block w-full mt-1 border rounded-sm px-2 py-1" rows={3} maxLength={5000}
                                value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                            </label>
                            <div className="flex gap-2">
                              <Button size="sm" variant="primary" onClick={() => change(m, { body: editBody }, 'メモを変更しました')}>保存</Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>やめる</Button>
                            </div>
                          </div>
                        ) : m.body && <p className="text-ink-900 whitespace-pre-wrap">{m.body}</p>}
                        <div className="flex flex-wrap gap-2">
                          {m.can_edit && editing !== m.id && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => { setEditing(m.id); setEditBody(m.body ?? ''); }}>
                                メモを編集
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => change(
                                m, { visibility: m.visibility === 'private' ? 'members' : 'private' },
                                m.visibility === 'private' ? 'メンバーに公開しました' : '自分だけに戻しました',
                              )}>
                                {m.visibility === 'private' ? 'メンバーに公開する' : '自分だけにする'}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => change(
                                m, { include_in_journal: !m.include_in_journal },
                                m.include_in_journal ? '旅行記に使わないようにしました' : '旅行記に使うようにしました',
                              )}>
                                {m.include_in_journal ? '旅行記に使わない' : '旅行記に使う'}
                              </Button>
                            </>
                          )}
                          {m.can_delete && <Button size="sm" variant="danger" onClick={() => remove(m)}>削除</Button>}
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </section>

          <Card padding="md" className="mt-8">
            <section aria-label="旅行記の下書き" className="space-y-3">
              <h2 className="font-semibold text-ink-900">旅行記の下書き</h2>
              <p className="text-sm text-ink-700">
                予定と記録から下書きを作ります(旅程は変わりません)。コピーかファイルの保存で使えます。
                ページとして公開する時は、下の「旅行記を公開する」を使ってください。
              </p>
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-sm text-ink-900">
                  <input type="checkbox" checked={includeLocations} onChange={(e) => setIncludeLocations(e.target.checked)} />
                  位置(緯度・経度)を含める
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-900">
                  <input type="checkbox" checked={includeMedia} onChange={(e) => setIncludeMedia(e.target.checked)} />
                  写真・音声・動画を含める
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-900">
                  <input type="checkbox" checked={includeOthers} onChange={(e) => setIncludeOthers(e.target.checked)} />
                  他のメンバーが公開した記録を含める
                </label>
              </div>
              <Button size="sm" variant="primary" onClick={makeDraft}>下書きを作る</Button>
              {draft && (
                <div className="space-y-3" aria-label="下書きの結果">
                  <p className="text-sm text-ink-900">
                    {`予定${draft.summary.planned_events}件のうち${draft.summary.recorded_events}件に記録があります(記録${draft.summary.memories}件・写真${draft.summary.photos}枚)。`}
                  </p>
                  {draft.checks.length > 0 && (
                    <ul aria-label="公開前の確認" className="space-y-1">
                      {draft.checks.map((c, i) => (
                        <li key={`${c.code}-${c.memory_id ?? i}`}
                          className={`text-sm p-2 rounded-sm ${c.severity === 'warning' ? 'bg-amber-50 text-amber-900' : 'bg-gray-50 text-ink-900'}`}>
                          {`${c.severity === 'warning' ? '要確認' : 'お知らせ'}: ${c.message}`}
                        </li>
                      ))}
                    </ul>
                  )}
                  <label className="block text-sm text-ink-900">
                    下書き(Markdown)
                    <textarea readOnly className="block w-full mt-1 border rounded-sm px-2 py-1 font-mono text-sm" rows={12}
                      value={draft.markdown} />
                  </label>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={copyDraft}>コピー</Button>
                    <Button size="sm" variant="outline" onClick={saveDraft}>ファイルに保存(.md)</Button>
                  </div>
                </div>
              )}
            </section>
          </Card>
          <JournalPublishCard planId={planId} onMessage={(t) => { setLastDeleted(null); setMessage(t); }} onError={setError} />
          <MemoryTrashCard planId={planId} reloadKey={trashKey} busy={busy} onRestore={(id) => void restore(id)} />
        </>
      )}
    </div>
  );
};

export default MemoriesPage;
