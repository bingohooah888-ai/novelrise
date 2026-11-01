# NOVELIGHT AI 02-07-05｜1回限り・10円以下の合成実モデル試行／実行前監査

- 監査日：2026-11-01 JST
- 対象 GitHub main：`72b17c61a91590d2223e912e43cc8fd9fc6b8a06`
- 本稿の状態：**read-only evidence + offline test only / NO-GO**
- 本PRでは **main merge / 新Preview / Staging SQL書込み / 実JWT / OpenAI API実呼出し / AI ON / Secret登録 / Production変更は実行しない**。
- 根拠の優先順位：最新main上の `docs/NOVELIGHT-MASTER.md` と `AGENTS.md` の厳格な承認規則、コード、Vercel/Supabaseの現行読み取り状態、外部公式文書。過去の承認は再利用不可。

## 1. 実際に確認できた証拠（read-only）

| 観点 | 事実 |
| --- | --- |
| main | `72b17c61a91590d2223e912e43cc8fd9fc6b8a06` |
| Staging Supabase | Project `wmlzjgvxgoyrovdhbqbg`。SELECTでruntime設定1行、enabled=false、ユーザー/全体の日次・月次4上限=0。usage requests、audit、bible facts、episode analysis、review candidates、external consent、consent auditはすべて0件 |
| Staging migration | AI runtime・review candidate・external consentのmigration存在を確認。ただし実試行時点の整合は再確認が必要 |
| Staging branch | `staging/ai-02-07-04-owner-ui-proof-20261101` = `c59b0038e06816ace42cdf2e50e24a2c02fb5927`、**現在のmainとは一致しない** |
| Staging Preview | `dpl_EQij5nLkYSiha2Yn4UyGYs9pszwu` READY、上記旧SHA。今回の実モデル試行に流用しない |
| Preview設定 | 旧Staging branch限定Previewに9環境変数。SUPABASE Secret/Publishable Keyはsensitive、`NOVELIGHT_AI_ENABLED=false`。**OpenAI API key、実モデル試用8フラグ全部の有効化、費用承認は確認できない** |
| Production | `novelight.jp` のREADY deploymentは現行main SHA（識別のみ）。Production DB・Env/Stripeへの書込みなし |
| 02-07-04成功 | GitHub Actions [#41263146000](https://github.com/bingohooah888-ai/novelrise/actions/runs/41263146000)、旧SHAで合成実JWT・採用API・DB永続化・`FINAL_CENSUS_PASS`。**外部AIモデル/請求の試験ではない** |

観測したStagingの0円/OFF/残留0件は本日のスナップショットであり、将来の試行直前・直後の証明に流用しない。現在の合成データ削除済みを外部プロバイダーのログ削除と混同しない。

## 2. 最大の技術ブロッカー：有料APIを「1回だけ」に制限できない

- `api/_lib/ai/owner-novel-bible-trial-live.js` は8フラグ、対象の1作品・1話・先頭チャンク、最大24時間、1リクエスト最大50円という**上限付きゲート**を実装済み。ただしコードだけでは**HTTPからのプロバイダー呼び出し回数を1回に固定しない**。上限内の別request IDで複数回呼ばれ得る。
- `.github/workflows/ai-020704-hosted-browser-jwt-proof.yml` には承認→CLAIM→CONSUMEDとstaging専用実JWT・クリーンアップがあるが、スコープは `synthetic-jwt-hosted-review-ui-only`。**有料試行向けの承認ではなく、再利用禁止**。このworkflowのCLAIMだけを模倣してもHTTP側の再実行は防げない。
- **別PRで実装/別承認が必要**：今回対象に束縛したOWNER専用1回限りの承認台帳、同時実行・再送・別request hashでの再呼出しを阻止するサーバー側の原子的な1-call制御、起動→停止→cleanup→最終残留0件を失敗時にも保証する実行Runner/検証証跡。構築後は無課金のリプレイ・並列・timeout・異なるJWTなどのテストが必要。
- 外部へのPOSTの直前にtoken/nonceを一意claimし、**失敗・timeout・中断でも消費済み**とする。自動リトライ・fallbackは禁止。プロバイダーへ送信したか不明なtimeoutは再送しない。
- APIキーやJWT、本文・返答原文、AuthorizationヘッダーをActionsログ・PR・監査メタデータへ出さない。

## 3. モデル利用資格・データ利用・同意

第一候補は `openai/gpt-5.6-luna` で、既存サーバーの `/v1/responses` 呼出しは `store:false` と `truncation:disabled` を送る。2026-11-01に確認した標準の公式単価は、テキスト入力$0.20/100万token、出力$1.20/100万token。

- 公式資料：[モデル](https://developers.openai.com/api/docs/models/gpt-5.6-luna)、[価格](https://developers.openai.com/api/docs/pricing)、[データ管理](https://developers.openai.com/api/docs/guides/your-data)。
- 標準OpenAI APIは明示的オプトインなしに学習へ利用されない。標準のabuse monitoringログは原則最大30日（例外あり）。**`store:false` は即時完全削除、abuseログ0日、日本国内限定処理の保証ではない**。
- 現行接続からは**対象API organization/projectが当該モデルを使用できるか、課金有効か、projectログ/保有設定/利用上限/請求アラート、Staging限定APIキーが実在するか**は確認できない。鍵値やモデルAPIへの試験呼出しは未承認。利用資格・契約/請求条件は別途アカウント権限によりread-onlyで確認する。
- 合成された非機微の日本語原稿に限定する。第三者の作品・非公開実原稿・本人以外の個人情報・R18原稿は送らない。モデル・データ送信先、利用目的、保持、国外処理を作者向け同意の正本policy revisionに反映し、同意→撤回も対象Stagingの本人実JWTで後日個別承認のもと検証する。

## 4. 1モデル/1回/10円/1時間の実試行の契約案

| 項目 | 必須契約（今回は未実行） |
| --- | --- |
| 対象 | 新main exact SHAと一致する**新しい承認済Staging Preview**、Supabase `wmlzjgvxgoyrovdhbqbg`。Production ref `fiepaguycecrredwrcwx` を絶対に使用しない |
| 作品 | 本人管理の合成作品1件・合成episode1件・chunk=0 |
| AI | `gpt-5.6-luna` 1モデル、fallback 0件、自動retry 0件、外部POST最大1回 |
| 金額 | 10,000,000 micro-JPY以下（10円）。公式最新料金＋確認済み円為替＋リスク係数から計算。予算を実行前に対象リクエスト・個人/全体・日次/月次で固定。**アプリ内予算はプロバイダーの請求停止の完全保証ではない** |
| 参考試算 | 入力最大36,000token、出力1,024token、仮FX200円/USD、risk 1.5倍なら `2,528,640 micro-JPY`（約2.53円）。過去のCIで検証済みだが実価格とモデル資格は再確認する |
| 時間 | 専用起動時から最大60分。期限はUTCの絶対値、起動時・各HTTP前に再確認。1回呼出し済みなら期限内でも再開不可 |
| 承認 | **専用のOWNER認証済み一回限りapproval ledger**。SHA、Preview deployment ID、Staging project ID、作者/作品/話、同意版、価格版、実験scopeとbudgetを拘束し、claim競合・replayを不可にする |
| 失敗 | 401/403、モデル未登録、費用見積不可、期限切れ、同意不一致、モデル応答不正、残留検査失敗等はすべてNO-GO/停止。timeoutも再送しない |
| 最終監査 | フラグOFF、DB AI switch OFF、4予算0円、合成Auth/作品/episode・候補・事実・同意・consent audit・usage request・usage audit・セッションの残留0件。失敗でもfinallyで実施し、未証明なら失敗を維持 |

**この単発試行は品質完成の証明にはならない**。JSON候補と引用の整合、権限・原価予約・精算が正常でも、意味的な誤読/幻覚を防ぐには人間確認と後続の別承認付き比較試験が必要。

## 5. 無課金の補強と限界

`scripts/ai-020705-paid-trial-preflight-audit.mjs` は **read-onlyの純粋な証拠チェック用関数**。Staging/Production接続、APIキー、GitHub書込み、JWT、環境の有効化を一切行わない。受け取るのは検証済みかどうかのメタデータだけ。欠落はNO-GO。すべて揃う仮想ケースでも `authorizesExecution=false`、`mayCallProvider=false` を返す。

`tests/ai-020705-paid-trial-preflight-audit.test.mjs` は未承認Preview・main SHA違い・Production混同・外部モデル利用資格未確認・同意欠落・1回制限欠落・並列/リプレイ・10円超過・60分超過・削除計画なしをオフラインで拒否することを検証する。**実行Runner/DBのatomic one-shot制御の存在を証明するテストではない**。

## 6. 次に必要な別承認と順序

1. **本PRのmain統合承認**（PR番号・正確なHEAD SHA限定。既存GitHub連携でProduction自動デプロイが発生する可能性を事前説明）。
2. **実モデル試験の一回限り制御とcleanup Runnerの実装・CI承認**：新たな開発PRを作る。コード上の安全性確認を経るまでStaging write/AI有効化不可。
3. **新Staging Preview作成承認**：新main SHA・project・新ブランチ・Previewを特定し、1回の生成を承認。Staging DBの書き込みは含まない。
4. **Staging synthetic有料試行の別承認**：新Preview、本人/作品/話、model/account条件、送信同意、APIキーのサーバー限定スコープ、10円、60分、1回限り承認台帳、cleanup計画を特定。**Preview承認、PRの本番承認、前回02-07-04の承認を転用しない**。
5. 監査に基づく成功判定・最終census後、正式試用/一般公開はさらに別の判断。

**現段階の結論：NO-GO。** 今回は事前監査・オフラインコード/テスト・Draft PRのみ。実API送信やAI有効化の実行権限は発生しない。
