# NOVELIGHT 読者収益化工程⑧：統合監査と正式公開前の残課題（2026-11-15）

## 証拠・承認境界

- Audit基準のmain: `e89183f498d320f8f4fdcd59097b2def626f6f42`（工程⑦統合済み）。
- 正式MASTER: `docs/NOVELIGHT-MASTER.md`（mainのblob `e2501f9ed0722964e76fd0a49bf200717850b81d`）。
- 未統合元: Draft PR #2762 HEAD `0340f35b52d0b4758cf89985264fb30abc19270b`。同PRにある旧設計・古い判断をそのまま正式MASTERに昇格させない。
- OWNERの今回の承認は、**オフラインのDraft PR 1件まで**。main統合、Staging/Production DB、Preview、秘密値・環境変更、ワークフロー手動実行、実Point/AI/ギフト処理、Wallet有効化、一般公開は明確に禁止。
- PR #2762に含まれる240ファイルのうち、監査時点のmainに同一パスのないものは210。大半はテスト・設計資料・Staging向け断片を含むため、**210件をすべて公開必須機能と誤認しない**。初回mainにはReader Rewardライブラリ42パス中9パスのみ存在した。

## 必須導線の実装・検証状況

| 領域 | 監査前のmain | 工程⑧で補うオフライン部分 | 公開前に残る必須事項 |
| --- | --- | --- | --- |
| 仕様/公開境界 | β版の`49`章は正式報酬と一部不整合。機能は未登録・公開OFF | 現行MASTERとDraft第50章の差分を可視化 | OWNERが確定内容を正式MASTERへ整理し、対象AI機能との同時公開を別途承認 |
| XP/Level/降格 | `formal-earning-rewards.js`は存在するがLevel・30日状態処理が未統合 | `rates`, `maintenance-review`, `state-transition`, `xp-progression`, `formal-thresholds`を既存PRから抽出。副作用のない200XP/30日・1レベル降格・Lv70到達者Lv50下限・Lv31以降400XPの計算とテスト | 検証済み正式XPイベントの取得、永続Level状態と排他・重複防止、実行時刻と訂正の運用、実DB検証 |
| β→正式移行 | βRPC/旧Point単位の切替は未完成 | `scout-db-compatibility`で既存β Level 1〜30の非破壊的引継ぎとschema適合の試算 | β Point10倍継承、旧trigger/RPC/称号閾値との整合、移行backfill・roll-back、承認済み一回限りのDB手順 |
| 読者表示/台帳 | 工程⑥・⑦の読者UI・交換Wallet・使用履歴はある | `formal-canonical-reader`で認証済みの正式Stateと正規Point/XP台帳の読取・単位検証・履歴表示用アダプター | 実データ読取・認証・単位切替証拠とprivate Walletの一致の検証 |
| 交換/残高 | 予約・確定・解除・返還、mock PG transaction、admin queueはある | `formal-usage-host`で既存usage service、Auth HTTP、Postgres adapter、正規読取を未登録のまま合成するfactory | 実トランザクションのrow lock/RLS/ACL/逆仕訳、重複申請・同時消費のStaging実証、運用者ロール |
| 読書・コメント報酬 | `formal-earning-rewards.js` の見積もりのみmainに存在 | 既存レート・XP計算をオフラインで先行統合 | PR #2762の`formal-earning-runner`, `formal-earning-delivery`, comment eligibility/review、event-source reader等の一括導線・実DB台帳insert・再送防止が未統合 |
| 外部ギフト/AI | provider outboxは副作用のない設計試算に限る | 新しい実通信は追加しない（手数料/契約未決定） | provider選定・本人確認・契約/法務/税務/費用、署名済callback、実発行・二重通知・部分履行・返還の実証。AI提供機能とPoint単価を確定 |
| 新規読者・運営 | 未公開admin UI・HTTP factoryは存在する | offline host factoryのOFF/no-queryを回帰試験 | 新規登録の初期化、運営側監視・エラー処理と隔離試験。PR #2762のnew reader/onboarding・formal application host等は未統合 |
| リリース検証 | 過去CI・CodeQLはコード品質の証拠のみ | 今回の追加Nodeテスト/CI・CodeQLをPR内で実行 | Staging実JWT、private DB整合、ログ秘匿、停止・復旧、Productionでの反映、明示的な最終正式リリース承認 |

## 正式MASTERとの矛盾・数値の取り扱い

- 現行mainの第49.16章には旧『AI Credit交換』の記述が残るが、PR #2762第50.4章のOWNER追認は**Scout PointをAIへ直接消費し、中間Creditを設けない**。現行第49章のβ表示仕様はβ期間に適用し、正式版仕様へ無断で置換しない。
- Draft第50.4章のOWNER追認は**10 Scout Point = 1円相当、外部交換最低30,000 Point（3,000円相当）**。β期Pointの価値維持のため旧残高は10倍継承し、外部ギフトには利用不可、AI直接利用には旧β継承分を先に消費する。
- Draft第50章では読書報酬0.1〜1.1円/話（1〜11 Point）、適格コメント2円/件（20 Point）、月50件/100円を採用。Lv.30→100は各400XP、降格判定は30日200XP、Lv.70到達者はLv.50下限。**以上を本PRで変更しない**。
- 過去の仮案（1Point=1円、3,000Point下限、AI Credit、630XP等）を再採用しない。MASTERの全文改訂は今回含めない。

## 工程⑧で統合するコード（オフラインのみ）

- PR #2762の既存blobを再利用する8個のライブラリ: `rates.js`, `maintenance-review.js`, `state-transition.js`, `xp-progression.js`, `scout-db-compatibility.js`, `formal-thresholds.js`, `formal-canonical-reader.js`, `formal-usage-host.js`（`api/_lib/reader-reward/` 配下）。
- 既存の自己完結するテスト7ファイルを再利用し、未登録hostの**DBアクセス0回・公開OFF・無認証時遮断**を確認する追加集中テスト1ファイルを作成。
- このPRは既存の公開ルート・公開JS import・Cron・API登録・migration・Secret・DB接続文字列を一切変更しない。新しい永続wallet・別Point種別を作成しない。

## 公開可否・次の意思決定

**判定：公開不可（オフライン機能部分補完段階）**。静的コードと模擬テストだけでは報酬の付与/交換の支払・法的安全・原子的台帳整合は確認できない。今回のPRをmainへ統合しても自動的に正式公開してはならない。

推奨順序：①Draft内で現行単位とLevel/XPの統合済みコードを確定 → ②未統合の報酬発行・新規読者・β10倍移行・稼働停止/復旧のオフライン主要導線を完成 → ③OWNERが正式MASTER・ギフト事業者・AI機能/価格/法務を明示決定 → ④対象を限定したStaging DB/実JWT/Providerなしの隔離検証を別途承認 → ⑤実Provider契約と費用上限・本番DB変更・一般公開をそれぞれ明示承認。

確認済み・未確認の境界：現mainとPR #2762のソース/テストをGitHub上で読取確認。**実DB/実ユーザー/実資金の監査・移行・試験はしていない**。main以外の最新作業の進展は本PRによって承認・変更していない。
