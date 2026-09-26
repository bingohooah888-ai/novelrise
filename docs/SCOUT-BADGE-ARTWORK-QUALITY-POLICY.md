# SCOUT BADGE ARTWORK QUALITY POLICY

最終更新: 2026-09-27

この文書は、`docs/NOVELIGHT-MASTER.md` の「SCOUT称号アートワーク反復実装 Fast Path」を補完する、SCOUT RECORD称号画像の品質運用基準である。

MASTER Fast Pathの「将来別仕様を採用する場合はbatch開始時に期待寸法を固定する」という例外規定に基づき、本書をSCOUT称号アートワークの正式な別仕様として採用する。以後のSCOUT称号batchでは、Fast Pathに残る旧256×256標準を一律適用せず、本書の原版優先・batch別期待寸法・provenance固定を適用する。

## 1. 原版優先

Reader Easy / Normal / Hard、Author、Limited等の区分を問わず、実装時は「最終承認済みの最高解像度・非劣化原版」を基準にする。

表示用の都合だけでcanonical asset自体を低解像度へ縮小・再圧縮して置き換えない。既に高解像度の承認原版が存在する場合、低解像度派生物を原版扱いしてはならない。

スプライト等から個別assetへ分割する場合も、原則としてcropのみとし、resize / upscale / redraw / regeneration / redesignを行わない。

## 2. 表示方針

カード表示および通常の称号詳細表示は、承認済み原版を直接参照する。

原版のnative pixel sizeを超える拡大表示が必要な場合に限り、ブラウザ側の高品質resamplingや控えめなsharpening等を補助的に使用できる。

補助処理は原版を置き換えない。補間によって元画像に存在しないディテールが復元されたものとして扱わない。

ブラウザ側で一時的な拡大画像sourceを生成する場合は、ProductionのContent Security Policyと整合するschemeだけを使用する。現在の`img-src`は`'self' data: https:`を許可し`blob:`は許可していないため、`blob:` object URLを表示sourceへ使用してはならない。CSPを緩めて表示不具合を隠すのではなく、許可済みschemeまたはDOM/canvas表示で実装する。

## 3. Easy 30の確定基準

Reader Easy 30は、PR #1031で確定した2304×1920の最終スプライトから6×5でpixel-exactに切り出した384×384 PNGを正規原版とする。

`assets/scout-badges/<badge_id>.png` は384×384の個別PNGを保持し、256×256等の縮小派生版へ置換しない。

通常の詳細表示が320pxの場合は384px原版を直接使用する。第2段階ズーム等、384pxを超える表示にのみ補助的な拡大処理を適用する。

## 4. 今後のNormal / Hard等の追加

今後Reader Normal / Hardその他の称号画像を追加する際も、固定で384×384へ変換するのではなく、そのバッチで存在する「最終承認済みの最高解像度原版」を保持する。

実装前に原版の由来、pixel dimensions、必要に応じてhash/blob SHAを確認する。個別asset登録後は、contract test等で期待dimensionまたはprovenanceを固定し、後続作業で意図せず低解像度化されることを防ぐ。

画像がチャット生成物から登録される場合も、最終承認された生成画像そのものを保存し、サイト登録前に不要な縮小を挟まない。

## 5. 品質事故時の判断順序

称号画像がぼやけて見える場合は、先にCSSやsharpeningを調整するのではなく、次の順序で原因を確認する。

1. canonical assetが承認原版そのものか
2. 原版より低解像度の派生物へ置換されていないか
3. 表示サイズがnative pixel sizeを超えていないか
4. 表示補助で生成するURL / resource schemeがProduction CSPで許可されているか
5. それでも必要な場合のみresampling / sharpening等の表示補助を追加する

原版喪失・低解像度化を表示処理だけで隠す実装は採用しない。

## 6. 未獲得称号のアートワーク秘匿

SCOUT RECORDの未獲得称号は、称号名、カテゴリ、難易度、獲得条件、進捗、達成率、Point報酬等の既存情報を表示したまま、正式な称号アートワークだけを獲得まで秘匿する。

未獲得時のカード表示および称号詳細表示では、canonical assetの代わりに共通の未獲得ロック画像を使用する。ユーザーが当該称号を獲得した後にのみ、その称号の承認済みcanonical artworkへ表示を切り替える。

ロック画像はUI専用の独立assetとし、各称号のcanonical assetを上書き、縮小、再圧縮、加工して作らない。Reader Easy / Normal / Hard、Author、Limited等の区分を問わず同じ原則を適用する。

称号アートワークを追加・差し替えする作業では、未獲得表示用ロック画像とcanonical artworkを別資産として扱い、獲得判定やScout Point付与等のauthoritative ruleと表示切替ロジックを混同しない。
