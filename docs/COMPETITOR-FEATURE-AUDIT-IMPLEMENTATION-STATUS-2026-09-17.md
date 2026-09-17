# NOVELIGHT 競合機能監査・実装状況追補 2026-09-17

## 目的

`docs/COMPETITOR-FEATURE-AUDIT-2026-09-16.md` は2026-09-16時点の監査スナップショットであるため、その後に実装・main反映された競合監査項目の証拠を、元スナップショットを書き換えずに追補する。

恒久方針は `docs/NOVELIGHT-MASTER.md` を正本とする。

## A候補 #3 読書表示設定

状態：**実装済み / current main反映済み**

実装証拠：

- PR #620 `Add persistent reader display settings`
- main反映commit：`16d6b58ea6d58dc4b7b258eaa5418cf109933de3`
- `episode.html`
- `novelight-reading-settings.js`
- `novelight-reading-settings.css`
- `tests/reader-display-settings-contract.test.mjs`

実装済み範囲：

- 文字サイズ：小 / 標準 / 大 / 特大
- 行間：狭め / 標準 / 広め
- 読書テーマ：明るい / 暗い
- 本文横幅：狭め / 標準 / 広め
- 標準設定へのリセット
- device-local `localStorage` への保存
- 同一ブラウザのstorage更新への追随
- モバイル表示へのレスポンシブ対応

安全・公平性境界：

- 設定値はallowlistされた表示プリセットだけを保存する。
- Supabase、RPC、評価、作品Rank、LIGHT SEED、SCOUT判定へ表示設定を流用しない。
- 既存の `record_valid_read_progress`、`record_novel_exposure_conversion`、読書Journey計測は維持する。
- UI上でも「この端末の読書表示だけを変更します。作品の評価やSCOUT判定には影響しません。」と説明する。

未実装・将来判断：

- 縦書き / 横書き切替はA候補 #3のβ最小構成には含めず、需要と実装品質を見て将来判断する。
- 現在の設定保存は端末ローカルであり、ログイン読者向けクロスデバイス読書位置同期（A候補 #4）とは別機能として扱う。

## 監査上の扱い

2026-09-16監査本文の「current mainで確認できない」という記述は監査時点の状態として残す。

2026-09-17以降に実装状況を判断する場合は、本追補とcurrent mainを合わせて確認し、A候補 #3を未実装として重複開発しない。
