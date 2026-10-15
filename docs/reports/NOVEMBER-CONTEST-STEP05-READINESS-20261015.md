# NOVELIGHT 第1回 星灯祭 — 受付開始前の最新確認表（2026-10-15）

> **運営専用・公開禁止・応募要項の正式採択ではない。** 出所：最新main `ae9ff5ae62f0fbd1da92ee6b34b56d1724c0dfba`、正本 Issue #2120、既決定R1〜R11、実証済みPR #2252/#2254とProduction Approval Ledger #2139。過去履歴と矛盾する場合は現行DBのread-only観測と最新Owner決定を優先する。

## 0. 2026-10-15 引継ぎ後の差分監査（下の旧スナップショットより優先）

**証拠と未確認事項を分ける。** この追補は運営文書の訂正であり、公式応募要項の採択、Production変更、応募受付開始ではない。

- **GitHub現行main（確認時）**: `c9dc98d6db487028b29e88c876d4e30fd1971c0a`。PR #2256（運営資料改訂、merge `fd7b0fa905183bd3395654be874a8a7ecea7463d`）、PR #2257（単一SQL文への安全化、merge `c9dc98d6db487028b29e88c876d4e30fd1971c0a`）ともにmerge済み。後続の運用では**必ずその時点のmainを再確認**。
- **GitHubから見たVercel**: 上記コミットに対する `Vercel` commit status は `success`。ただし**Vercel Production deploymentのrevision/aliasまでを独立して実測したことにはならない**。開放前の必須read-only postcheckとして残す。CodeQL/Node/Static quality/RLS integrationの現コミットchecksはsuccess。
- **2026-10-15 Production SupabaseのSELECT再確認**: `status=draft`, `public_visible=false`, `terms_version=''`, `terms_url=''`, 応募0、読了イベント0。Migration `20261015120000`は履歴に存在し、**再適用禁止**。本確認では変更を行っていない。
- **PR #2257により修正済み**: 現在の `scripts/november-contest-registration-open-plan.mjs` は、トップレベル複数SQL文ではなく**単一 `DO $novelight_stage05_open$ ... $novelight_stage05_open$;`** を生成する。UPDATEと監査INSERTは同一PostgreSQL文の中で処理され、使い捨てPostgreSQLテストは成功。旧 `BEGIN; SET LOCAL; DO; COMMIT;` 前提を採用しない。
- **未実証の技術ゲート**: GitHub Actionsの `SUPABASE_ACCESS_TOKEN` がSupabase Management APIの `database:read` / `database:write` に**実際に認可されるか**、read-only APIのHTTP応答本文が `Array<Row>` 形式か、Production APIが単一DO文を受理するかは未確認。接続済みSupabaseコネクタでのSELECT成功は**GitHub Actionsの別トークンの権限確認にはならない**。本番DO文やダミーUPDATEによる「試し書き」は禁止。
- **未実証の法務・運用ゲート**: 景品表示法・居住者/非居住者の税務区分、本人確認/銀行情報、返信不達時の処理、個人情報の保存/削除などは専門的確認と運営SOPが必要。応募要項版 `november-2026-v1` とURL `https://novelight.jp/contest-terms` は候補であり未採択。
- **安全な次手順**: (1) mainとVercel Production revisionをread-only照合、(2) 正規の秘密情報保護された経路でManagement APIのread-only SELECTと**HTTPステータス/レスポンス形**のみを検査（トークン/口座情報をログ表示しない）、(3) write権限・DO実行可能性は未証明と記録し、本番への試験書き込みはしない、(4) 法務/税務・規約内容を独立決裁、(5) **別個の「受付開始承認」**後にのみ正規の一回限りのreleaseを実行し、曖昧な応答では自動再試行をしない。
- **NLO**: Issue #1837 の直近 `nlo_health` 要求 `cmdr-20261015T0605Z-conteststep05-health` は確認時点で返答未着。重複health要求は出さず、NLOとDCの状態を混同しない。

## 1. 実装済み・再実行しない

| 項目 | 実測根拠／状態 |
| --- | --- |
| 大会名称 | **NOVELIGHT 第1回 星灯祭**。シリーズ名「星灯祭」は将来の回でも固定。2026年11月開催。 |
| コードと本番 | main `ae9ff5ae62f0fbd1da92ee6b34b56d1724c0dfba`。Vercel Production / readiness smoke / beta verification 成功。 |
| 本文二軸得点 | migration `20261015120000` は正規workflow #38670897955で本番適用・postcheck成功。通常有効読書判定＋1話200文字未満除外、3話/1500字=1pt、5話/3000字=3pt、10話/6000字=5pt。最高段階のみ、再読重複除外、サーバー本文文字数スナップショット。 |
| 本番判定テスト | `points(3,1499)=0`、`points(3,1500)=1`、`points(5,3000)=3`、`points(10,5999)=3`、`points(10,6000)=5` を本番SQLで実測済み。 |
| 本文計測の状況 | 公開済み973話、正規表現のHTMLタグ風文字列検出0件、本文空欄0件（2026-10-15、集計のみ。将来のアップロード・書式変更を無条件に保証しない）。 |
| 非公開ゲート | `draft` / `public_visible=false` / `terms_version=''` / `terms_url=''`、応募・読了イベント0件。2026-10-15にSELECTで再確認。 |
| 日程 | 作品応募締切2026-10-31 23:59:59 JST、読書競技2026-11-01 00:00〜11-30 23:59:59 JST。 |
| 運営メール | `support@novelight.jp` 送信・受信・運営による返信の内部往復実証済み。再送不要。Resend受信Webhook 0件、返信通知自動化の成功は未証明。 |

## 2. 公表前に独立確認が必要な論点

| 区分 | 公式資料から確実に言えること | この企画で未確認のこと／運営アクション |
| --- | --- | --- |
| **景品表示法** | 消費者庁Q15/Q16は、無料会員登録や有料会員が応募者に含まれる**という事情だけ**では直ちに取引付随の景品にならない例を説明。ただし購入誘引や「有料会員が当選しやすいと思わせる告知」があると扱いが変わる。 | NOVELIGHTの有料露出・作者課金・広告文・受賞選出過程を合わせた実態判断。取引付随性を弁護士等に確認し、**適法なオープン懸賞と断定しない**。広告から「有料作者は有利」「課金で上位獲得」を連想させない。 |
| **居住者への賞金** | 国税庁No.2792/2795では、居住者の「懸賞応募作品等の入選賞金」に分類される場合、**1人1回5万円以下は源泉徴収をしなくてもよい**と案内。 | この第1回 星灯祭の法的・税務上の報酬区分、受賞者の税務申告、運営の支払記録。**1万円だから必ず非課税／申告不要とは言わない**。 |
| **非居住者への賞金** | 国税庁No.2884/2885では非居住者への国内源泉所得支払について区分別税率・租税条約の扱いが別に示される。 | 国内銀行口座があるだけで居住者とは扱えない。税務上の居住地、国内源泉性、源泉徴収義務、必要な届出を個別判断し、振込前に専門家確認。受賞資格・既定賞金額は勝手に変更しない。 |
| **受賞者との連絡** | 運営内部の送受信往復1回成功。ただしResendのWebhookによる自動受信通知は構成されていない。 | 受賞通知送信後から返信処理完了まで**少なくとも毎日1回**`support@novelight.jp`受信確認し、登録メール照合・受信日記録・送金担当と期限を管理する。生の口座番号はチャット、公開ページ、Issue、通常の読書DBへ記載しない。 |
| **振込・個人情報** | OWNER決定：上位5位/5位境界の同点全員に各1万円、通知から1か月以内の返信、運営が返信受信後1か月以内に楽天銀行から国内口座へ振込、手数料運営負担。返金・振込失敗時は再確認、正常着金の二重払なし。 | 本人確認・口座名義照合、誤送信防止、保管アクセス権、法定保存例外と削除・匿名化、国外受賞者、通知不達と1か月超の返信の事務処理。これらは専門確認／運営SOPを優先し、**自動失格・次点繰上げは追加しない**。 |
| **審査と苦情** | 200字未満除外、重複排除、文字数水増し・無意味な大量投稿・不正への審査とポイント取消/資格取消、異議申立に期限なしはオーナー決定。 | 11/30時点の公開10話維持の証拠保存、12/1結果公表までの不正レビュー担当、結果訂正の明示手順と再審査記録の確認。過去の「異議7日」を復活させない。 |

## 3. 誤解しないで使う資料

- 応募要項候補表示：`api/_lib/contest-terms-template.js`。草案：`docs/reports/NOVEMBER-CONTEST-STEP05-PUBLIC-TERMS-DRAFT.md`。
- 応募要項の**候補**版 `november-2026-v1`、**候補**URL `https://novelight.jp/contest-terms` は採択・施行されていない。Production DBでは両方とも空欄。
- 告知・FAQ・受賞通知の最新版は `NOVEMBER-CONTEST-STEP05-REGISTRATION-RUNBOOK.md` の**2026-10-15の最上段スナップショットと改訂済み公開文案**を使う。歴史節の旧「第1回小説コンテスト」「話数だけ」を転載しない。
- 受付開始のGitHub approval workflowはowner-authored terms採択、別個の登録開始承認、exact mainとchallenge、単発DBトランザクションを要求する。**単一DO文への移行と隔離PostgreSQLの原子性は検証済み。ただしGitHub Actionsの本番Management API認可、read-only応答本文の形、実APIでのDO文受理は未実測**。過去のSupabase CLI migration成功はこの証拠にならない。

## 4. 残る停止ゲート（順序を守る）

1. 弁護士・税理士等と確認すべき税務・景品表示法・未成年・個人情報・銀行実務の事実と書面記録を揃える。自動合法判定をしない。
2. オーナーが**最新の正式応募要項本文、版 `november-2026-v1`、URL、発効日を明示的に採択**。これだけでは非公開状態のまま。
3. Supabase Management APIの本番トークン権限・read-onlyレスポンス形を安全な読み取り専用経路で検証する。単一DOの隔離DB原子性確認は再実行せず、ProductionのDO実行可能性は別途承認まで未実証と記録する。必要なトークンを露出しない。新たな従量課金ステージングは「ステージング承認」なしでは使わない。
4. 別途オーナーの**「受付開始承認」**があって初めて、正規の単発release workflowで`registration/public_visible=true`にする。公開直後の実HTTP/応募/取消/ゾーニング/規約同意の検証を行う。
5. 11/1の競技本番稼働・中間ランキング・12/1最終発表は、それぞれ日程・審査・権限・証拠に従い別途安全確認する。期限の到来だけで起動しない。

## 5. 一次資料

- 消費者庁「景品類とは」Q15/Q16：https://www.caa.go.jp/policies/policy/representation/fair_labeling/faq/premium/introduction
- 消費者庁「景品規制の概要」：https://www.caa.go.jp/policies/policy/representation/fair_labeling/premium_regulation
- 国税庁 No.2792：https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2792.htm
- 国税庁 No.2795：https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2795.htm
- 国税庁 No.2884：https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2884.htm
- 国税庁 No.2885：https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2885.htm

この監査書は**現時点の読み取り実測と一般的な公的資料の整理**であり、星灯祭に固有の法律・税務評価を確定するものではない。
