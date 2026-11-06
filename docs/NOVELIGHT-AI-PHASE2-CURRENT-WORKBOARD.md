# NOVELIGHT AI 工程②（02-07-05）— 継続用・唯一の現状ボード

**最終内容確認：2026-11-07 JST／Git追跡の継続ボード（source_mainは監査時点の基準SHA）。** 次のチャットでこの文書を必ず最新main・MASTER・AGENTSと照合してから使用する。ここに書かれた過去の承認は再利用不可。これは新たなCloudflare／Staging／Production実行承認ではない。

<!-- CONTINUITY_FINGERPRINT_START -->
source_main: 724f594ab8733f4a15ac4523900f59552bb9c11a
source_master_blob: 91d11fa367b7de64990b13397b13d4bb6e3c0230
phase: 02-07-05
last_reviewed_jst: 2026-11-07
<!-- CONTINUITY_FINGERPRINT_END -->

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

## 2.5 Gate B Windows隔離環境：2026-11-07 実機作成済み／再実行禁止

**Windowsローカル隔離環境の作成のみが完了。Gate B全体はNO-GOのまま。** 新しい一回限り承認なく、作成スクリプトを再実行しない。

- 固定PC：`DESKTOP-8Q4GFC8`。実行コード：Draft PR #2778、Git HEAD `49ac65cc61322a6b2a917c11f25542b56b30d069`、スクリプトSHA-256 `01d3fd35d67264d95716da436de8f2ccd67c5c4b62e5ce8718ea7402a6982d11`。PRはDraft・未統合。Productionへ反映していない。
- OWNERが管理者PowerShellで新しい一回限り承認を使用し、`GATEB_PREFLIGHT_READY_NO_MUTATION`、`GATEB_DISABLED_ACCOUNT_AND_EMPTY_VAULT_CREATED_VERIFIED`、`GATEB_APPLY_SUCCESS` を確認。
- 別の**管理者PowerShell**読み取り専用検証で `GATEB_INDEPENDENT_READONLY_VERIFIED` を確認。無効・非管理者のアカウント1件、親子フォルダ各1件、保護ACLの指定3主体、対象SIDの親ReadAndExecute・子Modify、親に子のみ・子は空を検証。画面証拠はOWNERのチャット内。GitHub/ログへアップロードしない。
- Remote Desktop Commander（NLOとは別）の読み取り専用照合でも無効・非管理者アカウントを確認。非管理者接続は子フォルダにアクセス拒否されたため、独立した子ACLの詳細証拠は上記の管理者PowerShell検証に基づく。
- 作成時の暗号学的乱数パスワードは表示・保存されておらず復元できない。専用ユーザーは意図的に無効。実認証・資格保管・Runner実行の証明にはならない。
- 関連Draft PR #2774のDPAPI経路は合成資格の自己テスト専用。同一ユーザーによるDPAPI復号は別OSユーザー/独立ホストの保護を証明しない。

**今後の未承認条件：** 専用OSユーザー認証／実行主体の安全設計、資格の最小権限保管、Staging許可／Production拒否、保護Preview/Runner。アカウント有効化、パスワードリセット、タスク登録、実PAT/Secret登録、Staging/Production変更には各対象を限定した新規OWNER承認を要する。

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
