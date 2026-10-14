# NOVELIGHT 工程⑤ — 受付開始の承認・原子的切替の安全契約（未本番）

**状態：非公開のDraft設計・検証中。2026-10-15 JST。コードを置いただけでは受付を開始しない。**

既存の決定は Issue [#2120](https://github.com/bingohooah888-ai/novelrise/issues/2120) のR1〜R11、正式規約の草案は `NOVEMBER-CONTEST-STEP05-PUBLIC-TERMS-DRAFT.md`。現在の本番は `draft / public_visible=false`、規約版/URL空文字。公開予定日や新たな参加ルールは決めない。

## 実装した最小構成

- `scripts/november-contest-registration-open-plan.mjs` は**副作用を持たないpure validatorとSQL文字列生成器**。データベース接続・SQL実行・GitHubコメント投稿は一切しない。
- 規約version `november-2026-v1`、URL `https://novelight.jp/contest-terms` は**未採択の候補を固定した検証値**であり、採択行為そのものではない。候補を変更するときは実装・テスト・ユーザー決裁をやり直す。
- 入力契約：Issue #2120へのGitHub owner-authored完全一致JSON、explicit `CHAT_CONTEST_REGISTRATION_APPROVED`、exact main SHA、現行規約コードblob SHA、15分以内の短命チャレンジ、別のOWNER規約採択コメントの認証済み証拠、全運用確認項目。通常の「はい」「続けて」「本番承認」は不許可。
- 出力SQL案：指定キーの1件に対しトランザクション／ロック／時間窓／公開フラグ／規約版・URL／応募0件を一致確認し、`status=registration` と `public_visible=true` と規約版/URLを**同一の原子的処理**で設定。監査テーブルに承認コメントID／main SHA／チャレンジを保存。1度開いた後の再実行はdraft条件に合致せず拒否。
- SQL案に読書ポイント、ランキングCron、賞金の操作は含まない。

## オーナー承認専用ワークフロー（Draft実装済み、Production未実行）

- `.github/workflows/november-contest-registration-approved-release.yml` はIssue #2120の明示的なOWNER受付開始承認コメントに限り、`environment: production` とProduction秘密情報の境界で実行する候補。**PRが未マージなので現在は無効、受付も非公開のまま**。
- `scripts/november-contest-registration-release.mjs` はGitHub APIで本人・別の規約採択・最新main・一度限りの実行履歴を再確認し、DBのread-only preflight、独立したCLAIM、書込み直前の最新main再照合、原子的SQL、DB事後確認、EXECUTED/FAILED記録を行う。過去のCLAIM/FAILED/EXECUTEDがあれば自動復旧・再試行を拒否する。
- DB照会に使うSupabase Management API `/v1/projects/{ref}/database/query` と `/read-only` は**実験的（Beta）API**。実リリースのAPIレスポンス、複文SQL受付、Productionシークレット権限・ロック・ポストチェックは実環境未検証であり、単体テストSUCCESSだけで実行準備完了とはみなさない。仕様・利用可否を承認前に独立確認する。https://supabase.com/docs/reference/api/v1-run-a-query
- 正式規約・法律/税務判断・本人確認/振込連絡経路・運用体制の未確認を`attestations=true`の自己申告で解消したことにしない。

## 禁止と未実装事項

**このDraftは本番利用の最終承認前である。** owner-only実行ワークフローのコードは作成したが、実環境の隔離検証・規約採択・法務税務確認とProduction実行権限の最終確認を欠く間は、ユーザーの独立した「受付開始承認」があってもfail-closedで止める。

1. 11月コンテスト応募要項を正式採択し、版・URL・実際の本文・公開日をOWNERが確認する。参照元のGitHubコメントIDを外部の信頼できる方法で確認し、`termsAdoptionEvidence` はGitHub APIによりowner証明済みの場合にのみ渡す。単なる自己申告を証拠と扱わない。
2. 景品表示法と居住者・非居住者税務（支払者・受賞者を含む）を最終判断。本文の一万円の支払義務や同点全員受賞ルールを勝手に制限しない。
3. 受賞通知の実送受信、口座情報の安全受領・なりすまし防止、アクセス権、保存・削除を確認。Resendドメインverifiedだけで完了としない。
4. owner-onlyの一度限りの本番実行コードはDraft実装済み。ただし独立のセキュリティレビュー、Management APIの本番利用可否、Production環境・シークレット・証跡・事後照合の実運用確認と別途の本番承認が必要。**実装済みと本番稼働済みを混同しない。**
5. 公開後の /contest と /contest-terms 200、本人による同意付き応募・取消、ゲスト一覧、PC/スマホを同意済みアカウントで検証する（事前にProduction上で代行応募はしない）。
6. 11月1日の得点開始やCronは別の開幕承認事項とする。

## 想定テスト

- 任意の普通の文面、別Issue/投稿者、旧SHA、規約テンプレート変更、他URL、未採択規約、15分期限超過、法律・税務・受賞連絡の未確認、誤ったチャレンジを拒否する。
- 有効な**合成テストデータ**では検証計画のみ生成可能、DBの変更は発生しない。合成テストのOwner証跡は本番の採択証拠にはならない。
- GitHub CIの結果・環境ゲート・規約正式決定は別々に記録する。ステージング・Previewは明示の「ステージング承認」なしに起動しない。

**重要：本PRをmergeしても応募画面は一般公開されない。** ただし本PRには将来の公開SQLを組み立てるコードが含まれるため、通常の文書修正より高リスクのコードとして独立レビューする。