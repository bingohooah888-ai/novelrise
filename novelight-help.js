(() => {
  'use strict';

  if (window.NovelightHelp?.version) {
    window.NovelightHelp.install?.();
    return;
  }

  const HELP_PAGE = 'help.html';
  const VERSION = '1.0.0';

  const topics = Object.freeze({
    'getting-started': {
      title: 'はじめてのNOVELIGHT',
      summary: 'NOVELIGHTは、作品を評価する前の「発見される機会」を広げ、作者と読者が長く小説を続けられることを目指す小説投稿サービスです。',
      points: [
        '読者は無料で作品を読み、発見・お気に入り・コメントなどの機能を利用できます。',
        '作者向け有料プランは高評価やランキング順位そのものを購入する仕組みではなく、発見機会や分析機能を拡張します。',
        '独自機能のLIGHT SEEDとSCOUT RECORDでは、「新しい作品を見つけること」自体を楽しめます。'
      ]
    },
    'author-guide': {
      title: '作者向け機能ガイド',
      summary: '投稿から公開後の分析まで、現在の作者向け主要機能をまとめています。',
      points: [
        '作品投稿・作品編集：作品情報、公式サムネイル、AI利用区分、内容区分・内容警告を設定します。',
        'エピソード：下書き、自動保存、公開、予約公開、章設定、並び替え、一括移行を利用できます。',
        '作品づくり：作者ギャラリー、登場人物、プロット・キャラクター・世界観などの創作ノート、近況ノートを利用できます。',
        '公開後：LIGHT ANALYTICS、SCOUT RECORD、誤字報告管理、交流設定などから反応や運用状況を確認できます。',
        'サムネイルはNOVELIGHT公式素材を組み合わせる方式です。本文には対応形式の挿絵を追加できます。'
      ]
    },
    'reader-guide': {
      title: '読者向け機能ガイド',
      summary: '読む・探す・残す・発掘するための読者向け主要機能をまとめています。',
      points: [
        'お気に入り、コメント、作者フォロー、更新通知、読書履歴で読み続けたい作品を管理できます。',
        '自然文検索では「こんな作品が読みたい」という文章から候補を探せます。',
        'キュレーションリストでは、自分の選書を非公開または共有URLでまとめられます。',
        '本文読み上げ、LIGHT SEED、SCOUT RECORDで読書と発掘を続けやすくします。'
      ]
    },
    'light-seed': {
      title: 'LIGHT SEED',
      summary: 'LIGHT SEEDは「この作品を自分が発掘した」という読者の発掘記録です。作者への単純ないいねや点数評価とは役割が異なります。',
      points: [
        'GOLD / SILVER / BRONZEの3種類があり、作品を実際に読んだ記録など、送信条件を満たした場合に贈れます。',
        '同じ読者が同じ作品へ贈れるLIGHT SEEDは1回です。送信後の取消・種類変更・再取得はできません。',
        'LIGHT SEEDの送信・発掘実績はSCOUT RECORDの活動記録や成長要素と関係します。',
        '作者の知名度や人間関係ではなく、作品を見つけた読者の発掘体験を残すための仕組みです。'
      ]
    },
    'scout-record': {
      title: 'SCOUT RECORD',
      summary: 'SCOUT RECORDは、読む・発見する・評価する・LIGHT SEEDを贈るといった読者活動を、スカウトとしての成長記録にまとめる機能です。',
      points: [
        'XPは対象となる読書・発掘行動で得る成長経験値、LevelはXPによる成長段階、RankはLevel帯に応じたスカウト階級です。',
        'Scout Pointは対象行動・称号などで得るポイントです。用途や交換条件は画面上の現在仕様を確認してください。',
        '発掘成功は、早い段階で見つけた作品が後に成長したときに記録される発掘実績です。NOVA予見も作品の成長を見守る発掘体験に関係します。',
        'LIGHT SEEDはSCOUT RECORDの主要な発掘行動の1つです。',
        '健全な利用を保つため、XPなどには日次を含む一定の獲得制限があります。具体的な内部判定・上限計算は公開していません。'
      ]
    },
    analytics: {
      title: '有効読者・PV・読了',
      summary: '分析指標は「ページが開かれたこと」と「実際に読まれたこと」を同じものとして扱わず、用途に応じた計測結果を表示します。',
      points: [
        'PVはページ閲覧の指標です。作者本人・重複アクセス・不正とみなされるアクセスなどが、すべて無条件で加算されるわけではありません。',
        '有効読者は、単なる表示ではなく、サービス側で有効な読書行動として確認された読者を表すための考え方です。',
        '読了・読了率は、読書の進行や所定の読書記録を基準に扱います。単にページを開いた回数だけで読了とは扱いません。',
        '未ログインでも訪問・PV・流入など一部の行動を計測する場合があります。一方、アカウントに紐づく読書実績はログイン状態などで対象条件が異なります。',
        '不正対策に使う具体的な判定秒数、重複除外時間、上限値、内部スコア等は公開していません。'
      ]
    },
    'traffic-sources': {
      title: '外部流入・X流入',
      summary: 'NOVELIGHTは、取得できる範囲で「どこから作品へ来たか」と「最初にどのページへ入ったか」を読書導線の分析に利用します。',
      points: [
        'X / t.co / Twitter等からの参照やUTM情報を取得できる場合、外部流入として識別します。',
        '参照元を取得できないアクセスはdirectとして扱われる場合があります。',
        '作品TOPだけでなく、特定のエピソードへ直接入ったアクセスもランディング先として記録できる設計です。',
        '途中話への直接流入は「作品TOPから第1話へ進んだ読者」と同じ導線ではないため、流入元と読書継続を合わせて見るのが基本です。'
      ]
    },
    'access-measurement': {
      title: 'アクセス計測と不正対策',
      summary: '公平な分析・ランキング・発掘体験を守るため、NOVELIGHTはアクセスをそのまま無条件で全件加算する設計にはしていません。',
      points: [
        '未ログイン状態でも、サービス運営に必要な範囲で訪問・PV・流入等の読書行動を計測する場合があります。',
        '不自然なPV増加や重複アクセスなどを抑える仕組みがあります。',
        '作者本人のアクセス等には、指標の目的に応じた処理が行われる場合があります。',
        '攻略につながるため、具体的な判定秒数、重複除外時間、上限、内部スコア、BOT検出ロジック、ランキング不正検出の詳細は公開しません。'
      ]
    },
    ranking: {
      title: 'ランキング・作品発見',
      summary: 'ランキングは単純な知名度や課金額ではなく、NOVELIGHT上の有効な読者行動をもとに作品を紹介するための仕組みです。',
      points: [
        '有効読書やお気に入り等の読者行動を利用し、単純なPVだけで順位を決める設計にはしていません。',
        '不正アクセスや操作と判断される行動は、集計から除外・調整される場合があります。',
        'Free / Standard / Premiumの契約プランによる追加露出は、ランキング順位そのものを購入する仕組みではありません。',
        'NOVELIGHTが有料プランで支援するのは「評価」ではなく「発見される機会」です。',
        '正確な計算式、重み、不正検出条件は公開していません。'
      ]
    },
    plans: {
      title: '料金・プラン',
      summary: '作者向けプランは投稿枠・分析・発見支援の範囲が異なります。読者の読書利用は無料です。',
      points: [
        'Free：月額0円、投稿2作品まで。基本的な発見枠とLIGHT ANALYTICSを利用できます。',
        'Standard：通常月額980円、投稿10作品まで。作品別分析と、計測可能な追加露出を利用できます。',
        'Premium：通常月額1,980円、投稿30作品まで。Standardの内容に加えてPremium専用追加露出枠や新作48時間ブースト等があります。',
        'β期間中はStandardが0円、Premiumが月額480円です。正式版と異なるβ仕様は料金ページの「β版特別価格」を優先してください。',
        '追加露出は読者数・PV・高評価・ランキング順位・収益を保証しません。'
      ]
    },
    publishing: {
      title: '投稿・作品管理 / 公開設定',
      summary: 'エピソードは執筆中の保存、公開、予約公開を使い分けられます。',
      points: [
        '公開：現在の内容を読者が読める状態にします。',
        '下書き：公開前の内容を保存して、作品管理から後で編集できます。執筆画面では自動保存・下書き保存が使われる場合があります。',
        '予約公開：公開日時を指定し、その時刻までは予約状態で保持します。',
        '章設定・話の並び替え・予約公開管理は作品の管理画面から確認できます。',
        '一括移行で取り込んだエピソードは、確認できるようすべて下書きとして登録されます。'
      ]
    },
    'content-rating': {
      title: 'R15 / R18・内容区分',
      summary: 'NOVELIGHTでは現在、作品の描写内容に応じて「全年齢」「センシティブ15+」「18+（非性的な強表現）」を設定します。',
      points: [
        'センシティブ15+は、強い暴力・性的テーマへの言及・自傷など、全年齢向けとして注意が必要な内容をゾーニングするための区分です。',
        '18+（非性的な強表現）は、より強い残虐・流血・拷問等を対象とする区分です。露骨な性行為を許可する区分ではありません。',
        'センシティブ15+ / 18+を選ぶ場合、現在の投稿画面では1つ以上の内容警告が必要です。',
        '年齢区分を付けても、投稿ガイドラインで禁止されているコンテンツが許可されるわけではありません。',
        '内容注意が必要な作品は、読者が確認してから本文を表示する警告導線の対象になります。'
      ]
    },
    images: {
      title: '画像・サムネイル',
      summary: '作品サムネイルと本文挿絵は用途が異なります。現在の実装にある方法・制限に沿って利用してください。',
      points: [
        '作品サムネイルは、NOVELIGHT公式素材から背景・本・表紙・装飾を選び、3:4のサムネイルを作る方式です。',
        '本文挿絵はJPEG / PNG / WebPに対応し、1ファイル10MB以下・長辺4096px以下です。アップロード時に配信用へ自動最適化します。',
        '現在の本文挿絵は1エピソード最大10枚です。挿入したい本文位置にカーソルを置いて「挿絵を追加」から登録します。',
        '画像を利用する権利がある素材だけを使用し、年齢区分・内容警告・投稿ガイドラインにも従ってください。',
        '正常表示されない場合は、対応形式・容量・画像寸法、保存状態、挿入位置を確認してください。'
      ]
    },
    'reading-aloud': {
      title: '読み上げ',
      summary: '本文読み上げは、ブラウザの音声合成機能を使って、現在表示しているエピソード本文を音声で再生します。',
      points: [
        '「最初から再生」「一時停止」「再開」「停止」を利用でき、読み上げ速度は1.0〜3.0倍の範囲で調整できます。',
        '読み上げるのは現在のページに表示中の本文だけです。別の話へ移動・ページを離脱すると読み上げは停止します。',
        '読み上げ完了そのものを読了イベントとして送る実装にはしていません。通常の読書記録・有効読書の計測は別の仕組みで行われます。',
        'そのため、画面を動かさず読み上げだけを最後まで再生したことだけで、自動的に読了扱いになる仕様ではありません。',
        'ブラウザや端末が音声合成に対応していない場合は利用できません。'
      ]
    },
    'bulk-import': {
      title: '一括移行',
      summary: '既存の原稿をTXTまたは貼り付けから分割し、まとめてNOVELIGHTへ下書きとして取り込めます。',
      points: [
        '最大100話まで一括移行できます。',
        'TXTはUTF-8・5MB以下に対応し、Word / PDF / EPUBはβ版の一括移行対象外です。',
        '「第1話」「第一章」「Episode 1」「Chapter 1」等を自動認識し、必要なら任意の区切り文字も指定できます。',
        '外部サイトのURLから本文を自動取得する機能ではありません。投稿権利を持つ本文を貼り付けるかTXTから読み込んでください。',
        '移行前にタイトル・本文・順番・除外話を確認し、移行後も作品管理で内容を確認してください。'
      ]
    },
    'natural-search': {
      title: '自然言語検索・検索のコツ',
      summary: '自然文検索では、キーワードを並べる代わりに「どんな作品が読みたいか」を文章で入力できます。',
      points: [
        '例：「学園ものだけど恋愛要素が少ない作品」',
        '例：「主人公が強すぎない異世界ファンタジー」',
        'β版では公開作品のタイトル・あらすじ・ジャンル・公式タグ・自由タグから条件を読み取り、一致理由を表示します。',
        '自然文の関連度に作品Rankや課金プランを加点する仕組みではありません。'
      ]
    },
    'curation-lists': {
      title: 'キュレーションリスト',
      summary: '「この作品たちを一緒に読んでほしい」を自分の選書リストとしてまとめる読者機能です。',
      points: [
        'リスト名・説明を設定して作成し、作品ページの「＋ キュレーション」から作品を追加できます。',
        'β版の公開範囲は「非公開」または「共有URLで公開」です。公開ディレクトリはありません。',
        '共有URLは更新でき、古い共有URLを無効にできます。',
        'リストの人気・閲覧・作品追加は、作品Rank・露出・LIGHT SEED・SCOUT・おすすめに影響しません。'
      ]
    },
    'author-notes': {
      title: '近況ノート',
      summary: '作者プロフィールに載せる短いお知らせです。読者へ近況や作品に関する補足を伝えられます。',
      points: [
        '短いタイトルと本文を投稿し、必要なら公開中作品へのリンクを付けられます。',
        '公開したノートは作者プロフィールの補足欄として読者に表示されます。',
        '交流タイムラインや一斉通知として配信する機能ではありません。',
        '不要になったノートはアーカイブして公開プロフィールから外せます。'
      ]
    },
    account: {
      title: 'アカウント',
      summary: 'ログイン、プロフィール、表示設定などのアカウント関連項目はアカウント設定から確認できます。',
      points: [
        '作者名・自己紹介・アイコンなど、公開プロフィールに関係する設定は表示内容を確認して変更してください。',
        'ログイン状態が必要な機能では、未ログイン時にログイン画面へ案内されます。',
        '契約・課金の管理は料金ページまたは契約管理導線から行います。'
      ]
    },
    faq: {
      title: 'FAQ',
      summary: 'よくある疑問を短くまとめています。各機能の詳しい内容は該当カテゴリを確認してください。',
      points: [
        'Q. 有料プランならランキングが上がる？ → いいえ。追加露出とランキング順位そのものは別です。',
        'Q. LIGHT SEEDは「いいね」？ → いいえ。読者の発掘記録として扱う独自機能です。',
        'Q. 読み上げだけで読了になる？ → 読み上げ完了自体を読了イベントとして送る実装ではありません。',
        'Q. 不正対策の判定条件は見られる？ → 攻略防止のため、具体的な閾値や検出ロジックは公開していません。'
      ]
    }
  });

  const categories = Object.freeze([
    ['はじめてのNOVELIGHT', 'NOVELIGHTの考え方と基本的な使い方', 'getting-started'],
    ['作者向け機能', '投稿・管理・分析など作者向け機能の全体像', 'author-guide'],
    ['読者向け機能', '読む・探す・発掘するための主要機能', 'reader-guide'],
    ['LIGHT SEED', '作品を発掘した記録を残す独自機能', 'light-seed'],
    ['SCOUT RECORD', '読書・発掘活動の成長記録', 'scout-record'],
    ['有効読者・PV・読了', '分析指標の意味と数え方の考え方', 'analytics'],
    ['ランキング・作品発見', 'ランキングと発見機会の基本方針', 'ranking'],
    ['料金・プラン', 'Free / Standard / Premiumの違い', 'plans'],
    ['投稿・作品管理', '下書き・公開・予約公開・一括移行', 'publishing'],
    ['R15・R18', '内容区分・内容警告・禁止コンテンツとの違い', 'content-rating'],
    ['画像・サムネイル', '公式サムネイルと本文挿絵の仕様', 'images'],
    ['読み上げ', '再生方法と読書記録・読了判定の扱い', 'reading-aloud'],
    ['アカウント', 'プロフィール・ログイン・契約導線', 'account'],
    ['FAQ', 'よくある疑問をまとめて確認', 'faq']
  ]);

  function slug() {
    return (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/u, '').toLowerCase();
  }
  function topicHref(key) { return `${HELP_PAGE}#${encodeURIComponent(key)}`; }
  function ensureStyles() {
    if (document.querySelector('link[data-novelight-help-style]')) return;
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'novelight-help.css'; link.dataset.novelightHelpStyle = 'shared'; document.head.appendChild(link);
  }
  function infoButton(key, label = 'ⓘ', className = '') {
    const topic = topics[key]; if (!topic) return null;
    const button = document.createElement('button'); button.type = 'button'; button.className = `nl-help-info ${className}`.trim(); button.dataset.nlHelpTopic = key; button.setAttribute('aria-label', `${topic.title}の説明を開く`); button.title = topic.title; button.textContent = label;
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); openTopic(key); });
    return button;
  }
  function decorate(target, key) {
    if (!target || !topics[key] || target.querySelector?.(`[data-nl-help-topic="${key}"]`)) return false;
    target.classList.add('nl-help-decorated'); const button = infoButton(key); if (!button) return false; target.appendChild(button); return true;
  }
  function addTextHelp(target, key, label) {
    if (!target || !topics[key]) return false; const host = target.parentElement || target;
    if (host.querySelector?.(`[data-nl-help-text="${key}"]`)) return false;
    const button = infoButton(key, `${label} ⓘ`, 'nl-help-text'); if (!button) return false; button.dataset.nlHelpText = key; target.insertAdjacentElement('afterend', button); return true;
  }
  function createDialog() {
    let dialog = document.getElementById('novelightHelpDialog'); if (dialog) return dialog;
    dialog = document.createElement('dialog'); dialog.id = 'novelightHelpDialog'; dialog.className = 'nl-help-dialog';
    dialog.innerHTML = '<div class="nl-help-dialog-card"><div class="nl-help-dialog-head"><div><span class="nl-help-dialog-kicker">NOVELIGHT HELP</span><h2 data-nl-help-title></h2></div><button type="button" class="nl-help-close" aria-label="閉じる">×</button></div><p class="nl-help-summary" data-nl-help-summary></p><ul class="nl-help-points" data-nl-help-points></ul><div class="nl-help-dialog-actions"><a data-nl-help-detail>詳しく見る</a></div></div>';
    const closeDialog = () => { if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); };
    dialog.querySelector('.nl-help-close')?.addEventListener('click', closeDialog); dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(); }); document.body.appendChild(dialog); return dialog;
  }
  function openTopic(key) {
    const topic = topics[key]; if (!topic) return; const dialog = createDialog(); dialog.querySelector('[data-nl-help-title]').textContent = topic.title; dialog.querySelector('[data-nl-help-summary]').textContent = topic.summary;
    const list = dialog.querySelector('[data-nl-help-points]'); list.replaceChildren(); topic.points.slice(0, 3).forEach((text) => { const item = document.createElement('li'); item.textContent = text; list.appendChild(item); });
    const detail = dialog.querySelector('[data-nl-help-detail]'); detail.href = topicHref(key); detail.textContent = `${topic.title}について詳しく見る`; if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  }
  function globalLink(label = 'ヘルプ') { const link = document.createElement('a'); link.href = HELP_PAGE; link.textContent = label; link.dataset.nlHelpGlobal = 'true'; return link; }
  function installGlobalLinks() {
    document.querySelectorAll('footer').forEach((footer) => { const host = footer.querySelector('.footer-links') || footer.querySelector('.footer-inner') || footer; if (!host.querySelector('[data-nl-help-global]')) host.appendChild(globalLink()); });
    document.querySelectorAll('details.mobile-menu nav').forEach((nav) => { if (!nav.querySelector('[data-nl-help-global]')) nav.appendChild(globalLink()); });
    document.querySelectorAll('.studio-nav, .novelight-author-nav').forEach((nav) => { if (nav.querySelector('[data-nl-help-global]')) return; const link = globalLink('ヘルプ'); link.className = 'nl-help-nav-link'; const icon = document.createElement('span'); icon.className = nav.classList.contains('studio-nav') ? 'nav-icon' : 'novelight-author-nav-icon'; icon.textContent = '?'; link.prepend(icon); nav.appendChild(link); });
    const accountHeader = document.querySelector('.workspace-top'); if (accountHeader && !accountHeader.querySelector('[data-nl-help-account-link]')) { const link = globalLink('ヘルプ'); link.className = 'nl-help-account-link'; link.dataset.nlHelpAccountLink = 'true'; const logout = accountHeader.querySelector('.logout'); if (logout) accountHeader.insertBefore(link, logout); else accountHeader.appendChild(link); }
    const headerActions = document.querySelector('.header-actions'); if (headerActions && !headerActions.querySelector('[data-nl-help-desktop-link]')) { const link = globalLink('ヘルプ'); link.className = 'nl-help-desktop-link'; link.dataset.nlHelpDesktopLink = 'true'; const mobile = headerActions.querySelector('.mobile-menu'); if (mobile) headerActions.insertBefore(link, mobile); else headerActions.appendChild(link); }
  }
  function findLabel(root, text) {
    return Array.from(root?.querySelectorAll?.('.label, label, legend, h2, .scout-kicker, .seed-inventory-name, .scout-stat span') || []).find((node) => String(node.childNodes?.[0]?.textContent || node.textContent || '').trim().includes(text));
  }
  function installAnalytics() {
    const heading = document.getElementById('analyticsTitle') || document.querySelector('main h1'); addTextHelp(heading, 'analytics', '分析指標について'); const lead = heading?.closest('section')?.querySelector('.lead'); if (lead && !lead.parentElement.querySelector('[data-nl-help-text="traffic-sources"]')) addTextHelp(lead, 'traffic-sources', '外部流入・X流入について');
    document.querySelectorAll('.metric .label').forEach((label) => { if (/PV|インプレッション|作品ページ|第1話|第2話|読書|読了/u.test(label.textContent.trim())) decorate(label, 'analytics'); }); decorate(findLabel(document, '総PV'), 'analytics'); decorate(document.getElementById('basicAnalyticsHeading'), 'analytics');
  }
  function installNovel() { decorate(document.querySelector('#lightSeedArea h2'), 'light-seed'); decorate(document.querySelector('#receivedSeedArea h2'), 'light-seed'); }
  function installScoutRecord() {
    const oldHelp = document.getElementById('scoutHelp'); if (oldHelp) oldHelp.hidden = true; decorate(document.querySelector('.scout-page-head h1'), 'scout-record'); decorate(document.getElementById('seedInventoryTitle'), 'light-seed'); decorate(document.querySelector('.scout-rank-title'), 'scout-record'); decorate(document.querySelector('.scout-xp-meta span:first-child'), 'scout-record'); decorate(document.getElementById('xpNext'), 'scout-record'); decorate(document.querySelector('.scout-point-card .label'), 'scout-record'); document.querySelectorAll('.scout-stat span').forEach((label) => decorate(label, label.textContent.trim() === 'LIGHT SEED' ? 'light-seed' : 'scout-record'));
  }
  function installRanking() { addTextHelp(document.querySelector('main h1'), 'ranking', 'ランキングについて'); }
  function installPricing() { addTextHelp(document.querySelector('main h1'), 'plans', '各プランの違い'); }
  function installMypage() { addTextHelp(document.querySelector('.author-hero h1'), 'author-guide', '作者向け機能ガイド'); decorate(document.querySelector('.action-plan h2'), 'plans'); }
  function installPostSettings() { decorate(document.querySelector('label[for="contentRating"]'), 'content-rating'); const thumbnailLegend = Array.from(document.querySelectorAll('legend')).find((legend) => /作品サムネイル/u.test(legend.textContent)); decorate(thumbnailLegend, 'images'); }
  function installEpisodeEditor() {
    const illustration = document.getElementById('openIllustrationEditor'); if (illustration && !illustration.parentElement.querySelector('[data-nl-help-topic="images"]')) { const button = infoButton('images'); if (button) illustration.insertAdjacentElement('afterend', button); }
    decorate(document.querySelector('.episode-illustration-heading strong'), 'images'); decorate(document.querySelector('#schedulePane label[for="scheduleAt"]'), 'publishing'); const schedule = document.getElementById('openScheduleSettings'); if (schedule && !schedule.parentElement.querySelector('[data-nl-help-topic="publishing"]')) { const button = infoButton('publishing'); if (button) schedule.insertAdjacentElement('afterend', button); }
  }
  function installEpisodeReader() { decorate(document.querySelector('.reader-tts-title'), 'reading-aloud'); }
  function installBulkImport() { addTextHelp(document.querySelector('.hero h1, main h1'), 'bulk-import', '移行方法・対応形式'); }
  function installSearch() { addTextHelp(document.querySelector('main h1'), 'natural-search', '検索のコツ'); }
  function installCuration() { addTextHelp(document.querySelector('main h1'), 'curation-lists', 'リストとは？'); addTextHelp(document.querySelector('#createForm strong'), 'curation-lists', '作成・公開範囲'); }
  function installAuthorNotes() { addTextHelp(document.querySelector('.page-head h1, main h1'), 'author-notes', '近況ノートについて'); }
  function installReaderGuide() { const heading = document.querySelector('main h1, .page-head h1'); if (heading) addTextHelp(heading, 'reader-guide', '読者向け機能ガイド'); }
  function installPageHelp() {
    installGlobalLinks();
    switch (slug()) {
      case 'analytics': installAnalytics(); break; case 'novel': installNovel(); break; case 'scout-record': installScoutRecord(); break; case 'ranking': installRanking(); break; case 'pricing': installPricing(); break; case 'mypage': installMypage(); break;
      case 'post': case 'novel-edit': installPostSettings(); break; case 'episode-post': case 'episode-edit': case 'episode-schedule': installEpisodeEditor(); break; case 'episode': installEpisodeReader(); break; case 'bulk-import': installBulkImport(); break; case 'search': installSearch(); break; case 'curation-lists': installCuration(); break; case 'author-notes': installAuthorNotes(); break;
      case 'favorites': case 'reading-history': case 'history': case 'account-settings': installReaderGuide(); break; default: break;
    }
  }
  function renderHelpCenter() {
    const root = document.getElementById('novelightHelpCenter'); if (!root || root.dataset.rendered === 'true') return; root.dataset.rendered = 'true';
    const grid = document.createElement('section'); grid.className = 'nl-help-category-grid'; grid.setAttribute('aria-label', 'ヘルプカテゴリ'); categories.forEach(([title, description, key]) => { const link = document.createElement('a'); link.className = 'nl-help-category-card'; link.href = `#${key}`; link.innerHTML = '<strong></strong><span></span><b aria-hidden="true">→</b>'; link.querySelector('strong').textContent = title; link.querySelector('span').textContent = description; grid.appendChild(link); });
    const extra = document.createElement('section'); extra.className = 'nl-help-extra-links'; extra.innerHTML = '<h2>さらに確認する</h2>'; [['アクセス計測と不正対策','access-measurement'],['外部流入・X流入','traffic-sources'],['一括移行','bulk-import'],['自然言語検索','natural-search'],['キュレーションリスト','curation-lists'],['近況ノート','author-notes']].forEach(([label,key]) => { const link = document.createElement('a'); link.href = `#${key}`; link.textContent = label; extra.appendChild(link); });
    const detail = document.createElement('section'); detail.id = 'novelightHelpDetail'; detail.className = 'nl-help-detail'; detail.hidden = true; root.append(grid, extra, detail);
    const renderDetail = () => { const key = decodeURIComponent(location.hash.replace(/^#/u, '')); const topic = topics[key]; if (!topic) { detail.hidden = true; return; } detail.hidden = false; detail.replaceChildren(); const kicker = document.createElement('div'); kicker.className = 'nl-help-detail-kicker'; kicker.textContent = 'NOVELIGHT HELP'; const title = document.createElement('h2'); title.textContent = topic.title; const summary = document.createElement('p'); summary.className = 'nl-help-detail-summary'; summary.textContent = topic.summary; const list = document.createElement('ul'); topic.points.forEach((point) => { const item = document.createElement('li'); item.textContent = point; list.appendChild(item); }); const back = document.createElement('a'); back.className = 'nl-help-detail-back'; back.href = '#top'; back.textContent = 'ヘルプTOPへ戻る'; detail.append(kicker, title, summary, list, back); requestAnimationFrame(() => detail.scrollIntoView({ block: 'start' })); };
    window.addEventListener('hashchange', renderDetail); renderDetail();
  }
  let observer = null, scheduled = false;
  function scheduleInstall() { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; installPageHelp(); renderHelpCenter(); }); }
  function install() {
    ensureStyles(); if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleInstall, { once: true }); else scheduleInstall();
    if (!observer && typeof MutationObserver === 'function') { observer = new MutationObserver(scheduleInstall); const startObserver = () => { if (document.body) observer.observe(document.body, { childList: true, subtree: true }); }; if (document.body) startObserver(); else document.addEventListener('DOMContentLoaded', startObserver, { once: true }); }
  }
  window.NovelightHelp = Object.freeze({ version: VERSION, topics, categories, open: openTopic, install }); install();
})();
