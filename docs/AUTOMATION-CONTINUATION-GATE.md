# NOVELIGHT AUTOMATION CONTINUATION GATE

この文書は、ユーザーの「はい」「続けて」「次へ」が単なる続行ボタンとして使われる運用を原則廃止し、MASTER / Preflight の実行ルールを各主要工程で実際に適用するための実行契約である。

## 基本原則

判断を伴わない承認は要求しない。

次の工程が安全・可逆・既承認スコープ内であり、追加のユーザー判断や秘密情報を必要としない場合、ChatGPT/実行エージェントはユーザーへ「続けてよいか」を尋ねず、そのまま次工程へ進む。

対象には、少なくとも以下を含む。

- CI、CodeQL、GitHub Actions、Vercel Preview等の短時間待機と結果確認
- 失敗ログ取得、原因分類、軽微で安全な修正、再実行
- PR本文作成、差分確認、merge readiness確認、Smoke/Live Proof確認
- 非機密の設定確認、読み取り専用検証、定型コマンドの実行
- 同じ作業目的の中での安全な工程切替
- formatting、lint、テスト設定等の低リスク修正

## 実行ターン・カード再発火ゲート

NOVELIGHTでツールを1回でも使うアシスタントターンは、**そのターンの最初のユーザー可視メッセージを可視実行カードにする。カード送信前のツール呼び出しは禁止する。** 最新main取得、GitHub/Connectorの読み取り、状態確認、tool discoveryも例外にしない。

可視実行カードは現在のアシスタントターンだけで有効とする。ユーザーから新しいメッセージを受けた時点で前ターンのカードは失効し、次にツールを使うなら必ず新しいカードを送る。

次の入力もすべて新しい実行ターンとして扱う。

- 「はい」「続けて」「次へ」
- スクリーンショットや現在画面の共有
- ログ・エラー・CI結果の共有
- ユーザー本人の手動操作完了報告
- 設定保存、認証、再デプロイ等の完了報告

「同じ作業の続き」「前ターンで時間を出した」「数分しか経っていない」はカード省略理由にしない。

時間見積もりを提示できる環境では、カードにトータル予想時間、主要工程別時間、手動操作の有無/概算回数、待機要否を含める。時間見積もりを提示できない実行環境ではDegraded-Continueを使うが、時間を省略する理由の固定表示は要求しない。カードは目的、主要工程、手動操作、待機要否、作業量、次のユーザー操作を中心とし、`別作業`はユーザー判断に実益がある場合だけ表示する。

### Connector capability bootstrap

クラウド実行環境では、GitHub等の既接続Connectorについて、実際のread actionを呼び出せるようにするため、ツールschema・capabilityだけを先に読み込む必要がある場合がある。

現在ターンの可視実行カードをすでに送信済みであり、capability discoveryが**repository / project state、Issue、PR、Workflow、file content、deployment stateその他のNOVELIGHT実データを一切読まず、利用可能なtool schemaだけを返す**場合、その最小限のdiscoveryはtransport bootstrapとして扱い、latest `main` lookupより前に1回だけ実行してよい。

この例外は、`api_tool.list_resources` 等で「latest mainを取得するためのread actionそのものを露出する」用途に限定する。discovery結果をNOVELIGHTの現在状態として解釈してはならず、別Connector探索、project resource列挙、repository search、Issue/PR/file/workflow readへ拡張してはならない。

capability bootstrapが完了したら、寄り道せず直ちにlatest `main` を解決し、そのSHA上のMASTER全文を読む。**カード後のcapability-only discoveryを、MASTER-first違反として扱ってユーザーへ新しい「はい」「続けて」を要求してはならない。**

## 主要工程 Runtime Execution Gate

MASTERやPreflightを「一度読んだ資料」として扱わない。**新しい主要工程へ入る直前に、毎回このゲートを通す。**

主要工程とは、コード変更、GitHub操作、CI/E2E、デプロイ、Vercel、Supabase、Stripe、外部サービス設定、ファイル生成・更新、その他ユーザー環境へ影響する実操作のまとまりを指す。

リポジトリを操作できる実装エージェントでは、主要工程の入口でRuntime Gateを実行する。カード証跡がない場合はRuntime Gate自体がFAILする。

```text
npm run runtime:gate -- --phase=<phase> --card-visible --card-total=<total> --card-steps=<steps> --card-manual=<manual> --card-wait=<wait>
```

Degraded-Continueでは `--card-mode=degraded` を追加し、`--card-total` を省略できる。`--card-reason=<reason>` は任意の内部メタデータであり、ユーザー可視カードには要求しない。

`phase` は `start`、`implementation`、`github`、`ci`、`deploy`、`vercel`、`supabase`、`stripe`、`files` のいずれかとする。コマンドは、カード証跡を確認した後に `origin/main` を再取得し、最新mainのMASTER / Preflightを直接読めることを確認して、通過状態を `.git/novelight-runtime-gate.json` に記録する。最新版を取得できない場合はFail-Closedする。

実操作へ進む前に、次の順序を固定する。

1. `可視実行カード`: 現在の実行ターンの最初のユーザー可視メッセージとして送信する
2. `正式基準`: `npm run runtime:gate` または同等のConnector/API確認によって、最新mainのMASTER / Preflightと現在の明示指示を基準として確認する
3. `禁止・ロック`: 禁止事項、Production境界、秘密情報、担当ツール制約を確認する
4. `自動化経路`: Connector / API / CLI / Workflow / Scriptを先に比較し、不要なUI手動操作や単なる「はい」を排除する
5. `実行`: 1〜4が満たされた場合だけ実操作を開始する

Connectorやクラウド実行環境でローカルnpmコマンドを実行できない場合も、**同じアシスタントターンで可視実行カードを先に送信していなければConnector/APIを呼び出さない。** その後、Connector/APIで最新main SHA、MASTER、Preflightを直接再取得する。

### Fail-Closed と Degraded-Continue の分離

安全性に直接関係する不足と、実行環境上の表示制約を同じ停止理由にしない。

次は **Hard Fail-Closed** とし、未確認・不明の場合は実操作を開始しない。

- 最新mainのMASTER / Preflightを確認できない
- 禁止・ロック、Production境界、Secret境界が不明
- Production、高影響変更、課金、Secret、破壊的操作等で必要な承認がない
- 実行対象・Environment・Branch等の安全境界を確定できない

時間見積もりを提示できる実行環境で、現在の実行ターンの可視実行カードをまだ送信していない場合は、**読み取り専用Bootstrapを含めツール呼び出し自体をFail-Closedする。**

一方、実行環境の上位制約によって時間見積もり等の一部表示が禁止・非対応である場合、それだけを理由に安全・可逆・既承認スコープ内の作業まで停止しない。この場合は **Degraded-Continue** とし、可能な可視情報（目的、主要工程、手動操作、待機要否、作業量、次のユーザー操作）を提示したうえで自動継続する。時間を表示できない旨の定型文は不要とし、`別作業`も通常状態と異なる場合など判断材料になるときだけ表示する。ただしDegraded-Continueでも現在の実行ターンでカード自体を送信する。

実行環境の上位制約を無視して禁止された表示を行ってはならない。また、Degraded-ContinueをProduction/Secret/破壊的操作等のHard Fail-Closed回避に使ってはならない。

「同じチャットだから」「数分前に報告したから」「ユーザーが『はい』と言ったから」「前工程の続きだから」を正式基準・禁止確認・可視実行カードの省略理由にしない。

実行カードは承認要求ではない。表示後、安全な既承認スコープ内であればユーザーの追加の「はい」を待たず実行へ進む。

**このRuntime Execution Gateは、作業開始時だけでなく、主要工程の切替ごとに必須とする。** 同じアシスタントターン内での工程切替は必要に応じて更新見積もりを出す。ユーザーへ一度ターンを返した場合は、次のツール実行前に必ず新しい実行カードを送る。

### アシスタント側の回復可能エラー自動再開

現在ターンの実行カードが正しく先に表示され、まだ外部state mutation、Secret操作、課金、Production操作、破壊的操作、one-time requestのclaim等を開始していない場合、ChatGPT/実行エージェント自身の回復可能な失敗でユーザーへターンを返さない。

対象には、少なくとも以下を含む。

- read-only API / Connectorの一時失敗
- tool引数・URL・検索条件等の非変更操作の組み立てミス
- capability bootstrap後に使うread actionの選択ミス
- 同じ目的を満たす安全なread-only経路への切替
- CI/Workflow状態取得の一時失敗

安全に回復できる場合は、失敗原因を分類し、必要ならread-only bootstrapを最初からやり直し、latest `main` とMASTERをfreshに再取得して同じターンで継続する。途中で得た不確かな観測は破棄し、再取得した正式情報だけを以後の判断に使う。

単なる回復可能エラーを理由に「もう一度はいと言ってください」「続けてと送ってください」「同じ承認文を再送してください」と要求してはならない。

ただし、**カードより前にツールを呼んだ、MASTER前に実際のproject-state / project-documentを読んだ、無許可の画像ツールを呼んだ、外部mutationを開始した、one-time requestをclaimした**等、別の正式ゲートが同一ターン復旧を明示的に禁止する事象はこの自動再開で上書きしない。その場合も、次のユーザーメッセージに特定の「続けて」文言を要求せず、ユーザーから何らかの新しいメッセージを受けた次ターンで自動的に正しいbootstrapから再開する。

### 未消費承認のcarry-forward

ユーザーが具体的な操作を明示承認した後、ChatGPT/実行エージェント側の手順ミス・read-only失敗・transport失敗等で**その承認を使った外部request / claim / mutationがまだ一度も開始されていない**場合、同じ承認文を再入力させることを既定にしない。

承認をcarry-forwardできるのは、freshなread-only再確認で次をすべて証明できる場合だけとする。

- operation種別、対象Environment、対象resource / migration等の承認スコープが同一
- 承認後に外部request、CLAIMED ledger、mutation、課金、Secret変更等が発生していない
- safety boundaryと対象artifactが承認時から実質的に変わっていない
- 別の正式契約がexact SHA、challenge、one-time token等によるfresh approvalを要求していない

`main` が進んだ場合は、承認対象artifactとcontrol pathが変わっていないことを証明できるときだけcarry-forwardする。証明できない、または承認対象に関連する変更がある場合はfresh approvalを得る。

次はcarry-forward禁止とする。

- final-head SHA / challengeへ固定されたHigh-Risk PR承認
- Production DB、Production Secret、Stripe live、その他Production high-impact operationで正式契約がfresh approvalを要求するもの
- Secret、2FA、OAuth、Recovery code等の本人操作
- destructive / irreversible operationで実行直前のfresh confirmationが契約上必要なもの
- すでにone-time requestが `CLAIMED` または `CONSUMED` された操作

one-time request bridgeでrequestがclaim/consume済みになった場合は、元の承認を未消費とは扱わず、そのrunbookのfresh approval規則へ戻る。

目的は安全承認を省略することではなく、**アシスタント側の非変更ミスだけを理由に、同一スコープの未消費承認をユーザーへ何度も入力させないこと**である。

## スクリーンショット・画面確認ゲート

ユーザーが現在画面のスクリーンショットを送った場合、過去画像・別画面・推測を現在画面として扱わない。

操作案内の前に、少なくとも以下を確認する。

- 現在表示されているサービス / ページ / ダイアログ
- 実際に画像内で読める対象Environment、Branch、Deployment等
- 画像内で確認できない情報を「見えている」と断定していないか

画像から確認できない項目は推測で補完しない。Production / Preview、対象ブランチ、削除・Redeploy等の安全境界に関わる場合は特にFail-Closedとする。

スクリーンショットへの回答だけでツールを使わない場合は実行カード不要。スクリーンショットを受けてGitHub/Vercel/Connector等のツール作業を再開する場合は、その新しいアシスタントターンでカードを再発火する。

## 続行ボタン禁止ゲート

ユーザーへ「はい」「続けますか」「次へ進めますか」と尋ねる前に、次を判定する。

1. 新しい意思決定が必要か
2. 取り返しのつきにくい変更か
3. Production、課金、決済、Secret、2FA、OAuth、破壊的変更に関係するか
4. 当初承認された作業スコープを実質的に拡大するか
5. ユーザー本人しか判断できない選択肢が複数あるか

すべて「いいえ」の場合、承認質問は禁止し、自動継続する。

「はい」が単なる続行ボタンになる場合は、1回目から自動化対象とする。2回、3回と繰り返すまで待たない。ただしユーザーから実際に新しいメッセージが届いた後にツール作業を再開する場合、前ターンのカードは失効しているため新しいカードだけは先に送る。

## 自動停止を残す場面

以下は自動継続しない。

- Productionへの破壊的・高影響変更
- 課金、決済、購入、契約変更
- Secret、API key、2FA、Recovery code、OAuth本人承認
- データ削除、不可逆migration等の破壊的操作
- 重大な仕様変更、料金変更、公開方針変更等の経営判断
- 既承認スコープを大きく超える変更
- 複数の妥当な選択肢があり、ユーザーの価値判断が必要な場合

## 短時間待機

概ね10分以内で完了が見込まれる外部処理は、原則として同じターンで完了まで追跡する。

完了後は、結果確認、必要なログ診断、安全な軽微修正、再実行まで自動継続する。

「実行中です」「まだ待機中です」だけで応答を終了し、ユーザーの「はい」を待つ運用は禁止する。

ユーザーへ一度ターンを返した場合は、次のアシスタントターンを別の実行ターンとして扱い、ツール再開前にカードを再送する。

## 時間報告との統合

実行環境が時間見積もりを許可する場合は、自動継続であっても実作業開始前にトータル予想時間、主要工程別時間、手動操作回数、待機要否を可視化する。

見積もりが当初から5分以上または概ね25%以上ずれる見込みになった場合は、同じアシスタントターン内でも次の主要工程へ進む前に更新する。ただし、その再報告自体を承認待ちにはしない。

ユーザーから新しいメッセージを受けた場合は、見積もり変動の大小に関係なく前ターンのカードを失効させ、次にツールを使うターンで新しいカードを送信する。

実行環境の上位制約により時間見積もりを提示できない場合は、時間だけを省略し、目的・主要工程・手動操作・待機要否・制約理由を可視化して継続する。**時間報告不能を理由に、Hard Fail-Closed対象ではない安全な作業を中断しない。**

## 完了条件

ユーザーへ次の行動判断を要求する必要がない限り、準備、確認、待機、軽微修正の途中で停止しない。

最終成果、またはユーザー本人の判断・認証・高影響承認が本当に必要な地点まで自動継続する。