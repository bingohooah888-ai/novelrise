# NOVELIGHT AI 工程②（02-07-05）— 継続用・唯一の現状ボード

**最終内容確認：2026-11-11 JST／Git追跡の継続ボード（source_mainは監査時点の基準SHA）。** 次のチャットでこの文書を必ず最新main・MASTER・AGENTSと照合してから使用する。ここに書かれた過去の承認は再利用不可。これは新たなCloudflare／Staging／Production実行承認ではない。

<!-- CONTINUITY_FINGERPRINT_START -->
source_main: 148524993c0c96d0432cec1380cf2c01263b7cc3
source_master_blob: e2501f9ed0722964e76fd0a49bf200717850b81d
phase: 02-07-05
last_reviewed_jst: 2026-11-11
<!-- CONTINUITY_FINGERPRINT_END -->

## 2026-11-11 作者向け章情報のオフライン表示接続（新Draft候補・実環境OFF）

- **正本**：最新main `148524993c0c96d0432cec1380cf2c01263b7cc3`、MASTER blob `e2501f9ed0722964e76fd0a49bf200717850b81d`。PR #2835・#2825はともに統合済み。Vercel Productionは同SHAでREADY、CI/CodeQL/Production ReadinessはSUCCESS。ただし本番の管理人プレビューフラグを有効にした事実や実JWT検証を意味しない。
- **ユーザー機能の既存経路**：`story-notes.html` が作者の作品・セッションを確認後、既存 `NovelightAiBibleOwnerStudio.attach` を起動し、管理人フラグがONの場合だけ `GET /api/ai-owner-novel-bible` の非公開設定を表示する。レビュー採否、下書きへの明示転記、同意と管理人試用の画面は既存部品を使用。一般作者向け公開・有料AI実行とは異なる。
- **不足・今回の最小実装**：章／話数を正規の順序で表示する既存 `NovelightAiBibleOwnerOutline.project` と `OwnerPanel.createOfflineReader` の読取契約が、作者Studioの呼び出し境界では未接続だった。Studioに**任意の外部注入 `readOutline`** を追加し、受け取る前後の現在セッション一致を確認して既存Readerへ渡す。**公開済みstory-notes側は `readOutline` を一切渡さない**ため、未承認のHTTP・RPC・Auth・DB・AI呼び出しを増やさない。偽の話順や作者判定は行わず、合成fixture上だけで既存の章表示UIを動かす。
- **オフライン試験**：読み取り依存の注入、章・話数の表示、途中ログアウト／主体変更、無効な入力と読取失敗の遮断を検証。開発中のテスト成功は将来のserver-owner-outline GETの実接続承認ではない。
- **Supabase Preview failure（READのみ）**：Stagingのremote 215版とmain local 215版の差は remote-only `20261110080421`（`formal_scout_level_staging_2762_20261110`）、local-only `20261110172000`（`author_reader_retention_cross_visit`）。**別機能のMigrationが分岐した状態**であり、番号だけ変更する処理は禁止。リモート適用状態・修復方針は未確定で、DB・Preview・Migration変更は個別承認までNO-GO。
- **次の境界**：Draft PRでのオフライン実装・CI/CodeQLのみ。main統合・Vercel Production自動デプロイは別途本番承認、Staging／Preview／実JWT／DB／Secret／有料AI／独立Watchdog実行はさらに別承認が必要。Gate A〜Eは**0/5**。これ以前のボード文中の「未統合」は履歴であって最新状態ではない。



## 2026-11-11 継続：#2835 main統合後の #2825 オフライン再同期（本番実行なし）

- **最新基準**：main `fd651701e8bc810db8523e629024d9bde23ca6be`（#2835 squash統合済み）、MASTER blob `e2501f9ed0722964e76fd0a49bf200717850b81d`（不変）。#2825 の同期前HEAD `f636bfa917fc024caddb6da84e395b44790ab6ec`。#2835の旧本番承認は消費済みで#2825に流用しない。mainとProductionはこの同期で更新しない。
- **競合と選択**：ローカル `origin/main` を既存Draft #2825の隔離worktreeへmergeし、競合は本ボードと `tests/ai-020705-candidate-runtime-contract-offline.test.mjs` のみ。新mainの制御コードはそのまま保持。候補SHAテストは #2825 側のAPI互換shimと制御Providerの**同一関数identity**を検証する仕様を維持し、認証・nonce・scopeの拒否条件を緩和しない。新mainの制御面独立テストは他の専用テストに残る。
- **#2835の確認済み結果**：main CI / CodeQL SUCCESS。Vercelの新main Productionデプロイは既存ignore commandにより意図的CANCELEDで、`novelight.jp` のREADYは旧Production SHA `95f9ddff7fb882ae4f3edaa89ef77ec79d52bcf3`。Productionで#2835の新コードが稼働したとみなさない。
- **Supabase READ ONLY**：GitHub連携のSupabase Preview checkはFAILURE（`Remote migration versions not found in local migrations directory.`）。Staging `wmlzjgvxgoyrovdhbqbg` から取得したremote 215版と新main `supabase/migrations` のlocal 215版を名前の先頭14桁で比較すると、remote専有 `20261110080421`、local専有 `20261110172000`。同番号ではなく、migrationの実体・適用状態や安全な同期方法は未確認。DB/Branch修復、Migration実行、Preview作成をしない。Staging Branch一覧の古い `MIGRATIONS_FAILED` と `ACTIVE_HEALTHY` は継続観測扱い。
- **残る境界**：#2825はDraftのオフライン再同期・回帰試験・GitHub CI/CodeQL確認のみ。新mainへの統合、Staging/Productionの変更、Secret・DB書込、実JWT、有料AI、独立Watchdog稼働は別途明示承認まで禁止。Gate A〜Eは **0/5**。AI工程②のオフライン実装進捗と実証完了を混同しない。



## 2026-11-10 継続：制御コード分離のオフライン実装（本Draft PR内／実環境OFF）

- **観測基準**：main 95f9ddff7fb882ae4f3edaa89ef77ec79d52bcf3、MASTER blob e2501f9ed0722964e76fd0a49bf200717850b81d、作業開始時PR #2825 HEAD 5f210513dc13c6fe73fa6b585819cf8080fc0531。新しいHEADはGitHub PRを優先。NLO resume BASELINE_MATCH、AUTHORIZATION NONE。
- **実装**：API側に残っていた一回限り有料Providerガードの実装を変更せずに既存 `.github/staging-ai-02-07-05` 制御フォルダへ移動。保護Runnerの2箇所のimportをローカル制御モジュールへ変更。API側は3 exportの互換shimとし、WeakMapとDB claimの実装は一箇所のみ。
- **検証**：既存のOwner/署名Watchdog/候補SHA/Runner/Provider試験を局所実行。追加した静的import閉包とAPI互換identityの試験が成功。GitHub CI/CodeQLは更新HEADの最新実行結果を参照。既存PASSの無関係な再実行禁止は維持。
- **次の作業**：この制御フォルダの候補SHA関連差分だけを独立審査できる小PRの範囲として整理する。現時点で別PR作成・main統合・保護Workflow live化はしない。実Controller/nonce、OWNER認証、Staging専用資格・Preview、実JWT/DB、有料Modelは未実証。Gate A〜E **0/5**、本番未公開。詳細は同PRの接続計画書§9。

## 2026-11-10 継続：制御面分離・Gate A〜C READ-ONLY判断（新しい実行権限なし）

- **基準**：main 95f9ddff7fb882ae4f3edaa89ef77ec79d52bcf3、MASTER blob e2501f9ed0722964e76fd0a49bf200717850b81d、Draft PR #2825 事前HEAD 96515f16b81f47e952e864e0162fc32115eb0b30。NLO resume BASELINE_MATCH、Runtime Gate start PASS（degraded）。コード/Workflow未変更、Gate A〜E 0/5。
- **設計判断**：既存mainの02-07-05 workflowはOFFLINE PREFLIGHT ONLY。候補SHA対応の権限契約はDraft PR内にあり、信頼済みmain上の実制御jobからは未使用。後段では制御面だけを審査した小PRで信頼済みmainへ分離配置する案を第一候補とするが、PR作成・main統合・実行接続はいずれも別承認。候補PRのNode/workflowをSecrets付きで直接動かさない。
- **Gate B READ**：旧Staging branch HEAD 0e4f3f594193d137d582fb693703ffdfe1d1cfd3。Vercel SSO Protectionは有効、対象旧branchおよび候補SHAのPreviewはそれぞれ0件。旧branch専用9キー中6名、未確認3名は SUPABASE_SECRET_KEY / SUPABASE_PUBLISHABLE_KEY / NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY。共通Previewや他branchのキーを代用しない。値の復号/変更なし。
- **Supabase READ**：Staging ref wmlzjgvxgoyrovdhbqbg はbranch一覧に存在。古い branch status MIGRATIONS_FAILED と preview_project_status ACTIVE_HEALTHY が併記され、個別project GETはNotFound。一方、同refのmigration一覧READは成功し215件、one-shot claim版20261101060000あり。実DBの操作権限・稼働・接続分離はこれだけで保証されない。矛盾するAPI結果は実接続前に解消する。
- **Gate A/C未証明**：外部独立Watchdogの実kill/revoke/cleanup/zero census、保護jobのOWNER真正性・永続nonce、実JWTと原子claim、Provider利用資格と実費10円上限はいずれも未実証。既知の合成PASS・SQL6件・Cron停止・DO3件凍結は再実行/変更しない。
- **次の境界**：制御面の最小差分とProductionデプロイ影響を別承認前に審査。Staging branch/Preview/Secrets/Watchdog/JWT/DB/有料AIは対象SHAとscope別の明示承認までNO-GO。詳細は本Draft PR内の接続計画書§8。新HEADはPRを再取得して判断。

## 2026-11-10 継続：候補SHA方式を既存権限契約へオフライン整合（本PR内、実環境OFF）

- **最新基準**：main 95f9ddff7fb882ae4f3edaa89ef77ec79d52bcf3、MASTER blob e2501f9ed0722964e76fd0a49bf200717850b81d。NLO隔離コピーでorigin/mainを再取得後、resume=BASELINE_MATCH（AUTHORIZATION=NONE、CLOUD_MUTATIONS=0）。mainやStaging branchは変更しない。
- **変更箇所**：既存のOwner paid trial ledger、独立署名Watchdog/原子nonce、保護Runner、6種のread-only証明、one-shot Providerの候補SHA契約を整合。main基準は別フィールドに残し、候補SHA、専用Staging branch、Preview、OWNER承認コメント・Issue #294・run ID、合成対象、費用上限を同一試行に結び付ける。追加の監視基盤は作らない。
- **重要なDB契約**：原子claimの既存 p_main_sha 列へ「試験する候補SHA」を渡す（旧main方式は従来通りmain SHA）。DB schema・Migration・RLS変更なし。Owner台帳・Watchdog・Runnerは元のmainと候補を別々に照合する。
- **対象試験**：旧main限定契約43/43、新規候補限定契約5/5合格（隔離ローカル）。幅広い局所テストは依存未導入の1件以外合格、GitHub CI/CodeQLで最終判定する。新たな実JWT、Staging/Preview、Secret、外部Watchdog、課金、DB、Production操作はゼロ。
- **残る真の阻害要因**：信頼済み制御コードをmain側へ安全に配置する方法、Owner承認の実API真正性、独立した署名鍵・永続atomic nonce、実Watchdog kill/revoke/cleanup、Staging専用資格、実JWT/実DB/費用上限の証明。PR全体をmainへ先行統合せず、別途の対象限定承認で解決する。現行有料WorkflowはOFFLINE PREFLIGHT ONLY、Gate A〜Eは0/5。
- **詳細**：Draft PR #2825に含めた「Gate A〜C実環境接続・実証計画書」の§7。main未統合の文書であり、最新HEADはGitHub PRを優先。

## 2026-11-10 OWNER採用：候補SHA限定Staging先行方式（オフライン実装）

- **設計方針の承認のみ**：現行main `95f9ddff7fb882ae4f3edaa89ef77ec79d52bcf3` を本番基準SHAとして維持し、検証対象のPR候補SHAとは**別値**で照合する。OwnerはStaging先行の候補SHA方式を採用したが、**実環境・main統合・Preview生成・Secret・実JWT・有料AI等は承認していない**。
- **最小オフライン実装**：既存 `preview-precreation-readonly.mjs` に候補SHAの任意スコープと `inspect020705CandidateStagingOffline` を追加。mainの実SHA観測は変えず、Staging branchとPreview SHAは候補SHAに固定。OWNER/Issue #294/承認ID/run/モデル/10円上限・1回/停止計画を同じ候補に束縛。共通Preview資格情報と不一致はNO-GO。**実承認認証・独立停止・実Provider利用資格は常に未確認、実行許可はfalse**。
- **既存ライブ系はOFF**：保護Runner/OWNER paid ledger/署名Watchdogの現行 main SHA 固定と Workflow `OFFLINE PREFLIGHT ONLY` は**未変更**。候補SHAの実行に必要な台帳・署名・DB claim側の変更／実証は次の**一括レビュー**対象であり、今回は制約を外さない。Gate A〜Eは**0/5**。
- **詳細**：本Draft PR #2825内の実環境接続・実証計画書に、OWNER採用決定、具体的な候補SHA読取り契約、残る正式アダプター接続境界を追記。GitHub Actions結果はPR本文の当該HEADを参照。


## 2026-11-10 実環境接続の依存・実証手順を一括固定（コード再作成なし）

- 実証手順の詳細：このDraft PRに追加したGate A〜C実環境接続計画書（PR変更ファイル参照）。**承認不要の接続設計とREAD証拠の整理のみ**。新しいWatchdog/Runner/承認レイヤー・実LIVEアダプターを追加しない。
- このチャットで観測したmainは`95f9ddff7fb882ae4f3edaa89ef77ec79d52bcf3`、PR #2825は作業着手時`368914c919e3b057cba0b7dd9a17b39d865d9326`（Draft・未統合）。新しいHEADはPR本文と実行時GitHubから必ず再取得。Staging branchは当時mainより**43コミット古く**Preview作成は未実施。
- **工程②の実装側**：既存の作品カルテ一連の模擬操作およびGate A/B/Cオフライン連結は既存PR内で合格済み。実認証・実DB・外部AI・独立Watchdogを動かした証拠ではなく、Gate A〜Eは**0/5**。
- **A/B/Cの実接続に必要**：(A) Runnerとは独立したController/heartbeat・真正性・最小停止権限と独立zero census、(B) Production非共有のStaging秘密値とSSO保護のexact SHA Preview、(C) Protected Workflow、合成Auth/JWT、Owner一回限り承認・実原子DB claim、料金/同意とcleanup。全てに費用・資格・期限を固定。
- **重要なSHA循環依存**：既存Runnerの`trustedRef=refs/heads/main`と`Preview SHA == main SHA`を守ると、未統合PRの新コードをStaging先行検証する前にmain/Productionへ入れる必要が生じる。**候補SHA限定Staging実証方式をOWNERが先に選択し、正式な別PR/承認で検証契約を変更することを推奨。勝手なSHA条件緩和やmain統合はしない。**
- **2026-11-10公式Provider参考**：`gpt-5.6-luna`の公開モデル資料と標準料金は確認できた。ただしアカウントの利用資格・為替・実請求・上限10円以内は未実証。ユーザーの課金承認前に再確認する。
- 今回は**既存PASSの再実行不要**。文書のみの変更なら、無関係の実JWT・Staging・ブラウザ試験を起動しない。新たな承認要求は、候補SHA設計のOWNER判断と実環境・費用・停止権限・回数の確定後に限定する。



## 2026-11-10 オフラインでのGate A〜C統合（管理人承認前）

- **最新確認**：main `95f9ddff7fb882ae4f3edaa89ef77ec79d52bcf3`。PR #2825のHEADは作業着手時`14b9a0773a042f833e2d3d4f830eacf8a0e6f329`（Draft）。直近main追加差分はAnalytics CSSのみでGate A〜Cの検査コードとの競合なし。Staging `staging/ai-02-07-05-gatebc-20261105` はmainより**43コミット古い**。PRへのmain同期やStagingブランチの変更は禁止のまま。
- **実装**：既存`protected-runner-offline-drill.mjs`に`inspect020705CombinedGateABCOffline`を追加。既存のPreview事前確認、独立Supervisor観測、保護Runnerの6証拠を**同じmain SHA・Staging ref・Preview・管理人・作品・承認コメント・run ID**で整合させる。既知のブランチ不一致・共通PreviewのSecret未分離があれば後段の観測コールバックを呼ばず`PREVIEW_PRECONDITIONS_NO_GO`。スコープ混同・不正観測では機密を伏せた一律拒否。既存のSupervisorやRunnerは再実装していない。
- **新規対象試験**：A〜Cの合成証拠整合、旧SHA、共通Previewキー、Owner/Previewスコープ混同、観測例外でのfail-closedを**5/5 PASS**。オフライン・純粋な合成入力で、ネットワーク/Watchdog起動/DB/Secret/外部Modelアクセスなし。既存の有効な合格試験を無意味に再実行しない。
- **正確な完了区別**：これは**オフラインの照合処理が動作する状態**であり、独立Watchdogの実配備・revoke/cleanup、認証済み観測源、Vercel Previewの資格分離、実JWT、保護された実行Workflow、原子claim、10円以内の有料AI1回は**すべて未実証**。単体検査に合格しても`authorizesExecution`/`authorizesMutation`/`authorizesPaidCall`は全てfalse。正式Gate A〜Eは**0/5**。
- **残件と承認順**：①既存Watchdogに外部資格情報・独立死活監視・停止/清掃/zero censusを結線し費用/最小権限を確証、②Productionと共有しない専用Staging資格・最新SHA整合とPreview保護を確証、③承認済みのone-shot実Runner経路へ実JWT/claim/Provider/停止を結線して単発実証。この3点は環境・SHA・費用・回数・停止条件が確定するまで**外部操作承認を要求しない**。main統合・Preview作成・環境変数変更・DB書込・有料AIは現在禁止。



## 2026-11-10 最新main・Draft PR #2825 事前確認（Feature First）

- **監査基準（読み取り専用）**：main `b826679b35862580d8097d7ddf95be3243500237`、MASTER blob `e2501f9ed0722964e76fd0a49bf200717850b81d`、Draft PR #2825 HEAD `bbd639ba55a1862e49d4f536fccb0876f795062b`。PRはDraft・未統合（main/Productionへのコード反映ではない）。ボードの新fingerprintはmainの**観測値**であり、PRをmergeしてよい承認ではない。
- **工程②のコード側**：PR #2825では作品カルテの本文・候補・出典・作者レビュー・創作ノートへの**作者が選択して転記／既存保存RPCで再読込**までオフライン結線済み。2026-11-10 HEADの既存CI・CodeQLはPASS。作者が保存前に候補を再読込する経路も実装済み。**実JWT・外部モデル・実DB保存は未検証**であり、正式Gate A～Eは0/5を維持。
- **main進行の確認**：監査開始時は `a6a921fffe276252c5b93f4d2ef097a61efe12d0`。作業中に `b826679b35862580d8097d7ddf95be3243500237` へ1 commit前進し、差分はAnalytics UI/DB migration関連8ファイルのみ。AI工程②の監査対象アダプター・MASTER・AGENTSには変更なし。PR #2825のbaseは旧main `a6a921fffe276252c5b93f4d2ef097a61efe12d0` のままで、無断でPR branchへのmain syncやmain統合は行わない。
- **Gate A（外部独立実行の不足）**：read-only `detached-supervisor-offline-drill.mjs`と既存署名・終端・cleanup契約は実外部コントローラの実行/停止権限を持たない。現時点で実独立host/heartbeat、最小権限トークンと期限・費用上限、Runner死亡の独立確認、Staging限定stop/revoke/cleanup、他権限によるzero censusが不足。2026-11-05のA2-P2三件／SQL6件PASS・A2-P3 Cron停止PASSは**再実行禁止**。過去のDO残存3件は承認がないため**そのまま維持**。A2専用権限・課金条件未確認のままWorker/DOを配備・削除しない。
- **Gate B（現時点の阻害要因）**：`staging/ai-02-07-05-gatebc-20261105` HEAD `0e4f3f594193d137d582fb693703ffdfe1d1cfd3`、最新mainより**42コミット古い**。このブランチの最新SHAと一致する新Previewは未存在（当日対象ブランチ一覧0件）。Vercel設定名は当該ブランチ専用6種＋共通Preview3種＝計9種だが、共通 `SUPABASE_SECRET_KEY`／`SUPABASE_PUBLISHABLE_KEY`／`NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY` の**Staging専用接続を非機密メタデータだけで証明できない**。9名揃うことと分離済みは別。値の復号・転記・変更は未実施。新たな`inspect020705PreviewPrecreation`オフライン判定は、旧ブランチSHA不一致・共通資格キー未証明を個別に返すが、**Preview作成は許可しない**。
- **Gate C（現時点の阻害要因）**：既存 `.github/workflows/ai-020705-owner-staging-paid-trial.yml`は**OFFLINE PREFLIGHT ONLY**。既存`protected-stage-executor.mjs`はライブのJWT/Provider/Claim/Stopアダプター注入を必要とし、Workflowからは接続されていない。保護runnerの真正性、Staging限定実JWT・合成同意、実原子one-shot claim/消費墓標、OpenAIの実利用資格・円換算最新価格・**10円以内**・一回限り・停止・独立censusは本番同等の実証なし。2026-11-10のStagingの固定read-only SELECTではAI OFF、4予算0、対象AI関連行0、claimテーブルRLS ON・service_role限定EXECUTEを観測。**あくまで当時のスナップショット**であり実試行直前に再確認要。
- **重要なSHA依存**：現行の保護Runner／Gate Bの検証は、対象Preview SHAと**承認対象main SHAの厳密一致**を要求する。未統合PR #2825のHEADを、mainと同一と扱うことはできない。新Staging branchの更新、main統合、Preview、Secret操作のどれも今の依頼では許可されていない。実行環境の承認前に、**PR統合後のSHAを基準にした本番影響の範囲**を別途特定するか、別PRで正式に検証された一回限りのSHA設計を承認してもらう必要がある。勝手に緩和しない。
- **次の一括承認前準備**：1）Aの外部停止資格とWorkers/DO費用・稼働選択、2）Bの専用ブランチ/commit・Preview保護・共通SecretsがProductionに到達しないことの非機密証跡、3）Cのprotected Workflow・実JWT・claim・provider資格/価格上限・独立停止/清掃の接続先を**一枚のpreflight台帳**にまとめる。すべて確定するまで個別の外部変更ボタンを出さない。既存PASS再試験、新Watchdog/Runner増設、全体の制約緩和はしない。
- **このPRでの修正範囲**：既存preview/read-only、detached supervisor、protected runnerの計3アダプターに、**未接続依存と環境メタデータ不足が判定できるread-onlyフィールドのみ**追加。対象テストの拡張と本ボード更新までで、Workflow・DB・Secrets・Vercel・Cloudflare・既存の停止/実行ロジックに変更は加えない。PRのHEAD更新後は、ここに記載した以前のHEADを**監査基点**として残し、最新HEADとPR本文の結果を優先する。



## 0. 最初に結論を確認する

- **10項目のうち工程②「作品カルテ／Novel Bible」の作業中**。①の共通AI基盤は既に実装が進んでいる。
- 「工程②が20～30％」は根拠となる工数計測がない以前の推測。**確定した進捗率として使わない。**
- 正式完了ゲート **A～Eのうち、現時点の完了判定は0/5**。これは工数進捗0%を意味しない。実装済みコード・単体試験は別軸で進んでいる。
- **Aの合成試験部分がPASSでもGate A全体はNO-GO**。B/Cの安全な準備を並行して進めてよいが、Gate A未完を隠してB/C/Dのクラウド操作を実行しない。

## 1. 一覧：工程②の実際の完了条件

| 区分 | 実証の現在地 | 次に必要なこと |
|---|---|---|
| A：独立Watchdog | A2-P2合成3シナリオ＋SQL6件PASS、A2-P3 Cron停止PASS。A2 DO3件が残存。独立Watchdogによる本当のRunner死亡・stop/revoke/cleanup/zero census未実証 | A2残存DOの観測・後片付けは保留。最小権限/費用の解決後に別承認。実Watchdog本体の設計と実証を進める |
| B：Staging新Preview | 旧02-07-04のStaging検証済み証拠がある。02-07-05の**新しい**Previewは未実施 | 新main SHA・branch・Vercel保護・ENV対象・Production分離を一括読み取り。Preview作成は別「ステージング承認」 |
| C：保護Runner | offlineの安全部品・workflow候補は存在。実資格・実Runner・新Previewとの接続未実証 | 合成同意/価格/原子的one-shot、資格スコープ、実装差分と検証を一括棚卸し。コードPR/実JWT/書込は各承認ゲートに従う |
| D：合成1回有料AI試験 | 未実施 | A/B/Cの実証後に、モデル/費用/対象/停止/cleanupを固定して別承認。既定は0試行、再試行なし |
| E：品質・工程②判定 | 未実施 | 誤読/根拠/同意/原価/プライバシーを評価し、管理人試用・一般公開はさらに別承認 |

正式な判定基準：`docs/NOVELIGHT-AI-PHASE2-CLOSEOUT-GATES.md`、`docs/NOVELIGHT-MASTER.md`、`AGENTS.md`。

## 2. Gate Aで「済んだ」こと／やり直してはいけないこと

- A2-P2 Run `a2p2r3-20261105-0100` はhealthy/missing/cancel全3シナリオの終端と**SQL 6件の実測**が既存証拠でPASS。入力・SHAが同じなら**SQL SELECT・Cron発火・合成DO作成・観測試験を最初からやり直さない**。
- A2-P3の旧Cron停止は `PUT []` 1回で完了、Cloudflare NLO GETで0件確認済み。**Cronを再登録しない。**
- A2 Namespace `64e7cafa1b70474a9a82836cd803a572` に3件のDO、全3件hasStoredData=true（完全ページング済み）。Namespace保存総量は過去実測72KiB。DOごとの容量と現在のpending Alarmは未検証。
- A1 Watchdog Worker `novelight-ai-gatea-watchdog` とA2 Worker `novelight-ai-gatea-a2-synthetic-p0-20261103` は別Namespace。実Watchdogの自律kill/zero census能力は未実証。
- ローカル限定のA2 read-only観測コードは11ファイル、offline test 13/13 PASS、Wrangler offline dry-run 2/2 PASS。**実Cloudflare deploy 0回・DO RPC 0回**。
- 最新の観測実行承認は、**A2限定の最小権限資格が確証できず、確定費用条件も不足したのでクラウド変更前にSAFE STOP**。既存のWrangler OAuthはA2以外にも書込み可能。過去の承認を再使用しない。
- A2 DO cleanup/deleted tombstoneは未実行・未承認。データ消去は不可逆、別承認。
- 既存Workers Free/支払い方法未登録は表示確認できたが、請求額0の証拠ではない（Billing APIは403）。
- **Gate A全体 NO-GO**。合成P2 PASSやローカル候補コンパイルPASSを独立Watchdog完成と称しない。

主要な既存証拠（接続PCの未コミット・ローカルファイル名。GitHub正式文書として扱わない。他環境で読めなければUNVERIFIEDと明記し、元の試験を勝手に再実行しない）：
`LOCAL_ONLY:gatea-a2-p2-v8-r3-final-readonly-audit-20261105.md`、
`LOCAL_ONLY:gatea-a2-p3-v8-r3-cron-stop-executed-20261105.md`、
`LOCAL_ONLY:gatea-a2-p4-formal-audit-20261105.md`、
`LOCAL_ONLY:gatea-a2-p3-v8r3-readonly-observer-preapproval-20261105.md`、
`LOCAL_ONLY:gatea-a2-p3-v8r3-observation-live-preflight-safe-stop-20261105.md`。

## 3. 次の作業優先順位（単発の後片付けに没頭しない）

1. **BとCのread-only設計・実装・offlineテストをまとめて前進させる。** 最初に依存関係を洗い出し、いま安全に実施できる内容を一括実行。前のPASSを繰り返さず、必要なファイルだけ対象にする。ProductionやStagingを無断変更しない。
2. **Aの本体＝独立Watchdog実稼働の未実証事項を一括で潰す計画**をB/C準備と並行させる。A2の過去合成DO3件の「後片付け」は安全に凍結・台帳管理し、工程②全体をそれだけで永久に止めない。
3. **権限・料金・安全境界は作業の最後ではなく最初に一括確認**する。実作業時にしか分からない項目と必要な別承認を先に列挙して、不要な「承認→別の権限不足→承認」の反復を防ぐ。
4. D/Eの外部操作はA/B/Cの成立前に実行しない。ただしD/Eで必要な品質基準・安全なモックの準備は並列化できる。

「次へ」「続けて」しか意味しない承認要求を増やさない。安全な現在の依頼範囲の作業はまとめて進める。**新しい外部state変更・費用・Secrets・削除・本番反映ではMASTERの対象限定承認を必ず適用**する。

## 4. 進捗報告の形式を固定

新しいチャットでも次の5点だけ先に報告する。

1. **現在の目標**：10項目中②のどのゲート／完成条件か。
2. **完了済みで再実行しない証拠**：対象Run・環境・SHA・証拠の場所を簡潔に。
3. **阻害要因**：本当に安全ゲートで止まる理由と、別の安全な並行作業。
4. **今回進めた成果**：コード、証拠、テスト、実環境の4層を区別。
5. **次の作業**：ユーザーの新意思決定が必要なら1件にまとめ、不要なら自動続行。

パーセントは実工数/Story points等の分母と完了基準がある場合のみ使う。合成テストや「ファイルを書いた」を工程全体の完成率へ換算しない。

## 5. 別チャットの再開手順

NLO優先で **`npm run nlo:ai:resume`** を実行し、その結果を読む。コマンドはread-onlyで、最新のGit状態・MASTER blobと本ボードの基準値が一致しない場合は`STALE`を表示する。STALEなら最新main/Master/証拠を読み直してこのボードを直すまで古い状態から操作しない。Secretはコマンドに渡さない。

新チャットでは「**NOVELIGHT工程②を再開。最初に `npm run nlo:ai:resume` と最新mainを確認して、既存のPASSを再実行せずB/Cを並行して進めて**」の一文で再開できる。ChatGPT自体が新チャットで自動的にローカルリポジトリを読むことは保証されないため、起動指示を使う。

このファイルは**情報と次の計画**であり、MASTERやAGENTSの権限・費用・一回限りの実行ゲートを変更しない。外部共有には適切なPRとOWNER承認が必要。
