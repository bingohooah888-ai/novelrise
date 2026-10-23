# 交流広場「タイムライン＋掲示板」同時公開ゲート — 実装準備（2026-10-23）

## 状態と承認境界

- Phase1/Phase2のコードと本番DBマイグレーション `20261014052000` / `20261023055617` は導入済み。
- 現在の `novelight-client.js` の双方フラグは `false`。Production `public.community_runtime_control.public_enabled=false`、`activated_at=null`。
- 本PRの新設ワークフローは、新規コメントに反応するエントリポイントのみ。OWNERが**専用コマンドを明示承認・投入しない限りDB変更しない**。本PR自体では公開・flags ON・DB変更を一切実施しない。
- 旧 `.github/workflows/production-community-runtime-control.yml` は Phase1単独公開用であり、サイト `timeline:true, board:false` のときしかONにならない。今回は流用しない。
- 旧承認台帳 Issue #2139 は2026-10-23時点95件あり、旧workflowの `length < 97` 制限に近い。新フローは既存のPhase2 PR #2457のコメントを専用台帳とし、相互の承認を混同しない。

## 専用ワークフロー

`.github/workflows/production-community-joint-runtime-control.yml`

- GitHubの `issue_comment`、PR #2457、`bingohooah888-ai`、`author_association==OWNER`、専用 prefix `NOVELIGHT_COMMUNITY_JOINT_RUNTIME_APPROVE ` の組み合わせだけ実行。
- JSONの `operation:community-joint-runtime`、`action:enable/disable`、`mainSha`、8文字の都度異なる one-use `challenge` を検査する。認可を特定のmain SHAへ拘束し、既使用の申請はreject。承認文の自動作成は**ChatGPTの新しい明示的本番承認**後に限る。
- enable: Phase1/2 migration、RLSと原テーブル権限、DBゲートOFFを検査。36時間以内の本番バックアップ、Vercel commit success、`novelight.jp`実配信の `timeline:true, board:true` と掲示板JS実在を再確認してからDBゲートON。
- disable: OWNER専用の停止動作。DB gateがONであることを確認し、データ削除せずOFFにする。いずれも実行前claim、実行後のread-only postcheckとreceiptを残す。
- enableのDB書込み直後、postcheck等が失敗した場合はDBゲートを即OFFに戻す。
- read-onlyチェックで失敗した場合は**実行しない**。既存のPhase1単独制御を勝手にONにしない。

## 公開当日の順序（別途明示承認）

1. 本ゲートワークフローを高リスクOWNER承認のうえmainへmerge。**この時点でサイトもDBもOFFのまま**。
2. サイト `timeline:true, board:true` にするリリース候補PRを用意・必要CIを検証。これは未mergeを維持。公開のOWNER承認が出てからだけmainへmergeする。
3. Vercel本番デプロイが実配信されたことを確認し、同一公開スコープの明示OWNER承認を対応するone-use台帳コメントに変換してDBゲートをONにする。これで双方のデータ取得を同時に成立させる。デプロイからDB有効化までの一時的なゲートOFF状態では、公開UIが見えてもデータは返さないため、短い「準備中」表示を別途検討する。
4. 公開後、実ホストにて作者・読者・運営操作を確認し、問題時はまず本ワークフローのdisableでDBゲートOFF、必要ならサイトフラグも両方OFFへ戻す。

## 確認を要する旧仕様差分（勝手に仕様変更しない）

旧未merge PR #2455の `docs/community/phase2-joint-release-20261023.md` には、1日3スレッド上限、ジャンルタグ、作品カード添付、検索・新着/注目切替、掲示板いいね、注目スレッドをタイムラインに紹介する機能が記されている。一方、Productionへ適用済みのPhase2 MVPは、**1日5スレッド、3カテゴリ、カテゴリ別新着、返信/編集/削除/通報等**までの実装であり、上記追加UX機能は含まない。MASTER第43章は両機能同時公開を定めるが、旧PRの全追加機能の承認/先送りを明記していない。

公開時の「完成」の判定がこの旧設計を含むかは、OWNERに最新方針として確認が必要。本人決定なしに旧仕様を暗黙のうちに削除・採用したことにはしない。また、投稿ガイドライン/規約は現時点で掲示板固有の規則を明記していないため、ユーザーに見せる明確な投稿ルールも公開前に確認する。

**この文書と専用workflowは単独では公開できない。法務・製品スコープ・サイトフラグの別段階が残る。**