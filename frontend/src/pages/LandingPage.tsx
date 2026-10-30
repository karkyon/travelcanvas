/**
 * [Gate LP] 製品の LP(/)。利用者の案「tc-lp-concept-v2-01-cinematic」(2026-10-30)の構成に合わせる:
 *   1. 旅の景色(3場面が静かに切り替わる)と、相談 → 計画 → 旅行 → 思い出 が動く画面イメージ
 *   2. 「旅の流れを見る ↓」で流れの説明へ移る
 *   3. できること(PLAN YOUR WAY / ENJOY THE DAY / KEEP THE MOMENT)を、今の実装の状態(DOC-10)どおりに説明する
 *   4. いま使えるところ / まだつながっていないところ を分ける
 *   5. 料金は決まっていないことをそのまま示す(価格・購入の操作を作らない)
 *   6. 最後に「あなたの次の旅を、描きはじめよう。」
 * 利用者の評価・利用者数・星は出さない(事実が無い)。画面イメージの値は見本であることを示す。
 * 画像: 案に埋め込まれた AI 生成の旅の情景(public/lp/。出典は docs/trace/gate-lp-trace.md)。
 * 動きを減らす設定では、景色の切り替え・画面イメージの自動の切り替えをしない(手で切り替えられる)。
 */
import { Link, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import './landing/landing.css';

interface Stage {
  pill: string;
  label: string;
  title: string;
  prompt: string;
  rows: Array<[string, string, string]>;
}

// 画面イメージの見本(実際の利用者のデータではない)。各場面の操作は製品の実際の画面と同じ流れ
const STAGES: Stage[] = [
  {
    pill: '01 相談', label: '01 · 旅の相談', title: '「湖と街歩き、ゆっくり2日間」',
    prompt: '行き先が決まっていなくても、気分や日程をことばに。読み取った条件をあなたが確かめてから、方面を比べます。',
    rows: [['気分', '景色とローカルフード', '条件を確認'], ['日程', '土曜から2日間', '日付待ち']],
  },
  {
    pill: '02 計画', label: '02 · 旅程を組み立てる', title: '湖畔から街の食堂へ',
    prompt: '行きたい場所を日ごとに並べ、順番を変える前に、営業時間と移動への影響を確かめます。',
    rows: [['09:30', '湖畔の展望台', '営業時間内'], ['12:15', '路地裏の食堂', '徒歩の目安'], ['15:00', '旧市街を散策', '影響を確認']],
  },
  {
    pill: '03 旅行', label: '03 · 旅先で確かめる', title: '今日の予定をひと目で',
    prompt: '今と次の予定、出発までの時間。通信できない場所でも、保存した旅程を開けます。',
    rows: [['いま', '湖畔を散策', '到着'], ['次へ', '路地裏の食堂', '移動の目安'], ['あとで', '旧市街を歩く', '予定']],
  },
  {
    pill: '04 思い出', label: '04 · 思い出につなぐ', title: '旅のあとも、たどれるように',
    prompt: '訪れた場所・写真・メモを旅程に結んで残します。写真は自分だけに保存され、公開する前に確かめます。',
    rows: [['場所', '湖畔の展望台', '訪問'], ['写真', '朝の水面', '自分だけ'], ['メモ', '静かな朝だった', '記録']],
  },
];

const JOURNEY = [
  { no: '01 · CONSULT', title: '気分を相談する', text: '景色、食事、日程、移動手段。行き先が決まっていなくても、曖昧な希望を旅の条件に。' },
  { no: '02 · PLAN', title: '旅程を組み立てる', text: '日別の予定と地図を並べ、順番を変える前に影響を確かめて、全体を見渡す。' },
  { no: '03 · GO', title: '旅先で確かめる', text: '今日の予定、次の場所、遅れや休業の時の代わりの案。保存した旅程はオフラインでも。' },
  { no: '04 · REMEMBER', title: '旅の記録へ', text: '訪問・写真・メモを旅程とつなぎ、訪れた場所の地図と振り返りに残す。' },
];

const STAGE_MS = 3600;

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const LandingPage = () => {
  const navigate = useNavigate();
  const { startGuestSession, isLoading, isAuthenticated } = useAuthStore();
  const [guestError, setGuestError] = useState<string | null>(null);
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [enterKey, setEnterKey] = useState(0);

  const handleGuestStart = async () => {
    setGuestError(null);
    try {
      await startGuestSession();
      navigate('/planner');
    } catch (error) {
      setGuestError(
        error instanceof Error ? error.message : 'ゲストセッションの開始に失敗しました'
      );
    }
  };

  const show = useCallback((n: number) => {
    setStage(n);
    setEnterKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!playing) return undefined;
    const id = window.setInterval(() => {
      setStage((s) => (s + 1) % STAGES.length);
      setEnterKey((k) => k + 1);
    }, STAGE_MS);
    return () => window.clearInterval(id);
  }, [playing]);

  const pick = (n: number) => {
    setPlaying(false);
    show(n);
  };

  const scrollToStory = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById('story');
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
  };

  const s = STAGES[stage]!;

  const startButton = isAuthenticated ? (
    <Link className="lp-btn lp-btn--main" to="/dashboard">
      <span>旅の計画をつづける<small>ダッシュボードへ</small></span><span aria-hidden="true">↗</span>
    </Link>
  ) : (
    <button type="button" className="lp-btn lp-btn--main" onClick={handleGuestStart} disabled={isLoading}>
      <span>
        {isLoading ? 'ゲストセッションを開始しています...' : '旅の計画をはじめる'}
        <small>登録せずにゲストとして始める</small>
      </span>
      <span aria-hidden="true">↗</span>
    </button>
  );

  return (
    <div className="lp" data-testid="landing">
      <header className="lp-hero" id="top">
        <div className="lp-scene" aria-hidden="true" />
        <div className="lp-scene" aria-hidden="true" />
        <div className="lp-scene" aria-hidden="true" />
        <div className="lp-shade" aria-hidden="true" />
        <nav className="lp-nav" aria-label="ページ内の案内">
          <a className="lp-brand" href="#top">Travel<span>Canvas</span></a>
          <div className="lp-navlinks">
            <a href="#story">旅の流れ</a>
            <a href="#features">できること</a>
            <a href="#pricing">料金</a>
            {!isAuthenticated && <Link className="lp-login" to="/login">ログイン</Link>}
            <a className="lp-topcta" href="#start">計画をはじめる <span aria-hidden="true">↗</span></a>
          </div>
        </nav>
        <div className="lp-heroInner">
          <div className="lp-heroCopy">
            <div className="lp-eyebrow">YOUR NEXT JOURNEY STARTS HERE</div>
            <h1>行きたい景色から、<br />旅の一日を描こう。</h1>
            <p>
              「湖を見たい」「地元の食堂に行きたい」。その気持ちを、場所と時間のつながる旅程へ。
              相談から計画、旅先での確認、旅の記録までをひとつの流れに。
            </p>
            <div className="lp-actions">
              {startButton}
              <a className="lp-btn lp-btn--alt" href="#story" onClick={scrollToStory}>
                旅の流れを見る <span aria-hidden="true">↓</span>
              </a>
            </div>
            {guestError && <p className="lp-error" role="alert">{guestError}</p>}
            <div className="lp-heroNote">
              アカウントはあとから作れます。{!isAuthenticated && <>登録済みの方は <Link to="/login">ログイン</Link></>}
            </div>
          </div>

          <section className="lp-demo" aria-labelledby="lp-demo-title" data-testid="lp-demo">
            <div className="lp-demoTop">
              <b id="lp-demo-title">TRAVELCANVAS · TRIP IN MOTION</b>
              <small>画面イメージ</small>
            </div>
            <div className="lp-flowPills" role="group" aria-label="場面を選ぶ">
              {STAGES.map((x, i) => (
                <button key={x.pill} type="button" aria-pressed={i === stage} onClick={() => pick(i)}
                  data-testid={`lp-stage-${i}`}>
                  {x.pill}
                </button>
              ))}
            </div>
            <div key={enterKey} className={`lp-scenePanel${enterKey ? ' lp-enter' : ''}`}
              aria-live={playing ? 'off' : 'polite'} data-testid="lp-scene" data-stage={stage}>
              <div className="lp-sceneLabel">{s.label}</div>
              <div className="lp-sceneTitle">{s.title}</div>
              <p className="lp-scenePrompt">{s.prompt}</p>
              <div>
                {s.rows.map(([t, name, tag]) => (
                  <div className="lp-miniRoute" key={t + name}>
                    <time>{t}</time>
                    <div><strong>{name}</strong></div>
                    <span className="lp-miniTag">{tag}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="lp-demoFoot">
              <span data-testid="lp-counter">相談から記録まで · {stage + 1} / {STAGES.length}</span>
              <button type="button" onClick={() => setPlaying((p) => !p)} aria-pressed={!playing}
                data-testid="lp-play">
                {playing ? '一時停止' : '自動で切り替える'}
              </button>
            </div>
          </section>
        </div>
        <div className="lp-caption">画像: AI で生成した旅の情景(イメージ)</div>
      </header>

      <section className="lp-section lp-flow" id="story" tabIndex={-1} aria-labelledby="lp-story-h">
        <div className="lp-sectionHead">
          <span className="lp-kicker">ONE CONTINUOUS JOURNEY</span>
          <h2 id="lp-story-h">相談 → 計画 → 旅行 → 思い出</h2>
          <p>旅の前・旅の最中・旅のあと。同じ旅行のページで、相談した条件・旅程・当日の動き・記録がつながります。場面を押すと、上の画面イメージも切り替わります。</p>
        </div>
        <ol className="lp-journey">
          {JOURNEY.map((j, i) => (
            <li key={j.no}>
              <button type="button" aria-pressed={i === stage} onClick={() => pick(i)}>
                <span className="lp-no">{j.no}</span>
                {i < JOURNEY.length - 1 && <span className="lp-arrow" aria-hidden="true">→</span>}
                <h3>{j.title}</h3>
                <p>{j.text}</p>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-section lp-features" id="features" aria-labelledby="lp-features-h">
        <div className="lp-sectionHead">
          <span className="lp-kicker">WHAT TRAVELCANVAS HELPS WITH</span>
          <h2 id="lp-features-h">「予定表」で終わらない、旅の計画体験。</h2>
          <p>いま使える機能と、外部の提供元がまだつながっていない部分を分けて説明します。推定の値は推定と表示します。</p>
        </div>
        <div className="lp-featureGrid">
          <article className="lp-feature">
            <span className="lp-index">01 — PLAN YOUR WAY</span>
            <h3>行き先が未定でも、相談から旅程まで</h3>
            <p>希望をことばで伝え、読み取った条件を確かめて方面を比べ、選んだ方面だけで未確定の下書きを作ります。行き先が決まっていれば、すぐ旅程から。</p>
            <ul>
              <li>日ごとの予定・地図・全日程のチャート</li>
              <li>並べ替える前に、営業時間と移動への影響を確認</li>
              <li>候補箱に集めて、家族・グループで投票</li>
              <li>もしもの案を作って本案と比べる</li>
            </ul>
            <span className="lp-state">利用できます</span>
            <span className="lp-state lp-state--road">文章の読み取りは決まった規則(AI は未接続)</span>
          </article>
          <article className="lp-feature">
            <span className="lp-index">02 — ENJOY THE DAY</span>
            <h3>旅先では「今」と「次」を迷わず</h3>
            <p>今日の画面で、今・次・この後の予定と出発までの時間を確認。遅れや休業の時は、影響を比べて代わりの案を選べます。</p>
            <ul>
              <li>予約・チケット・QR・文書を旅行にまとめる(番号は必要な時だけ表示)</li>
              <li>旅程を端末に暗号化して保存し、オフラインでも閲覧</li>
              <li>通信できない間の変更は、戻った時に送る</li>
            </ul>
            <span className="lp-state">利用できます</span>
            <span className="lp-state lp-state--road">移動の時間は直線距離からの推定(経路の提供元は未接続)</span>
          </article>
          <article className="lp-feature">
            <span className="lp-index">03 — KEEP THE MOMENT</span>
            <h3>旅のあとも、地図に思い出が残る</h3>
            <p>写真・メモを日程と場所に重ねて記録。訪れた場所の地図や振り返りで、次の旅の計画にもつなげます。</p>
            <ul>
              <li>写真は撮影情報を取り除き、自分だけに保存</li>
              <li>訪問の地図・旅の地図・振り返り</li>
              <li>公開する前に、見せる範囲を確かめる</li>
            </ul>
            <span className="lp-state">利用できます</span>
            <span className="lp-state lp-state--road">位置の記録は画面を開いている間だけ</span>
          </article>
        </div>
        <ul className="lp-otherFeatures" aria-label="そのほかの機能">
          <li>旅程の共有と権限</li>
          <li>相談・投票・コメント</li>
          <li>予算・立替の精算</li>
          <li>持ち物・準備のチェック</li>
          <li>しおりの印刷</li>
          <li>カレンダー・地図への書き出し</li>
          <li>旅程の複製</li>
        </ul>
      </section>

      <section className="lp-section lp-truth" aria-labelledby="lp-truth-h">
        <div className="lp-sectionHead">
          <span className="lp-kicker">BUILT FOR THE REAL TRIP</span>
          <h2 id="lp-truth-h">旅に必要な情報を、旅程のそばへ。</h2>
          <p>確かめていない値を、確かな値のようには見せません。外部の提供元がつながっていない情報は「未照会」「未接続」と表示します。</p>
        </div>
        <div className="lp-truthGrid">
          <article className="lp-truthBox">
            <h3>いま使えるところ</h3>
            <p>旅行と日程の作成・編集、相談からの下書き、候補箱と投票、営業時間の照合(登録した営業時間)、予約・文書、当日の画面、オフライン、写真の記録。旅程の地図は OpenStreetMap を使います。</p>
            <ul className="lp-chips">
              <li>旅行・日程</li><li>相談・下書き</li><li>候補・投票</li><li>当日・オフライン</li><li>予約・文書</li><li>写真・訪問</li>
            </ul>
          </article>
          <article className="lp-truthBox">
            <h3>まだつながっていないところ</h3>
            <p>AI による読み取り、道路の実際の経路・運転時間・高速料金、宿の空室と料金、混み具合、天気や運行情報の自動の取得は、提供元とまだつながっていません。</p>
            <ul className="lp-chips">
              <li>未接続と表示</li><li>推定は推定と表示</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="lp-section lp-pricing" id="pricing" aria-labelledby="lp-pricing-h">
        <div className="lp-sectionHead">
          <span className="lp-kicker">CLEAR PLAN COMPARISON</span>
          <h2 id="lp-pricing-h">使える範囲を先に。料金は決定後に。</h2>
          <p>いまは料金なしで使えます。有料プランの内容・料金・支払いの方法は決まっていません。決まるまで、価格や使える量の約束は書きません。</p>
        </div>
        <div className="lp-priceWrap">
          <div className="lp-priceIntro">
            <div>
              <h3>プランを比べる</h3>
              <p>有料プランの料金・上限・購入の方法は準備中です。</p>
            </div>
            <span className="lp-note">料金・有料プランは準備中</span>
          </div>
          <table className="lp-priceTable">
            <caption className="sr-only">プランの比較(料金は準備中)</caption>
            <thead>
              <tr>
                <th scope="col">比較項目</th>
                <th scope="col">いま<span className="lp-pending">料金なし</span></th>
                <th scope="col" className="lp-pro">Plus / Family<span className="lp-pending">準備中</span></th>
              </tr>
            </thead>
            <tbody>
              <tr><th scope="row">旅程の作成・編集</th><td className="lp-ok">使えます</td><td className="lp-pro">内容を設計中</td></tr>
              <tr><th scope="row">共有・グループ</th><td className="lp-ok">使えます</td><td className="lp-pro">人数・権限を設計中</td></tr>
              <tr><th scope="row">AI・外部の検索の枠</th><td>旅行ごとの上限で守ります(外部の有料の提供元は未接続)</td><td className="lp-pro">追加の枠は未定</td></tr>
              <tr><th scope="row">オフライン・旅の記録</th><td className="lp-ok">使えます</td><td className="lp-pro">未定</td></tr>
            </tbody>
          </table>
          <p className="lp-pricingFoot">※ 料金・無料の範囲・上限・課金を始める条件・解約と返金の条件は、決まってから公開します。現在、購入できるプランはありません。</p>
        </div>
      </section>

      <section className="lp-final" id="start" aria-labelledby="lp-final-h">
        <span className="lp-kicker">MAKE ROOM FOR WONDER</span>
        <h2 id="lp-final-h">あなたの次の旅を、描きはじめよう。</h2>
        <p>{isAuthenticated ? 'ダッシュボードから、旅のつづきを。' : '登録なしで、このブラウザから始められます。アカウントはあとから作れます。'}</p>
        <div className="lp-finalActions">
          {isAuthenticated ? (
            <Link className="lp-btn lp-btn--main" to="/dashboard">ダッシュボードへ <span aria-hidden="true">↗</span></Link>
          ) : (
            <>
              <button type="button" className="lp-btn lp-btn--main" onClick={handleGuestStart} disabled={isLoading}>
                TravelCanvasを試す <span aria-hidden="true">↗</span>
              </button>
              <Link className="lp-btn lp-btn--line" to="/register">アカウントを作る</Link>
            </>
          )}
        </div>
      </section>
      <footer className="lp-footer">
        <span>TravelCanvas</span>
        <span>画像は AI で生成した旅の情景のイメージです · 機能の状態は提供中と未接続を分けて表示しています</span>
      </footer>
    </div>
  );
};

export default LandingPage;
