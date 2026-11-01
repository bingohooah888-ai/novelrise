# NOVELIGHT AI 02-07-05｜初回実モデル試験の提供者・価格・データ取扱評価

調査基準：**2026-11-01（JST）**。対象main：`5d6e87983dccb9cba9a8a82bfda0127b39bb0f45`。
状態：**公式公開資料調査＋合成Nodeテストのみ**。試験、APIキー発行・登録、課金、同意付与、AI ON、Preview作成、Staging/Production DB書込みは行っていない。

## 1. 判定と採用順位

**初回の合成原稿1回に限り、第一候補をOpenAI `gpt-5.6-luna`（標準API、Responses API、1モデルのみ）、比較候補をGoogle `gemini-3.1-flash-lite`（Gemini Developer APIの課金プラン）とする。** このモデル選定はコード・調査上の設計決定であり、実際のアカウントがモデル/APIにアクセスできること、法務レビュー完了、費用承認、API試用の承認を意味しない。

| 候補 | 公式テキスト入力 (USD/百万token) | 出力 (USD/百万token) | 現行サーバーアダプター | 判断 |
| --- | ---: | ---: | --- | --- |
| `gpt-5.6-luna` | $0.20 | $1.20 | `/v1/responses`、`store:false`、`max_output_tokens` | **第一候補**。既存経路で無保管指示を明示し安価 |
| `gemini-3.1-flash-lite` | $0.25 | $1.50 | `generateContent`、`maxOutputTokens` | 予備案。現行アダプターはJSON schemaの応答強制を設定していない |
| `gemini-2.5-flash-lite` | $0.10 | $0.40 | 同上 | 低価格だが新規プロジェクトで提供制限あり、**初回不採用** |

公式根拠（当日取得した資料、変更され得る）：

- OpenAI [GPT-5.6 Luna model](https://developers.openai.com/api/docs/models/gpt-5.6-luna)、[API pricing](https://developers.openai.com/api/docs/pricing)。
- Google [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)、[Gemini 3.1 Flash-Lite model](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)、[2.5 Flash-Lite model](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite)。

## 2. 保持・学習・国外移転（公開ドキュメント上の事実）

### OpenAI API（第一候補）

- API経由のデータは原則として**明示的オプトインなしにモデル学習・改善へ使用されない**。
- abuse monitoringログは原則最長**30日**。法令または安全上の例外による長期保持があり得る。`Responses API`は通常のアプリ状態保持について既定30日の仕様があるが、既存アダプターは **`store:false`** を送る。これはabuse monitoringログ・prompt caching・その他の例外まで即時削除する意味ではない。
- データレジデンシーは別途対象プラン・地域・endpoint・project設定に依存し、日本リージョンを含め**保存地域と推論処理地域は同一とは限らない**。今の既存アダプターはグローバルAPIエンドポイントであり、国内限定処理を主張できない。正式な実原稿は別途地域・契約確認まで不許可。

根拠：[OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)。

### Gemini API（比較候補）

- **有効なCloud Billingが紐づくpaid service**では、Googleは原則として入出力を製品改善・モデル学習に使用しない。一方、禁止用途対策・安全確保のログ保持があり、データはGoogle/委託先の設備がある国で一時保存・処理され得る。
- 開発者向けAPIログは安全対策専用ログとは**別**。2026-10-26以降に作成されたプロジェクトのGenerateContent APIでは、ログ保存が**既定で有効**。開発者ログの標準保持は**最大55日**（設定上7/14/28/55日）、共有データセットに入れると別の保持/学習条件になる。利用時はログを無効化し、共有と学習への提供も拒否し、実際のProject側設定を別途確認する。
- 無料枠は学習利用条件が異なるため、機密性の観点でも本試行の代替としない。

根拠：[Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)、[Logging/Sharing policy](https://ai.google.dev/gemini-api/docs/logs-policy)。

**共通：原稿の即時完全削除・日本国内処理・無条件の保持0日を約束できない**。この段階では開発者権利に問題がない非機微の合成文章だけを許す。作者作品・未公開原稿・本番会員データ・R18情報は対象外。

## 3. 10円の原価事前計算（無課金。実料金ではない）

想定：**1モデル、fallbackなし、最大36,000入力tokenとして保守的に仮置き、最大1,024出力token、USD/JPYは市場レートではなく保守的仮上限200円、追加安全係数150%**。引用料金は当日公式表示の標準テキスト入出力単価。現在の実際の為替・モデル別課金要素・キャッシュ・アカウントの請求条件は実行直前に再照合する。

| 候補 | 事前予約上限の試算 | 設計上限との関係 |
| --- | ---: | --- |
| OpenAI `gpt-5.6-luna` | **2.528640円（2,528,640 micro-JPY）** | 10円以下 |
| Gemini `gemini-3.1-flash-lite` | **3.160800円（3,160,800 micro-JPY）** | 10円以下 |

`quoteAiProviderCeiling()` の単位は、入力・出力レートをそれぞれ `micro-JPY / 1,000,000 tokens` にしてから合算する。第一候補の単価設定は **入力60,000,000・出力360,000,000 micro-JPY/百万token、maxOutputTokens=1024** に相当する。今回の算定例は`tests/ai-020705-provider-preflight.test.mjs`で**合成の価格スナップショットとしてだけ**固定する。価格変更時は更新・再承認が必要であり、既存サービスの料金設定に自動反映してはいけない。

**上限の限界**：アプリのリクエスト予算予約は事業者アカウント総額の請求停止を保証しない。未知のモデル課金・二重通信・予期しないトークン扱いがある場合10円を超え得るため、アカウント側の支出管理・請求監視を事前に照合する。費用が上限内と確認できない条件なら **NO-GO** とする。

## 4. 初回の有料合成試験を許可する際の厳密な契約案

- **Staging専用**：本番と異なるSupabase project `wmlzjgvxgoyrovdhbqbg`。最新main SHAに一致する新規Preview（作成には別のステージング承認）。対象Staging Preview deployment ID、環境変数スコープ、AuthとRLS、DB migrationを検証。
- **送信対象**：利用許諾が明確な合成日本語短編1作品・1話・先頭チャンク（`chunkIndex=0`）。秘密・実原稿・未公開原稿・R18・第三者情報なし。
- **モデル固定**：`openai / gpt-5.6-luna`、標準APIのみ。フォールバックと複数モデル・検索ツール・ファイルアップロードを禁止。実験用の登録モデル、APIアカウント側アクセス権、Responses API動作は事前に読み取りで確認。
- **試行回数**：**1モデル実呼出し最大1回**。GitHub OWNER実承認ledgerを新規に作成、承認と実行を対象SHA/Preview/作品/話/同意版/価格版と一対一で束縛。失敗・タイムアウト・中断で承認消費し、同じ承認で再試行しない。HTTPクライアントとCI上の自動retryも無効。
- **金額**：1呼出し・試行全体で**10,000,000 micro-JPY（10円）を超えない申請**。実設定のRouter上限、DBの個人・全体日次/月次上限、対象の1リクエスト上限を別々にチェック。設定するのは事前見積もり以上・10円以下の必要最小額。料金・為替再計算により超過すれば実行中止。
- **期限**：OWNER承認からではなく実際の環境有効化時点を基準に、最大**1時間**のZ付きUTC有効期限。期限前でも1回消費したら再使用不可。
- **法務・同意**：原稿送信先・保存期間・安全監視ログ・学習オプトアウト・国外処理・許諾を記録し、正本同意版が対象Stagingに存在することを確認。作者の明示同意がない場合送らない。
- **実行証拠**：外部送信件数1以下、HTTP結果区分、モデルとapproved route、原価予約/精算/監査、AI候補の根拠検証、作者未承認の確定0件、シークレット非出力を確認。返答原文やJWTをログ出力しない。
- **停止・回復**：失敗した場合も、フラグ・DB global switchをOFF、DB予算0、合成Auth/作品/話/候補/同意/費用監査の残留0件を独立確認。外部事業者の保存ログはローカルDB cleanupでは削除できない。
- **本番境界**：Production Supabase・Vercel環境変数・Stripe・AI Credit・一般公開はすべて対象外。

現在はこの契約を満たす**新Preview、実行ledger、Staging専用の有料試験資格情報、最新アカウント請求上限、実送信同意の確認**が未完了。現段階は **NO-GO**。

## 5. 出力品質の合格基準と既知の限界

機械検証できるのは、候補のJSON構造、文字数・数、引用が同一話内に存在すること、ソースハッシュ、本人/作品・改稿後の再承認、AI未確定の保持である。

一方、**引用が実在しても要約が引用の意味を誤ることはある**。無課金テストでこの限界を再現し、候補を必ず`requiresAuthorReview=true`に留める。初回の実モデル1件は接続・権限・課金のスモークであって、長編・日本語ニュアンス・幻覚率を含む品質基準の合格判定にはしない。

新しい品質試験（複数合成例・誤読例・長編）や追加モデル試験は、コストと送信件数が増えるため別途承認を取得する。

## 6. 承認と次工程

1. 本PRは**Draftで止める**。CIのNode/静的/CodeQLを確認し、本番承認なしにmainへマージしない。
2. **新Previewの作成**は対象SHAと範囲を固定した別の1回限りステージング承認が必要。
3. **1回限り有料合成試験**は、モデルID、実契約・APIデータ扱い、最新価格・為替、合成作品/話、Staging資格情報・承認ledger、予算10円以下、1時間、後片付けまで再検証した**さらに別の明示承認**が必要。現在は0円/OFFのまま。
4. 管理人限定Production試用や一般公開は新たな別承認を要し、今回の範囲外。

確認したソースは公式公開資料であり、各社の実アカウント契約・ログ設定・リージョン・利用資格の検査を代替しない。
