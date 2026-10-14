# 交流広場 Phase 1 — Production 公開準備・停止条件（Draft）

2026-10-14 時点の監査メモ。**本書は準備用であり、公開承認・MASTER改定・Production DB操作を行わない。**
本書を承認済み運用手順や正式MASTER仕様に読み替えない。

## 固定した作業対象と証跡

- Repository: `bingohooah888-ai/novelrise`
- 監査時 main: `29998956bb208f1d01f54d1dbe401fc9bf4b6205`
- 交流広場 Draft PR [#2222](https://github.com/bingohooah888-ai/novelrise/pull/2222): `fde920a24c54410d88083d04827852b094b4b67e`
- 本体migration候補: `20261014052000_community_plaza_phase1.sql`、Git blob `1f5ef773a4073f10cc2e1b886eb3a8c942beb5c4`
- Staging専用rollback-only検証: [Run #38540518460](https://github.com/bingohooah888-ai/novelrise/actions/runs/38540518460) は全ジョブ success。Issue #294 の承認comment `6164933243` は `CLAIMED` / `CONSUMED` 済みで**再利用不可**。
- 検証後の dedicated Staging `wmlzjgvxgoyrovdhbqbg`: migration履歴179件、候補未登録、`community_runtime_control` 未生成。Production ref `fiepaguycecrredwrcwx` にアクセス・変更していない。
- PR #2222 の直近 CI: Node、静的品質、PC/スマホ E2E、disposable SQL/RLS integration、CodeQL成功。集約CI failure は未承認の high-risk main merge gate が原因。
- UIフラグ `timeline:false` / `board:false`。migration候補のDB公開ゲート `community_runtime_control.public_enabled=false` が初期値。

これらの SHA と証跡は**履歴スナップショット**。実作業直前に最新main / PR head / migration blob / Approval Ledger を再取得し一致を要求する。

## 公開を止める理由・未完の証明

1. **正式MASTERとの競合**: 現行 `docs/NOVELIGHT-MASTER.md` 第43章「作者プロフィールの近況ノート」はグローバルタイムライン・いいね・コメントを禁止し、第46章の採用台帳にも同じ位置付けが残る。今回の別途承認済み「交流広場 v1.0 Phase 1」仕様をどの範囲で例外・上書きするか、正式なMASTER追補案のレビューと所定の承認が必要。既存近況ノートの private/owner-bound、ランキング等への無影響、R15/R18安全境界は維持する。
2. **Staging検証の範囲**: Run #38540518460 は one-transaction の migration precheck / candidate SQL / postcheck / role-security SQL / ROLLBACK に合格したが、**恒久的なStaging DB適用・実ユーザー画面との接続・運営のモデレーション操作・パブリック公開後の監視は未証明**。disposable CIのcross-user fixture成功は別の証拠であり、ホスト環境の完全な代替ではない。
3. **Production移行未実施**: `20261014052000` はmainに未収載・Productionに未適用。Production pending migrationは、権限ある既存の read-only preflight / Approvals 経路で改めて証明すること。直接 Supabase MCP DDL や他の経路で承認ゲートを迂回しない。
4. **公開ゲートの片側のみ変更禁止**: UIフラグとDB公開ゲートを両方確認。リンク非表示だけではRPC権限を無効化できない。新規入力やモデレーション操作の fail-closed 挙動を確認せず片側を有効化しない。
5. **退避手段の条件付き**: `supabase/rollback/20261014052000_community_plaza_phase1_rollback.sql` はcommunityデータ・同意・通知があれば破壊的rollbackを拒否する。公開後の一次対応は機能停止であり、データ削除・migration履歴改変を自動化しない。

## 段階別のチェックポイント（いずれも未承認・未実行）

### A. 公開条件の確定（read-only / review）

- [ ] 正式MASTERとユーザー承認済み交流広場 v1.0の不一致を検討し、該当項目だけの追補案を準備・承認する（未承認のまま現行MASTERを書き換えない）。
- [ ] PR #2222 の最新版の diff、33件の変更対象、安全境界、security/RLS/permissions、通知、通報・非表示・復元、Block/Mute、未成年／R15／R18の隔離、valid-read帰属、不正なRank/SCOUT/PVの相互影響を確認。
- [ ] 新しいmain SHAと候補headを比較し、migration候補のpre/post/rollback各ファイル、導入順序、過去179件との互換性、grant/RLS default-denyを再点検。
- [ ] 作者近況ノート・共有キュレーション・LIGHT SEEDの明示的なopt-in/revoke動作、legacy編集時の同意取り消し、管理画面の認証と監査ログを確認。
- [ ] 本番SQL適用後のread-only検査、障害時にUIとDBの両側を止める経路、監視指標・当番、既存機能への影響、バックアップ/復旧判断権限を確定する。

### A-2. 実画面Previewの接続先証明（**別途ステージング承認が必要**）

- [ ] 新しいPreview作成、Issue #188経由のFull Smoke、Staging/E2Eの実行は、**対象とscopeを固定した別途「ステージング承認」**を取得する。過去のIssue #294 rollback-only SQL検証の承認は再利用しない。
- [ ] `docs/STAGING-RUNBOOK.md` の既知の制約：Vercel Previewを作成しただけでは、既存HTMLのブラウザ側Supabase URL/keyはStagingへ自動で切り替わらない。保護Previewをブラウザで手動操作して**投稿・コメント・いいね・管理操作等を試さない**。Production DBへ誤書き込みする危険がある。
- [ ] Preview画面の既存read-only機能と、隔離されたStaging write/interactionテストを区別する。write試験は非Production Vercel deploymentであること、exact SHA、`VERCEL_ENV=preview`、独立Staging Supabase refとbrowser key、Stripe test mode（課金導線を使用する場合）、`STAGING_E2E_READY`等が既存contractを満たす場合のみ、許可されたHarness上で実行する。
- [ ] Phase 1の実画面確認は**公開OFFの画面回帰**と、同意・Block/Mute・通報・コメント等の**Staging限定interaction証明**を分離する。公開OFFの本番サイトだけを見ても新機能の動作証明にはならない。
- [ ] Previewを流用する場合も、対象コミット一致・Production alias拒否・保護・接続先の確認を省略しない。無承認の新規Previewデプロイ、Staging DBへのfixture作成を行わない。

### A-3. 既存Preview workflowとの対象差（2026-10-14 再確認）

- [ ] 既存のIssue #188 `full-smoke`・`thumbnail-smoke`・`live-proof` は**承認対象をcurrent main SHAに固定**する。したがって**Draft PR #2222のHEADを直接Preview表示・操作する検証には使用できない**。この経路で「ステージング承認」を受けても未マージの交流広場機能の実画面検証にならない。
- [ ] `staging-thumbnail-smoke.yml` はmain SHAを専用Preview refに固定して非Production Previewを作る既存ルートであり、PR #2222のheadへの切り替えは既存契約外。無断でrefを書き換えたり、コメントの`mainSha`に候補SHAを入れたりしない。
- [ ] Phase 1専用の候補SHAを扱うPreview経路を設けるなら、**既存のtrusted mainから実行される独立のOWNER認証/一回限りの承認台帳/候補PR ancestry/非Production接続先の証明/CIレビュー**が先に必要。default branchへの承認済み経路導入とPreview実行の承認は別境界。
- [ ] 初期DB runtime gateはOFFで、一般公開フラグもOFF。単にPreviewを作成してホームの非表示を確認しただけでは、交流広場の「いいね・コメント・通報・運営管理」の実機能証明にはならない。DB/RPC実動作を試す際はStagingに接続した状態と書き込み権限を別途証明し、Prod接続の可能性があるテストを避ける。
- [ ] 2026-10-14 のfeature HEADは一時的にmain同期される場合があり、承認時に必ず最新SHAを固定し、既存SQL blobsとの一致を再証明する。

### B. 非公開状態でのProductionコード・DB導入（**Production承認が必要**）

- [ ] **承認対象を「Draft PR #2222のmain merge / Vercel Production deploy、公開OFFの維持」として明示し、本番承認・GitHub high-risk gate・required checksを満たす。** mainへのmergeはProduction deployの開始点であり、単なる準備作業ではない。
- [ ] マージ後はUIの `timeline=false` / `board=false` が保たれていることをread-onlyで証明。公開ページや未提供RPCが壊れないことを検査。
- [ ] 別途、Production migration用の明示的な承認範囲・正しいOWNER ledger・exact main SHA・pending migration集合を確認後、承認済み経路のみでDB適用（新しいmigration、別scopeなら承認を流用しない）。
- [ ] migration後の `public_enabled=false`、RLS、RPC permission、consent defaults、postcheck、migration履歴を**read-only**で再検証。変化・不整合時は公開を止める。

### C. 交流広場の公開（**別のProduction変更境界**）

- [ ] 運営moderation、通報・制限・復元、コメント・通知、PC/スマホと匿名／ログインユーザーの実画面、導線帰属を所定環境で検証した証跡を持つ。
- [ ] 安全なDB公開ゲート切り替え経路およびUI `timeline:true` を明確にし、両方をそれぞれ承認済みProduction手順で切り替える。Phase 1の `board:false` は維持する。
- [ ] 公開直後はホーム、交流、作者近況、管理画面の導線と各RPC、投稿、レポート、通知、RLS、Rank/LIGHT SEED/SCOUTの不変性をread-only中心のスモークで確認。
- [ ] 障害時はまず新規露出と入力を止め、安全なgate OFF、切り戻し可能なコードrevision、監視・対応記録を優先。Productionの破壊的スキーマrollbackはデータ存在確認と別途承認なしに実施しない。

## MASTER追補の検討事項（**提案であり正式改定ではない**）

第43章の旧「作者プロフィールの近況ノート」に関する *グローバルタイムライン、いいね、コメントを追加しない* という限定を、別途承認済み「交流広場 v1.0 Phase 1」の**明示的opt-in・管理下の交流投稿だけに限って**置き換える追補案を用意する。既存の近況ノートは非公開/非共有を既定とし、所有者限定編集、作品公開状態・年齢区分、削除/非公開反映、Block/Mute、通報/モデレーション、安全な通知、公開同意の取り消しを必須とする。Rank、推薦、LIGHT SEED、SCOUT、PV等の評価・発見指標への不当な加点は引き続き禁止する。既存採用台帳の#19項目との整合も同時にレビューする。

この提案は **本書のPRマージだけでMASTER変更を自動承認するものではない**。正式なMASTER追補を別途レビューし、明示されたProduction境界に従う。

## 現時点の判定

**NOT RELEASED / NOT READY TO FLIP PUBLIC ON.**
Stagingの一時SQL・RLS検証は成功。正式Production導入と一般公開は別工程で、現行MASTERの仕様差分解消、権限ある移行/運用導線と動作証跡がそろうまで止める。前回会話の「約85%」は進捗管理ツールに基づく実測ではなく概算であり、本書はパーセンテージによる公開許可を与えない。
