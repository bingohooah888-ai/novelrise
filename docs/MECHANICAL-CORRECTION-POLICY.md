# NOVELIGHT Mechanical Correction Policy

**機械的に正解を生成・判定できる失敗に対する再作業防止ルール**

本書は、formatter / linter / compiler / test runner / schema tool / code generator / CI等が正解または正確な修正条件を機械的に生成できる作業で、目視・推測による修正を繰り返して無駄な再実行を発生させないための運用ルールである。

## 1. 機械出力優先

以下に該当する場合、人手の推測修正を最初の手段にしない。

- formatterが正規化後の出力を生成できる
- linterがfix modeまたは具体的な違反箇所を返せる
- compiler / type checkerが確定的なエラー位置を返せる
- test runnerが失敗条件を再現できる
- schema / migration / code generation toolが生成物を出せる
- CI上でのみ再現する場合でも、ログ・artifact・一時diagnostic workflowで機械出力を取得できる

原則として、**fix / write / generate / exact diagnostic / artifact のいずれかを先に取得し、その機械出力を正本として修正する。**

## 2. 推測修正の禁止条件

機械的な正解が取得可能なのに、見た目や経験則だけで修正内容を推測してはならない。

例:

- Prettier失敗 → 手で改行位置を予想せず `prettier --write` または同等の実出力を使う
- ESLint autofix可能 → 先にfix outputを使う
- generated file差分 → generatorを再実行して生成物を使う
- CI限定失敗 → CI側で正解出力をログまたはartifactとして取得する

## 3. 同種失敗の再試行上限

同じ失敗クラスに対する同じ修正アプローチは繰り返さない。

- 1回目の修正が失敗した時点で、次の修正前に機械生成された正解またはより強い診断情報を取得する
- **同種失敗が2回発生したら、同じアプローチを禁止し、実行経路を切り替える**
- 切替例: 手修正 → fix mode、ローカル推測 → CI artifact、全文再試行 → failing gate単体、UI操作 → CLI/API/Workflow

## 4. 最小再実行

安全に切り分け可能な場合、修正確認ではまず失敗した最小gateだけを再実行する。

- formatter失敗ならformat check
- unit test失敗なら対象test
- E2E失敗なら該当specまたは該当job

ただしmerge前には、PRに必要な正式gate一式を最終的に通す。最小再実行は確認高速化のためであり、最終gate省略の理由にはしない。

## 5. 一時診断資産

一時Workflow、debug script、診断用artifact出力等を追加した場合、目的達成後は次のいずれかを行う。

- 再利用価値がある場合: 正式な共通診断機構として整理して残す
- 再利用価値がない場合: PRから削除して本来の差分だけに戻す

一時診断物を本来の機能PRへ無関係に残さない。

## 6. 例外

人手修正を許容するのは、次の場合に限る。

- 機械的に一意の正解が存在しない
- fix modeが変更範囲を広げすぎる
- 機械出力が安全境界・承認境界を越える
- generator出力自体が不正であることが確認できている

その場合も、なぜ機械出力を使わないかを短く説明し、変更範囲を最小化する。

## 7. 実行前チェック

機械検証失敗を直す前に、以下を確認する。

- [ ] この失敗は機械が正解またはfix outputを生成できないか
- [ ] 同じ失敗に対して既に同種の修正を試していないか
- [ ] 最小の再実行gateは何か
- [ ] CI限定ならlog / artifact / diagnostic workflowで正解を取得できないか
- [ ] 一時診断物を後で削除する条件を決めたか

1項目でも未確認なら、推測修正に進まない。
