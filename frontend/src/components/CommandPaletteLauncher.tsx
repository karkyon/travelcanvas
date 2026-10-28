/**
 * [Gate G2] DEP-05 情報内検索(CommandPalette、FR-009)を後から読み込む入口。
 *
 * 最初に読む JS を小さくするため、検索の画面(CommandPalette)は別の塊にして、ヘッダーを描いた直後に読み込み始める。
 * 読み込みが終わる前に「検索」ボタン・Ctrl+K / ⌘K が押された時は、読み込み後に開いた状態で表示する(押した操作を失わない)。
 * ボタンの見た目・名前は CommandPalette と同じ。
 */
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Search } from 'lucide-react';

const loadPalette = () => import('./CommandPalette');
const CommandPalette = lazy(loadPalette);

const Placeholder: React.FC<{ onOpen: () => void }> = ({ onOpen }) => (
  <button type="button" onClick={onOpen}
    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-ink-900 hover:bg-gray-100"
    aria-haspopup="dialog" aria-label="検索(Ctrl+K)">
    <Search size={16} aria-hidden="true" />
    <span className="hidden lg:inline text-sm">検索</span>
    <kbd className="hidden lg:inline text-xs text-ink-700 border border-gray-300 rounded-sm px-1">Ctrl K</kbd>
  </button>
);

const CommandPaletteLauncher: React.FC = () => {
  const [ready, setReady] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  // [Gate G3] 検索の画面が自分で Ctrl+K を受け取れるようになるまで(読み込み後の描画の待ち=Suspense の間も)、ここで受け取る。
  // 以前は読み込みが終わった瞬間にここの受け取りを外していたため、描画の待ちの間に押された Ctrl+K が失われた
  const [paletteLive, setPaletteLive] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadPalette().then(() => { if (alive) setReady(true); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (paletteLive) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPendingOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteLive]);

  const placeholder = <Placeholder onOpen={() => setPendingOpen(true)} />;
  if (!ready && !pendingOpen) return placeholder;
  return (
    <Suspense fallback={placeholder}>
      <CommandPalette defaultOpen={pendingOpen} onLive={() => setPaletteLive(true)} />
    </Suspense>
  );
};

export default CommandPaletteLauncher;
