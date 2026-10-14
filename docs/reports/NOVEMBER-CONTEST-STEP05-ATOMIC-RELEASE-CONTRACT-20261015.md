# NOVELIGHT 工程⑤ — 受付開始の承認・原子的切替の安全契約（未本番）

**状態：非公開のDraft設計・検証中。2026-10-15 JST。コードを置いただけでは受付を開始しない。**

既存の決定は Issue [#2120](https://github.com/bingohooah888-ai/novelrise/issues/2120) のR1〜R11、正式規約の草案は `NOVEMBER-CONTEST-STEP05-PUBLIC-TERMS-DRAFT.md`。現在の本番は `draft / public_visible=false`、規約版/URL空文字。公開予定日や新たな参加ルールは決めない。

## 実装した最小構成

- `scripts/november-contest-registration-open-plan.mjs` は**副作用を持たないpure validatorとSQL文字列生成器**。データベース接続・SQL実行・GitHubコメント投稿は一切しない。
- 規約version `november-2026-v1`、URL `https://novelight.jp/contest-terms` は**未採択の候補を固定した検証値**であり、採択行為そのものではない。候補を変更するときは実装・テスト・ユーザー決裁をやり直す。
- 入力契約：Issue #2120へのGitHub owner-authored完全一致JSON、explicit `CHAT_CONTEST_REGISTRATION_APPROVED`、exact main SHA、現行規約コードblob SHA、15分以内の短命チャレンジ、別のOWNER規約採択コメントの認証済み証拠、全運用確認項目。通常の「はい」「続けて」「本番承認」は不許可。
- 出力SQL案：指定キーの1件に対しトランザクション／ロック／時間窓／公開フラグ／規約版・URL／応募0件を一致確認し、`status=registration` と `public_visible=true` と規約版/URLを**同一の原子的処理**で設定。監査テーブルに承認コメントID／main SHA／チャレンジを保存。1度開いた後の再実行はdraft条件に合致せず拒否。
- SQL案に読書ポイント、ランキングCron、賞金の操作は含まない。

## 禁止と未実装事項

**このDraftは自動公開装置の完成ではない。** release SQLの文字列は、ユーザーの独立した「受付開始承認」と下記の証拠が揃っても、まだ**実行してはいけない**。

1. 11月コンテスト応募要項を正式採択し、版・URL・実際の本文・公開日をOWNERが確認する。参照元のGitHubコメントIDを外部の信頼できる方法で確認し、`termsAdoptionEvidence` はGitHub APIによりowner証明済みの場合にのみ渡す。単なる自己申告を証拠と扱わない。
2. 景品表示法と居住者・非居住者税務（支払者・受賞者を含む）を最終判断。本文の一万円の支払義務や同点全員受賞ルールを勝手に制限しない。
3. 受賞通知の実送受信、口座情報の安全受領・なりすまし防止、アクセス権、保存・削除を確認。Resendドメインverifiedだけで完了としない。
4. 正式GitHub owner-only **one-time approval relay**、承認コメントの外部実証、重複claim禁止、最新main SHA束縛、本番専用環境、Supabase secret境界、DB readonly事前監査、操作後のDB postcheck、結果のGitHub Ledger証跡、失敗時の安全停止・復旧フローを、別実装・テスト・本番承認で整備する。**現状はまだこの実行ワークフローがない。**
5. 公開後の /contest と /contest-terms 200、本人による同意付き応募・取消、ゲスト一覧、PC/スマホを同意済みアカウントで検証する（事前にProduction上で代行応募はしない）。
6. 11月1日の得点開始やCronは別の開幕承認事項とする。

## 想定テスト

- 任意の普通の文面、別Issue/投稿者、旧SHA、規約テンプレート変更、他URL、未採択規約、15分期限超過、法律・税務・受賞連絡の未確認、誤ったチャレンジを拒否する。
- 有効な**合成テストデータ**では検証計画のみ生成可能、DBの変更は発生しない。合成テストのOwner証跡は本番の採択証拠にはならない。
- GitHub CIの結果・環境ゲート・規約正式決定は別々に記録する。ステージング・Previewは明示の「ステージング承認」なしに起動しない。

**重要：本PRをmergeしても応募画面は一般公開されない。** ただし本PRには将来の公開SQLを組み立てるコードが含まれるため、通常の文書修正より高リスクのコードとして独立レビューする。