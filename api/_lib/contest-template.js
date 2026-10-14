export const contestPageTemplate = String.raw`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="NOVELIGHT 第1回 星灯祭（小説コンテスト）。2026年11月1日から30日まで開催。読書ポイント1pt以上の上位5位以内に各1万円、最終順位は12月1日発表。">
  <title>NOVELIGHT 第1回 星灯祭 | 2026年11月</title>
  <link rel="stylesheet" href="novelight-theme.css" data-novelight-theme="sitewide">
  <link rel="stylesheet" href="novelight-accessibility.css">
  <link rel="stylesheet" href="novelight-contest.css">
</head>
<body class="novelight-theme novelight-page-contest">
  <a href="#main-content" class="skip-link">本文へスキップ</a>
  <header class="contest-site-header">
    <div class="contest-header-inner">
      <a class="contest-brand" href="index.html" aria-label="NOVELIGHT ホーム">
        <img src="assets/novelight-header-logo.webp" alt="NOVELIGHT">
      </a>
      <nav class="contest-header-nav" aria-label="ページメニュー">
        <a href="#entries">参加作品</a>
        <a href="#rules">参加方法</a>
        <a href="my-novels.html">自分の作品</a>
      </nav>
    </div>
  </header>

  <main id="main-content" tabindex="-1">
    <section class="contest-hero">
      <div class="contest-hero-light" aria-hidden="true"></div>
      <div class="contest-hero-inner">
        <span class="contest-eyebrow">第1回 星灯祭 / 2026年11月</span>
        <span class="contest-status" id="contestStatus">開催準備中</span>
        <h1>まだ知られていない物語に、<em>光を。</em></h1>
        <p class="contest-hero-lead">NOVELIGHT 第1回 星灯祭。読者に届き、続きを読みたいと思わせた物語が、上位を目指せる30日間。</p>
        <div class="contest-hero-actions">
          <a class="contest-button contest-button-primary" href="#enter">作品をエントリーする</a>
          <a class="contest-button contest-button-secondary" href="#entries">参加作品を読む</a>
        </div>
        <div class="contest-hero-dates">
          <span><strong>応募締切</strong><time datetime="2026-10-31T23:59:59+09:00">10月31日（土）23:59</time></span>
          <span><strong>開催期間</strong><time datetime="2026-11-01T00:00:00+09:00">11月1日（日）〜30日（月）</time></span>
        </div>
      </div>
    </section>

    <section class="contest-prize-section" aria-labelledby="prizeTitle">
      <div class="contest-shell contest-prize-layout">
        <div>
          <p class="contest-kicker">AWARDS</p>
          <h2 id="prizeTitle">1pt以上の上位5作品に、<span>それぞれ1万円。</span></h2>
          <p>有効得点1pt以上が受賞条件です。対象作品が5作品未満なら受賞数も減ります。5位境界の同点作品は同順位としてすべて受賞できます。</p>
        </div>
        <div class="contest-prize-visual">
          <small>AWARD PER WINNING WORK</small>
          <strong>¥10,000</strong>
          <span>得点1pt以上の入賞作品に</span>
        </div>
      </div>
    </section>

    <section class="contest-shell contest-section" id="rules" aria-labelledby="rulesTitle">
      <p class="contest-kicker">HOW TO WIN</p>
      <h2 id="rulesTitle">読まれた深さが、ポイントになる。</h2>
      <p class="contest-section-copy">同じ読者が1作品で読了した<strong>異なるエピソード数</strong>に応じて得点が変わります。途中の段階を足し算せず、最も高い到達段階のポイントだけを採用します。</p>
      <div class="contest-points-grid">
        <article class="contest-points-card">
          <span class="contest-points-level">STEP 01</span>
          <h3>3話以上</h3>
          <strong>1<span>pt</span></strong>
          <p>まず物語に触れてもらう。</p>
        </article>
        <article class="contest-points-card">
          <span class="contest-points-level">STEP 02</span>
          <h3>5話以上</h3>
          <strong>3<span>pt</span></strong>
          <p>続きが気になる物語に。</p>
        </article>
        <article class="contest-points-card">
          <span class="contest-points-level">STEP 03</span>
          <h3>10話以上</h3>
          <strong>5<span>pt</span></strong>
          <p>夢中になれる物語を見つける。</p>
        </article>
      </div>
      <p class="contest-note">ログインしていない読者も対象です。1読者・1作品あたり最大5pt。同じ話の読み直しは加算されません。実際の読書実績に基づいて判定し、不正が疑われる記録は審査対象になります。</p>
    </section>

    <section class="contest-section contest-enroll-section" id="enter" aria-labelledby="enterTitle">
      <div class="contest-shell contest-enroll-inner">
        <div class="contest-section-heading">
          <div>
            <p class="contest-kicker">FOR AUTHORS</p>
            <h2 id="enterTitle">あなたの物語を、届けよう。</h2>
            <p class="contest-section-copy">応募できるのは<strong>公開済み10話以上の全年齢・R15作品</strong>（人間執筆またはAI補助）。R18・AI生成主体の作品は対象外です。作者1人1作品、既存作品も参加できます。</p>
          </div>
          <a href="my-novels.html" class="contest-text-link">自分の作品ページから応募 →</a>
        </div>
        <div class="contest-enroll-panel">
          <div class="contest-panel-title">
            <h3>エントリー作品を選択</h3>
            <span id="entryPhaseNote">受付状況を確認しています…</span>
          </div>
          <div id="contestLoginPrompt" class="contest-login-prompt" hidden>
            <p>作品をエントリーするには、作者アカウントでログインしてください。</p>
            <a class="contest-button contest-button-primary" href="login.html?redirect=contest.html">ログインしてエントリー</a>
            <a class="contest-text-link" href="signup.html">新規会員登録</a>
          </div>
          <div id="contestEnrollment" class="contest-enroll-works" aria-live="polite"></div>
          <p class="contest-note">コンテスト終了まで公開10話以上を維持してください。締切後の作品変更・取消はできません。応募時には正式な応募要項への同意が必要です。</p>
        </div>
      </div>
    </section>

    <section class="contest-shell contest-section" id="entries" aria-labelledby="entriesTitle">
      <div class="contest-section-heading">
        <div>
          <p class="contest-kicker">ENTRIES</p>
          <h2 id="entriesTitle">参加作品を読む</h2>
          <p class="contest-section-copy">知名度に関係なく、気になる物語の最初の1話から。</p>
        </div>
        <p id="entryCount" class="contest-entry-count" aria-live="polite"></p>
      </div>
      <label class="contest-r15-toggle" for="contestHideR15">
        <input id="contestHideR15" type="checkbox">
        <span>R15作品を表示しない</span>
      </label>
      <p class="contest-note">この設定は通常の作品一覧と共通です。R18・AI生成主体の作品は今回のコンテスト応募対象外です。</p>
      <div id="contestEntries" class="contest-entries-grid" aria-live="polite">
        <p class="contest-list-message">参加作品を読み込んでいます…</p>
      </div>
      <div class="contest-list-bottom">
        <button type="button" id="contestMoreButton" class="contest-button contest-button-secondary" hidden>もっと作品を見る</button>
      </div>
    </section>

    <section class="contest-shell contest-section" id="contestRankingSection" aria-labelledby="contestRankingTitle" hidden>
      <div class="contest-section-heading">
        <div><p class="contest-kicker">INTERIM RANKINGS</p>
          <h2 id="contestRankingTitle">中間ランキング TOP 10</h2>
          <p class="contest-section-copy" id="contestRankingDate"></p>
        </div>
      </div>
      <p class="contest-note">発表時点で順位・得点を固定した暫定ランキングです。受賞は独立審査後に確定します。同点は同順位。R15非表示設定は参加作品一覧と共通です。</p>
      <ol id="contestRankingList" class="contest-ranking-list" aria-live="polite"></ol>
    </section>

    <section class="contest-timeline">
      <div class="contest-shell">
        <p class="contest-kicker">RANKING SCHEDULE</p>
        <h2>順位は3回の中間発表で更新。</h2>
        <div class="contest-timeline-grid">
          <div><small>第1回</small><strong>11月7日</strong><span>正午12:00 公開</span></div>
          <div><small>第2回</small><strong>11月15日</strong><span>正午12:00 更新</span></div>
          <div><small>第3回</small><strong>11月22日</strong><span>正午12:00 更新</span></div>
          <div><small>最終順位発表</small><strong>12月1日</strong><span>11月30日終了・審査後に発表</span></div>
        </div>
        <p class="contest-note">中間ランキングは11月7日から11月30日まで表示を継続します。発表回ごとの順位・得点を次回更新まで固定します。表示機能は開催準備の後続工程で公開します。</p>
      </div>
    </section>

    <section class="contest-shell contest-footnote">
      <p>参加・読書は無料です。受賞連絡はNOVELIGHT登録メールに送信し、受賞者は通知から1か月以内に返信してください。賞金は返信受信から1か月以内に楽天銀行から国内銀行口座へ振り込み、手数料は運営が負担します。ご参加には公式応募要項への明示同意が必要です。<a href="/contest-terms">正式応募要項</a>、<a href="terms.html">利用規約</a>と<a href="content-guidelines.html">投稿ガイドライン</a>もご確認ください。</p>
    </section>
  </main>

  <footer class="contest-footer">
    <a href="index.html">NOVELIGHT</a>
    <span>すべての物語に、光を。</span>
    <a href="contact.html">お問い合わせ</a>
  </footer>
  <script src="/assets/vendor/supabase-js-2.112.3.js"></script>
  <script src="novelight-client.js"></script>
  <script src="novelight-contest-entry.js"></script>
  <script src="novelight-contest-page.js"></script>
</body>
</html>
`;
