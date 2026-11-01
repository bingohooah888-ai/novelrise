# NOVELIGHT AI 工程2（02-07-05）最終実証・完了ゲート

基準：2026-11-01 JST。最新main・正式 `docs/NOVELIGHT-MASTER.md` と `AGENTS.md` を最優先。工程2の残作業は関連実装・証拠をまとめて扱い、局所的な見かけのPASSだけで小分け承認を増やさない。

## 現在の4段階評価
| 区分 | 確認状態 |
| --- | --- |
| コード実装 | 一回限りのモデルPOSTガード、AUTHOR consent、候補・原価予約・原子的DB claim、停止/cleanupの内部ロジック等が存在。ただし完全なlive end-to-endは未接続 |
| CI/単体テスト | 合成モック試験は多数PASS。実モデル利用資格・実課金・外部停止の保証ではない |
| Staging実環境 | 02-07-04の旧SHAで実JWT/合成作品/候補永続化と残留0件は過去にPASS。02-07-05の実モデル・新Preview・独立Watchdogは未実施 |
| Production反映 | 安全な未接続コードがmain/READY。AIの本番生成や一般公開の完了ではない |

## まず確認できた事実
Staging project `wmlzjgvxgoyrovdhbqbg` で読み取り専用SQLによりAI OFF、4予算0、関連AIテーブル0件、1回限りclaimの表RLS・invoker関数・service_role限定EXECUTEを確認。適用済みmigration `20261101060000_novelight_ai_020705_one_shot_claim` は確認済み。**これ以上「migrationが未適用」と一律に扱わず、実試験前に最新状態を再照合する。**

## 次の一括実装と明示承認の順番
| ゲート | 取りまとめる実作業 | 認可 |
| --- | --- | --- |
| A：保護された独立監視 | GitHub Actionsの実状態に加え、独立した外部コントローラによるheartbeat、停止権限、記録消費、失敗時のAuth停止と残留0件確認を実環境で証明。受動的read-onlyチェックとkill能力は別権限。Runner kill時のfinally依存を禁止 | 設計・offlineテストは承認不要。新規インフラ/環境変更・本番変更は各操作を特定して承認 |
| B：Staging実試験用Preview | 新main SHAと同一の対象ブランチ、既存保護/環境の設定分類、Staging接続とProduction絶縁、新Preview1回を検証 | **新Preview作成専用のステージング承認** |
| C：保護された試行Runner | 現在のOFFLINE専用workflowから独立した承認済み実行経路に、専用OWNER ledger・原子的one-shot・合成Auth/JWT・価格/同意・完全停止/censusを接続。実行トークンとProvider Secretを別経路に分離。 | コードPR統合はexact HEAD本番承認。Staging書込み、実JWT、秘匿値適用などは個別のステージング承認 |
| D：合成1回有料試験 | 合成日本語1作品/1話/1 chunk、`gpt-5.6-luna` 1回/10円以下/最大60分、自動リトライ・フォールバックなし。失敗・timeoutでも承認を消費し、停止・清掃・独立zero censusを検証 | **実モデル・費用・対象環境を固定した1回限りの別承認** |
| E：品質評価・工程2判定 | 解析候補の引用根拠、誤読、作者確認・承認、原価・プライバシー、アクセス制御を検証。管理人試用は別途限定承認、一般公開はさらに別承認 | exact scopeごとに承認 |

## 検証に使える既存コード
- `.github/staging-ai-02-07-05/protected-stage-executor.mjs`：生の実行アダプターが未接続。
- `.github/staging-ai-02-07-05/github-dual-proof-readonly.mjs` / `watchdog-evidence-handoff.mjs`：読み取り専用の記録照合とNO-GO判定。独立監視ではない。
- `.github/staging-ai-02-07-05/staging-synthetic-cleanup.mjs`：停止・清掃・censusの注入契約。実環境の認可・失敗時の外部停止が別途必要。
- `.github/staging-ai-02-07-05/staging-readonly-baseline.mjs`：OFF/予算0・関連AI件数と原子的claim権限を集計する固定のSELECT。実行元の認証とREAD ONLYトランザクションは接続側に必須。
- `.github/workflows/ai-020705-owner-staging-paid-trial.yml`：**OFFLINE PREFLIGHT ONLY**、有料AI試験の稼働入口ではない。

## 停止条件
任意の証拠が欠落・期限切れ・対象SHA不一致・資格情報不明・本人同意なし・費用上限不明・本番接続の疑い・中断時watchdog不能・clean-upの検証不能の場合は即NO-GO。SECRET/JWT/原稿/PIIはPR・報告・Actionsに記録しない。

**合成テストや読み取り結果を「工程2完成」「有料AI稼働可能」とは表示しない。** PR統合による通常のProduction自動デプロイ以外の操作権限を推定しない。
