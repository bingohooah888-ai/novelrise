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

capability bootstrapが完了したら、寄り道せず直ちにlatest `main` を解決し、MASTER / Preflight / Continuation Gateのcurrent blob / digestを確認する。全文再読が必要な場合はMASTERを先頭からEOFまで読み、再利用条件を満たす場合は `MASTER_CONTENT_REUSE` へ進む。**カード後のcapability-only discoveryを理由にユーザーへ新しい「はい」「続けて」を要求してはならない。**

### MASTER_READ_COMPLETE bootstrap

#### MASTER_CONTENT_REUSE

latest `main` を解決した後、current main上のMASTER / Preflight / Continuation Gateの内容識別子をfreshに確認する。

完全読了証跡がない、正式文書が変更された、MASTER / 安全ゲート自体を変更する、またはAuth / RLS / Secret / Stripe / Production DB / 破壊的操作へ新たに入る場合は、そのexact latest-main上の `docs/NOVELIGHT-MASTER.md` を先頭からconfirmed EOFまで全文読み、`MASTER_READ_COMPLETE` を成立させる。

過去にline 1からconfirmed EOFまで欠落なく読了したMASTERとcurrent main上のMASTER内容digestが完全一致し、Preflight / Continuation Gateも変化しておらず、今回が既知の低リスク範囲内である場合は `MASTER_CONTENT_REUSE` を使用できる。main SHAの前進や新しいユーザーメッセージだけを理由に、同一内容のMASTER全文を機械的に再読しない。

ただし、新しいユーザーメッセージでは可視実行カードは必ず失効する。MASTER内容証跡の再利用と実行カードの再利用を混同しない。

Connector/file responseにtruncation・途中切れ・未解決rangeがあった証跡は再利用できない。current main上の内容同一性を証明できない場合はFail-Closedして全文再読へ戻る。


## 主要工程 Runtime Execution Gate

MASTERやPreflightを「一度読んだ資料」として扱わない。**新しい主要工程へ入る直前に、毎回このゲートを通す。**

主要工程とは、コード変更、GitHub操作、CI/E2E、デプロイ、Vercel、Supabase、Stripe、外部サービス設定、ファイル生成・更新、その他ユーザー環境へ影響する実操作のまとまりを指す。

リポジトリを操作できる実装エージェントでは、主要工程の入口でRuntime Gateを実行する。カード証跡がない場合はRuntime Gate自体がFAILする。`start` 以外のRuntime phaseは、カード証跡に加えて現在ターン・latest-mainへ固定された `MASTER_READ_COMPLETE` proofがなければFAILする。

```text
npm run runtime:gate -- --phase=<phase> --card-visible --card-total=<total> --card-steps=<steps> --card-manual=<manual> --card-wait=<wait> --master-read-complete --master-main-sha=<latest-main-sha> --master-content-sha256=<digest> --master-covered-from=1 --master-covered-through=<eof-line> --master-eof-line=<eof-line>
```

Degraded-Continueでは `--card-mode=degraded` を追加し、`--card-total` を省略できる。`--card-reason=<reason>` は任意の内部メタデータであり、ユーザー可視カードには要求しない。

`--master-unresolved-truncation` が存在する場合、またはMASTER proofのdigest / coverage / EOFがcurrent mainの実体と一致しない場合はFail-Closedする。再利用時はcurrent mainをfreshに解決したうえで、完全読了済みと同一であることを確認したdigest / coverageをcurrent mainへ再bindする。新しいユーザーメッセージで失効するのは可視実行カードであり、内容同一性を機械確認できたMASTER完全読了証跡は `MASTER_CONTENT_REUSE` として利用できる。

`phase` は `start`、`implementation`、`github`、`ci`、`deploy`、`vercel`、`supabase`、`stripe`、`files`、`image` のいずれかとする。コマンドは、カード証跡を確認した後に `origin/main` を再取得し、最新mainのMASTER / Preflightを直接読めることを確認して、通過状態を `.git/novelight-runtime-gate.json` に記録する。最新版を取得できない場合はFail-Closedする。

実操作へ進む前に、次の順序を固定する。

1. `可視実行カード`: 現在の実行ターンの最初のユーザー可視メッセージとして送信する
2. `正式基準`: latest `main` を解決し、`MASTER_READ_COMPLETE` を成立させてから、Preflight等の残り正式基準を確認する
3. `禁止・ロック`: 禁止事項、Production境界、秘密情報、担当ツール制約を確認する
4. `自動化経路`: Connector / API / CLI / Workflow / Scriptを先に比較し、不要なUI手動操作や単なる「はい」を排除する
5. `実行`: 1〜4が満たされた場合だけ実操作を開始する

Connectorやクラウド実行環境でローカルnpmコマンドを実行できない場合も、**同じアシスタントターンで可視実行カードを先に送信していなければConnector/APIを呼び出さない。** その後、Connector/APIでlatest main SHAを解決し、MASTER全文を `MASTER_READ_COMPLETE` 相当の条件で読み切ってからPreflightその他を取得する。

### Fail-Closed と Degraded-Continue の分離

安全性に直接関係する不足と、実行環境上の表示制約を同じ停止理由にしない。

次は **Hard Fail-Closed** とし、未確認・不明の場合は実操作を開始しない。

- latest mainのMASTER / Preflightを確認できない、または `MASTER_READ_COMPLETE` を成立させられない
- 禁止・ロック、Production境界、Secret境界が不明
- Production、高影響変更、課金、Secret、破壊的操作等で必要な承認がない
- 実行対象・Environment・Branch等の安全境界を確定できない

時間見積もりを提示できる実行環境で、現在の実行ターンの可視実行カードをまだ送信していない場合は、**読み取り専用Bootstrapを含めツール呼び出し自体をFail-Closedする。**

一方、実行環境の上位制約によって時間見積もり等の一部表示が禁止・非対応である場合、それだけを理由に安全・可逆・既承認スコープ内の作業まで停止しない。この場合は **Degraded-Continue** とし、可能な可視情報（目的、主要工程、手動操作、待機要否、作業量、次のユーザー操作）を提示したうえで自動継続する。時間を表示できない旨の定型文は不要とし、`別作業`も通常状態と異なる場合など判断材料になるときだけ表示する。ただしDegraded-Continueでも現在の実行ターンでカード自体を送信する。

実行環境の上位制約を無視して禁止された表示を行ってはならない。また、Degraded-ContinueをProduction/Secret/破壊的操作等のHard Fail-Closed回避に使ってはならない。

「同じチャットだから」「数分前に報告したから」「ユーザーが『はい』と言ったから」「前工程の続きだから」を正式基準・禁止確認・可視実行カードの省略理由にしない。

実行カードは承認要求ではない。表示後、安全な既承認スコープ内であればユーザーの追加の「はい」を待たず実行へ進む。

**このRuntime Execution Gateは、作業開始時だけでなく、主要工程の切替ごとに必須とする。** 可視実行カードは新しいユーザーメッセージごとに再発火する。MASTER完全読了証跡は、current main上のMASTER / Preflight / Continuation Gateの内容同一性がfreshに確認できる場合は `MASTER_CONTENT_REUSE` できる。main SHAが進んだことやユーザーへ一度ターンを返したことだけでは、同一内容のMASTER全文再読を要求しない。

### アシスタント側の回復可能エラー自動再開

現在ターンの実行カードが正しく先に表示され、まだ外部state mutation、Secret操作、課金、Production操作、破壊的操作、one-time requestのclaim等を開始していない場合、ChatGPT/実行エージェント自身の回復可能な失敗でユーザーへターンを返さない。

対象には、少なくとも以下を含む。

- read-only API / Connectorの一時失敗
- tool引数・URL・検索条件等の非変更操作の組み立てミス
- capability bootstrap後に使うread actionの選択ミス
- 同じ目的を満たす安全なread-only経路への切替
- CI/Workflow状態取得の一時失敗
- 有効なカード送信後、`MASTER_READ_COMPLETE` 前に誤って行ったread-only project-state / project-document read

安全に回復できる場合は、失敗原因を分類し、必要ならread-only bootstrapを最初からやり直し、latest `main` とMASTERをfreshに再取得して同じターンで継続する。途中で得た不確かな観測は破棄し、再取得した正式情報だけを以後の判断に使う。

単なる回復可能エラーを理由に「もう一度はいと言ってください」「続けてと送ってください」「同じ承認文を再送してください」と要求してはならない。

### MASTER-first違反のread-only bootstrap自動リセット

現在ターンの可視実行カードが正しく先に送信済みであり、まだ外部mutation、Secret操作、Production操作、破壊的操作、課金・決済、one-time requestのCLAIM/CONSUME、無許可画像ツール実行その他の高影響境界へ入っていない場合、`MASTER_READ_COMPLETE` 前のread-only project-state / project-document readは**回復可能なread-only bootstrap-order違反**として扱う。

この場合は、その誤ったbootstrapで得たproject観測をすべて破棄し、latest `main` を再取得する。再利用可能な完全読了証跡とcurrent main上のMASTER / Preflight / Continuation Gateの内容同一性を証明できる場合は `MASTER_CONTENT_REUSE` で復旧してよい。証明できない場合はMASTER reading stateをゼロへ戻し、MASTERを1行目から読み直し、visibly truncatedなrangeを自動細分化・再取得して `MASTER_READ_COMPLETE` を成立させてから再開する。

このread-only bootstrap-order違反だけを理由にユーザーへ新しい「はい」「続けて」を要求してはならない。ユーザー入力を同一ターン復旧のためのダミーcontinueボタンとして使用しない。

ただし、**カードより前にツールを呼んだ、無許可の画像ツールを呼んだ、外部mutation・Secret・Production・破壊的操作・課金/決済・one-time requestのCLAIM/CONSUMEを開始した**場合は、この自動リセットで復旧可能扱いにしてはならない。既存のHard Fail-Closed、安全承認、fresh approval、cleanup/rollback契約を優先する。

### 本番承認のcarry-forwardと機械証跡の再発行

ユーザーがMASTERで定める「本番承認」を明示した後、同じProduction変更範囲の中でfinal head SHA、main SHA、challengeその他の機械識別子だけが変化しても、そのことだけを理由に同じ人間承認を再入力させない。

人間の本番承認と、GitHub workflowが要求するexact SHA / challenge / one-time token / Approval Ledger commentは別物として扱う。前者はユーザーの意思決定、後者はその意思決定を現在の機械状態へ安全に結び付ける技術的証跡である。

同じ人間承認をcarry-forwardできるのは、freshなread-only再確認で次をすべて証明できる場合だけとする。

- operation種別と対象Environment / resourceが同一
- ユーザーが承認した実質的なProduction変更内容が同一
- 承認後に新しいmigration、追加の破壊的処理、課金・Secret変更等が追加されていない
- current main、pending state、Approval Ledgerその他の現在状態を安全に確認できる
- current main上の固定workflow contractを弱めずに新しい機械証跡を生成できる

上記を満たす場合、final head SHA、main SHA、challenge等が変わっていても、ChatGPT/実行エージェントが新しい機械可読承認を自動生成し、OWNER本人として認証されたGitHub経路から投入する。ユーザーへ「高リスク承認」「migration承認」「GitHubコメント承認」等を追加で要求しない。

一回限りの機械証跡がすでに `CLAIMED` / `CONSUMED` / `EXECUTED` / `FAILED` となっている場合、その同じ機械証跡は再利用しない。同じ人間承認を基礎に新しい機械証跡を発行できるのは、mutationが未開始または失敗地点が安全に特定され、実質的なProduction変更範囲が同一であることをfresh evidenceで証明できる場合に限る。mutationが実際に開始された可能性がある、現在状態がunknown、または追加mutationが必要になった場合は新しい本番承認を要求する。

次は人間の本番承認carry-forward禁止とする。

- 対象Environment / resourceが変わった
- migration集合やProduction変更内容が実質的に拡大した
- 新しい破壊的・不可逆的処理が追加された
- 新しい課金、Secret、credential変更が追加された
- 承認範囲が同一であることをfresh evidenceで証明できない
- Secret、2FA、OAuth、Recovery code等、ユーザー本人の新しい操作そのものが必要

目的は安全承認を省略することではない。**人間の意思決定は1回に保ち、exact SHAやchallenge等の機械安全証跡だけを必要に応じて再生成することで、同じ本番承認を何度も入力させないこと**である。

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
