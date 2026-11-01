# NOVELIGHT AI 02-07-05｜実モデル品質・原価試験の事前監査と実行計画

状態：**設計・Staging読取監査・無課金Nodeテストのみ**（2026-11-01 JST）。本書はAI接続・支出・書込み・公開を承認しない。

## 1. 正本・検証対象

- 対象GitHub main：`ecc572327af35f2b435ca5a3e5f794e648cff0ac`。MASTER第47章、`AGENTS.md`、`docs/WORK-EXECUTION-PREFLIGHT.md` の別承認原則を守る。
- 02-07-04の成功：Actions [#41263146000](https://github.com/bingohooah888-ai/novelrise/actions/runs/41263146000)、SHA `c59b0038e06816ace42cdf2e50e24a2c02fb5927`、Preview `dpl_EQij5nLkYSiha2Yn4UyGYs9pszwu`、1試行成功。採用HTTP応答、採用候補のDB永続化、保留0件、ランナーJWT、有効な一覧、最後に `FINAL_CENSUS_PASS` を記録。
- **証明できていないもの**：実モデル応答の品質、外部AIへの送信と課金、実請求照合、実作品の権利/同意、Productionでの動作、一般公開。

## 2. Staging読み取り専用事前監査

対象Supabase project：`wmlzjgvxgoyrovdhbqbg`（Productionは `fiepaguycecrredwrcwx`）。対象を固定して `list_tables`、`list_migrations`、`SELECT` のみ実行。DDL、DML、JWT認証、外部AI送信なし。

| 検査 | 2026-11-01観測 |
| --- | --- |
| `novelight_ai_runtime_settings` | 1行。singleton=1、enabled=false、個人/全体の日次・月次 cap は全て0 |
| `novelight_ai_usage_requests` と `novelight_ai_usage_audit` | 各0件 |
| `novelight_ai_bible_facts`、`novelight_ai_episode_analysis`、`novelight_ai_review_candidates` | 各0件 |
| `novelight_ai_external_processing_consents` と `novelight_ai_external_consent_action_audit` | 各0件 |
| schema | AI runtime / review / external consent 関連テーブルの存在を確認 |
| 前回Preview | `dpl_EQij5nLkYSiha2Yn4UyGYs9pszwu` READY、SHA `c59b0038...`（**現行mainと不一致**） |
| Stagingブランチ限定Vercel設定 | `NOVELIGHT_AI_ENABLED=false`、レビュー用フラグ true。実モデル起動の必要条件は満たさない |

この一時点の0件・予算0円は**実行時の証明に流用できない**。将来の試行直前と後の再検査が必須。Production DBの設定をこのStaging監査から推定しない。

## 3. コードと受け入れ不足

- `api/_lib/ai/owner-novel-bible-trial-live.js` の全8フラグ・対象作品/話/チャンク・プロバイダー同意・期限・保守的な見積もりゲートは実装済み。コードの絶対上限は **50,000,000 micro-JPY（50円）/リクエスト**、期間上限は24時間。**50円は支出許可ではない**。
- `api/_lib/ai/price-quote.js` は確認済みモデル価格（USD/百万tokens）と保守的な為替・バッファを**呼び出し側から受け取る**。現時点で実モデル・料金表・契約上の保存条件は未選定/未検証。テスト用の料金例を本番の実価格として流用しない。
- `api/_lib/ai/router.js` は最大2つのプロバイダー呼び出しに備え、失敗・タイムアウトでも最悪費用を予約・精算する。現実の事業者請求額の正確性やアカウント全体の支出停止は未実証。
- `api/_lib/ai/novel-bible-inference-review.js` は根拠文字列・出力スキーマ・同一話ハッシュを検証するが、**引用が存在するだけでは要約の意味的正しさまで証明しない**。人間による品質判定が必要。
- 同意情報が読めなくなった場合、作者が変わった場合、話が改稿された場合は安全側で中止する。実モデル試用では各境界の失敗・再試行と監査を独立して確認する。

## 4. 初回実モデル試験の提案条件（全項目別承認）

以下は**設計案**。今回のPRではONにしない。

| 項目 | 初回の提案 |
| --- | --- |
| 環境 | 新しい**承認済みStaging専用Preview**のみ。current main exact SHA、Staging Supabase project refを照合 |
| 対象 | 本人管理・利用許諾済みの**合成の非機微原稿**、1作品・1話・chunk=0だけ。実会員・実作品・R18原稿の使用は禁止 |
| AI | 明示的に選んだ**1プロバイダー・1モデルのみ**、fallbackなし |
| 上限 | **1リクエスト10円＝10,000,000 micro-JPY** 以下を提案。同一試行の個人/全体・日次/月次DB上限も各10円以下とし、1回の合成試行だけを認める。上限に満たない検証済み見積もりを使用してよい |
| 期限 | 起動時から最大**1時間**。サーバー設定、承認ledger、実際のトリガーで1回限りに拘束 |
| 見積り | 公式モデル料金、token数、為替の切り上げ、十分なリスクバッファを確認。Routerの36,000 UTF-8 byte上限・最大出力token・再請求リスクを見込み、事前予約額が10円を超える場合は中止 |
| 支出警戒 | DBは10円超の予約を拒否。事業者側でも当該試行の支出上限・警告を別途確認。**DBの予約上限と実請求の完全一致は保証できない**ため、監視できない場合は試行不可 |
| 保持・法務 | 試行用原稿について処理事業者、保存期間、学習利用、移転、著作権/利用許諾の情報を確認。受諾済みの現行ポリシーrevisionと送信先が一致すること |
| 証拠 | HTTPステータスと安全な結果分類、候補0〜12件、根拠検証、人間未承認の自動確定0件、予約/精算/監査の件数と上限、権限拒否、結果の私的表示を秘密値なしで確認 |
| 後片付け | 起動フラグOFF、DB予算0円、合成ユーザー/作品/候補/同意/費用履歴の最終残留0件を独立監査。失敗でもcleanupを必須とする |

**1回の予算承認では複数回の試行を許可しない**。リクエスト上限だけでは繰り返し実行を完全には防げないため、OWNER認証済みの一回限りapproval ledgerと実行封じ込めを別に要求する。認証/同意/出力のため実JWTを使う場合も、専用の1回限り承認が必要。

## 5. 品質試験の評価方法

最初にNodeの無課金合成フィクスチャで、肯定例・引用捏造・意味的誤解を含む引用・日本語改行/Unicode・改稿・キャンセル・二重採用・セッション/所有者変更・予算0円・fallbackによる請求を試す。

実モデルを別途承認した後、**初回の合成1件は配線・支出・権限制御のスモークテスト**と位置づける。これだけで品質合格とはしない。出力は機械検証に加えて作者役が根拠・要約の一致を採点し、根拠を捏造した候補は0件、未承認の自動確定は0件、外部送信先は承認した1社のみを受け入れ条件とする。

複数文章での品質・原価比較、現実の長編負荷、意味的な幻覚率の評価は**新たな費用・送信・サンプル承認が必要な第2段階**とする。

## 6. 次工程のブロッカーと優先順位

1. **P0：実行時境界を再固定**。新mainのPreviewを別のステージング承認で作り、project ref・オーナーUID・環境変数スコープ・DB RLS/migration・緊急停止/cleanupを再照合する。旧PreviewのPASSを新mainの実証とみなさない。
2. **P0：プロバイダー/料金/法務**。実際のモデル名と公式料金・取扱条件・提供地域を確認し、同意画面とポリシー版を承認する。事業者側支出管理、キーの漏洩防止、R18禁止を確認する。
3. **P0：有料試行の独立承認**。合成原稿、正確な対象SHA/Preview、1回のJWT実行、上限10円、1時間、対象作者/作品/話、取り消し・削除・監査計画を明示した承認を取得する。現在の予算0円/AI OFFは変更禁止のまま。
4. **P1：一回限りの合成有料試行**。作成→同意→候補生成→検証→保存→本人確認→clean-up→最終0件を追跡。品質・実請求を分離して報告。
5. **P2：品質拡張**。長編・複数文章・費用対効果を比較する計画と新たな承認を策定。一般公開・Production管理人試用は別件。

## 7. このPRで許されること・禁止事項

許される範囲：この文書と既存の無課金Nodeテストを専用ブランチで編集、通常CI、Draft PR。

禁止：main統合、Vercel Preview新設/更新、Staging SQL write・migration、JWT実行、モデルAPI送信、プロバイダーキー設定、DBのAI switch/予算変更、Production Supabase/Vercel/Stripeの変更、管理人限定試用・一般公開。

**go/no-go**：最新の公式価格・法務/同意・新Preview・実行時AI OFF/0円・1回限りの承認がひとつでも欠ける場合は **NO-GO**。
