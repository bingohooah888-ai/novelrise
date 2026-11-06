# NOVELIGHT βScout Point10倍｜trusted-main read-only実行器の最小コア（独立Draft PR）

**2026-11-06 JST / FULL PREFLIGHT / source-only and deterministic-memory-only / NO-GO**

## 1. 実装範囲・正式根拠

- 開始時のlatest main `0e4f3f594193d137d582fb693703ffdfe1d1cfd3`、正式MASTER blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`。MASTER 2026-10-29 OWNER品質・実証・一回限り承認境界を維持。
- 既存Draft PR #2762 HEAD `20891ce73ae788545784c72b4eb6a1e1f900aa87`に最終セキュリティレビューと34項目受入基準があり、これらは変更・再実装しない。rollback-only候補Draft PR #2763 HEAD `58e60ef90801078e097e321590428c4b8b343486`、Issue #294（Open、178コメント）も**変更しない**。
- 本独立ブランチは**latest mainを親**として作成。PR #2762にしか存在しない元SQL 2本だけを必要依存として**同一bytes**で複製。新規SQL文・migration・SQL意味変更なし。Git SHAではなく実bytesのSHA256をチェックする。
- 既存8 SELECT原本 `docs/plans/READER-REWARD-POINT10X-STAGING-CATALOG-READONLY-20261105.sql` のSHA256は `740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11`。
- 追加3 SELECT原本 `docs/plans/READER-REWARD-POINT10X-STAGING-PRIVILEGED-CATALOG-ADDENDUM-20261105.sql` のSHA256は `6dd649cc7fa4c824f6f576500a5a7e44ce65bce3123e6a4990b06353114650d1`。

## 2. 新規コードの実質的な機能

`scripts/scout-point10x-trusted-main-readonly-executor.mjs` は次の最小境界を実装。

1. import時はreadも外部通信も実行しない。通常の`runTrustedMainReadOnly()`は**必ずHOLD**し、GitHub/CONTROL/DB接続、認証、発行、Claim、Secrets、Staging SQLを実行しない。
2. `compilePinnedReadOnlyBatch()` はファイル名の任意指定やcaller SQLを受け付けず、**固定2パス**を読み取り、2本の全バイトSHA256を検証し、元SQL内の独立BEGIN／ROLLBACKを採用せず、`NL-CATALOG-01..08`、`NL-GAP-01..03`を固定順で抽出する。単一SELECT/WITHの静的形状と11個のstatement digest、manifest digestを生成し、結果にlive許可を付与しない。
3. private `driveOneSession` が1回の`BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`、11固定SELECT、**常時ROLLBACK＋close**の順序と失敗窓を実装する。内部の合成接続からのみ呼ばれ、real DB driverを受け取る外部公開入口を設けない。
4. `exerciseInertSingleSession()` は同一接続／同一トランザクション／同一snapshot、11件のdigest/行数/匿名性、実行順、ROLLBACK ACK／close ACKを決定論的なメモリfixtureで検証。BEGIN、5番目SELECT、ROLLBACK、closeの故障注入時はHOLD。生行、Secret、個人情報は結果から返さない。
5. `inspectFutureOwnerRequest()` は提案scope／operation／Issue #294／対象SHA／Staging ref／manifest digest／単発数の形を検査するが、合格しても`NO_GO_OWNER_SHAPE_ONLY`。**GitHub本人認証・履歴完全性・永続CAS・spent確認の代替にはならない**。

これは既存の34項目・非稼働監査モックの**再採番・上書きではない**。read-onlyのSQL bundle compilerとprivate実行順序kernelという、将来のtrusted-mainランナーに直接必要なコード境界を切り出したもの。

## 3. 重大な安全境界と残るBLOCKER

- **BLOCKER-01**：信頼済みmain上のIssue #294 event入口、GitHub OWNER本人認証、編集／削除／全ページ履歴確認、fresh main/PR HEADとTTL／digest固定は**未配線**。
- **BLOCKER-02**：独立CONTROL PostgreSQLのspent tombstone＋unique CAS＋mutation-domain epochとCOMMIT ACK不明のauthoritative readbackは**未配線／未実証**。in-memory成果で一回限り承認を消費したとは扱わない。
- **BLOCKER-03**：Staging専用のcatalog read role/ACL、Production拒否、endpoint/ref独立識別、secretの限定注入、SQLの実意味／関数副作用の権限検証は**未実装／未実証**。
- **BLOCKER-04**：GitHubで認証された新規OWNER scope `reader-reward-beta-point-10x-staging-catalog-single-snapshot-readonly` は未登録・未承認。旧scope／rollback-only／PR main統合承認を流用しない。
- **BLOCKER-05**：実PostgreSQL 11照会・同一snapshot・監査署名／保管／retention／完全性・ROLLBACK/close ACKは**未実証**。合成fixtureの`synthetic-*`は実snapshot IDではない。

**read-only監査には将来R01–R08の入場証拠が必要**。Writer全経路fencing、独立Backup/Restore、旧5→50pt RPCとPoint/XP/称号/取消の原子的変換は**後続の永続cutoverだけの別ゲート**。本PRは永続切替、Data Plane Writer遮断やpoint付与を実装・証明しない。

## 4. 今回のNO-GOの意味とOWNER次判断

本PRのmerge自体を**自動許可しない**。現時点で利用者向け機能は変更せず、mainへ統合されても本モジュールは自動起動しない設計だが、GitHub main統合は別途の「本番承認」を要する。既存Vercel連携による自動Production build/deploy可能性もOWNERへ事前説明する。main統合の承認だけでは実OWNER scope発行、Staging接続、CONTROL mutation、Production DB操作を許可しない。

**次のOWNER判断は、独立Draft PRの正確な変更内容／HEADでこの不活性コアをmainへ統合してよいか、またはCONTROL・OWNER verifier・read role／監査保管の別セキュリティレビューを先に要するか。** 本PRがOpen／Draftの間は、機能完成・Staging実証・Production反映のいずれも宣言できない。

## 5. 検証結果・後片付け

本PRの新HEADに紐づくローカルfocused／全Node／Prettier／ESLint／syntax／Runtime Gate／GitHub CI／CodeQL結果はPR本文で記録する。改訂前のSHAからPASSを引き継がない。RLS/E2Eは実DB・Staging操作が禁止されるため別承認まで未実施と区分する。worktreeをクリーン確認後に削除し、元リポジトリの既存未コミット変更を保持する。

**実DB接続・Staging SQL・Docker・OWNER承認発行／消費・Issue #294 CLAIMED／CONSUMED・CONTROL CAS・main merge・デプロイ・Production変更は、今回いずれも0回。NO-GO。**
