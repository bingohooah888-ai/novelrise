import { readFile, writeFile } from 'node:fs/promises';

async function replaceExact(path, oldText, newText) {
  const source = await readFile(path, 'utf8');
  if (!source.includes(oldText)) {
    throw new Error(`Expected text not found in ${path}: ${oldText.slice(0, 120)}`);
  }
  const updated = source.replace(oldText, newText);
  await writeFile(path, updated, 'utf8');
}

async function replaceRegex(path, pattern, replacement) {
  const source = await readFile(path, 'utf8');
  if (!pattern.test(source)) {
    throw new Error(`Expected pattern not found in ${path}: ${pattern}`);
  }
  pattern.lastIndex = 0;
  const updated = source.replace(pattern, replacement);
  await writeFile(path, updated, 'utf8');
}

await replaceExact(
  'docs/EXECUTION-TURN-CARD-GATE.md',
  `- \`目的\`\n- \`主要工程\`\n- \`手動操作\`\n- \`待機\`\n- \`作業量\`\n- \`別作業\`\n- \`次のユーザー操作\`\n- one of the two time modes below`,
  `- \`目的\`\n- \`主要工程\`\n- \`手動操作\`\n- \`待機\`\n- \`作業量\`\n- \`次のユーザー操作\``
);

await replaceExact(
  'docs/EXECUTION-TURN-CARD-GATE.md',
  `\`別作業\` must state whether the user can safely switch to other work while NOVELIGHT work proceeds. Prefer a direct statement such as \`して大丈夫です\` or \`この工程では画面確認が必要です\`.`,
  `\`別作業\` is optional. Show it only when it provides non-default decision value, such as when the user must remain available, should not switch away, or a meaningful waiting window makes switching work useful. Do not emit a default \`して大丈夫です\` line on every card.`
);

await replaceRegex(
  'docs/EXECUTION-TURN-CARD-GATE.md',
  /### Timed mode[\s\S]*?## 3\. Local\/runtime-capable path/,
  `### Time information\n\nWhen the execution environment permits time estimates and the estimate is useful, include \`トータル予想時間\` and major-step estimates.\n\nWhen higher-level execution constraints prohibit time estimates, omit time information from the user-visible card. Do not print a fixed explanation that time cannot be displayed. Local/runtime callers may still use \`--card-mode=degraded\`; \`--card-reason\` is optional internal metadata and is not a required user-visible field.\n\n## 3. Local/runtime-capable path`
);

await replaceExact(
  'docs/EXECUTION-TURN-CARD-GATE.md',
  `- whether other work is safe;\n- the next user-action condition;\n- total time in timed mode;\n- omission reason in degraded mode.`,
  `- the next user-action condition;\n- total time in timed mode.\n\nOptional \`other work\` and degraded-mode reason metadata may be recorded when useful, but they are not required card fields.`
);

await replaceExact(
  'docs/EXECUTION-TURN-CARD-GATE.md',
  `- every execution card carries workload, other-work guidance, and the next user-action condition;\n- degraded mode requires an omission reason and the qualitative replacement guidance;\n- timed mode requires a total estimate;`,
  `- every execution card carries workload and the next user-action condition;\n- other-work guidance is optional and must not be emitted as a default filler line;\n- degraded mode may omit both the time estimate and a user-visible omission explanation;\n- timed mode requires a total estimate;`
);

await replaceExact(
  'docs/WORK-EXECUTION-PREFLIGHT.md',
  `- 今回の目的\n- 主要工程\n- 手動操作の有無\n- 待機要否\n- 時間見積もりを省略する実行環境上の理由`,
  `- 今回の目的\n- 主要工程\n- 手動操作の有無\n- 待機要否\n- 作業量\n- 次のユーザー操作`
);

await replaceExact(
  'docs/WORK-EXECUTION-PREFLIGHT.md',
  `実行環境の上位制約で時間見積もりを提示できない場合は、次の形式へ切り替える。\n\n\`目的：○○。主要工程：①○○、②○○、③○○。手動操作：0回（または約○回）。待機：不要（または外部処理中は待機不要）。時間見積もり：実行環境の上位制約により省略。\``,
  `実行環境の上位制約で時間見積もりを提示できない場合、時間に関する固定文は表示しない。\`目的\`、\`主要工程\`、\`手動操作\`、\`待機\`、\`作業量\`、\`次のユーザー操作\`を中心に、ユーザーの判断に必要な情報だけを表示する。\`別作業\`は通常状態と異なる場合など、判断材料になるときだけ表示する。`
);

await replaceExact(
  'docs/WORK-EXECUTION-PREFLIGHT.md',
  `実行環境の上位制約により時間見積もりを出せないDegraded-Continueでは、\`--card-mode=degraded\` と \`--card-reason=<reason>\` を追加し、\`--card-total\` を省略できる。`,
  `実行環境の上位制約により時間見積もりを出せないDegraded-Continueでは、\`--card-mode=degraded\` を追加し、\`--card-total\` を省略できる。\`--card-reason=<reason>\` は内部監査用の任意メタデータであり、ユーザー可視カードへの固定表示は要求しない。`
);

await replaceExact(
  'AGENTS.md',
  `時間見積もりを提示できる環境のカードには、少なくとも \`トータル予想時間\`、主要工程別時間、手動操作の有無/概算回数、待機要否を含める。実行環境の上位制約により時間を提示できない場合だけDegraded-Continueを使い、目的、主要工程、手動操作、待機要否、時間省略理由を現在のターンで可視化する。`,
  `時間見積もりを提示できる環境のカードには、少なくとも \`トータル予想時間\`、主要工程別時間、手動操作の有無/概算回数、待機要否を含める。実行環境の上位制約により時間を提示できない場合はDegraded-Continueを使うが、時間を表示できない旨の固定文は出さない。カードは目的、主要工程、手動操作、待機要否、作業量、次のユーザー操作を中心とし、\`別作業\`は通常状態と異なる等、ユーザー判断に役立つ場合だけ表示する。`
);

await replaceExact(
  'AGENTS.md',
  `Degraded-Continueでは \`--card-mode=degraded --card-reason=<reason>\` を追加し、\`--card-total\` を省略できる。同等の \`NOVELIGHT_EXECUTION_CARD_*\` 環境変数も使用できる。`,
  `Degraded-Continueでは \`--card-mode=degraded\` を追加し、\`--card-total\` を省略できる。\`--card-reason=<reason>\` は任意の内部メタデータとし、ユーザー可視カードには要求しない。同等の \`NOVELIGHT_EXECUTION_CARD_*\` 環境変数も使用できる。`
);

await replaceExact(
  'docs/AUTOMATION-CONTINUATION-GATE.md',
  `時間見積もりを提示できる環境では、カードにトータル予想時間、主要工程別時間、手動操作の有無/概算回数、待機要否を含める。時間見積もりを提示できない実行環境だけDegraded-Continueを使い、目的、主要工程、手動操作、待機要否、時間を省略する理由を現在のターンで可視化する。`,
  `時間見積もりを提示できる環境では、カードにトータル予想時間、主要工程別時間、手動操作の有無/概算回数、待機要否を含める。時間見積もりを提示できない実行環境ではDegraded-Continueを使うが、時間を省略する理由の固定表示は要求しない。カードは目的、主要工程、手動操作、待機要否、作業量、次のユーザー操作を中心とし、\`別作業\`はユーザー判断に実益がある場合だけ表示する。`
);

await replaceExact(
  'docs/AUTOMATION-CONTINUATION-GATE.md',
  `Degraded-Continueでは \`--card-mode=degraded --card-reason=<reason>\` を追加し、\`--card-total\` を省略できる。`,
  `Degraded-Continueでは \`--card-mode=degraded\` を追加し、\`--card-total\` を省略できる。\`--card-reason=<reason>\` は任意の内部メタデータであり、ユーザー可視カードには要求しない。`
);

await replaceExact(
  'docs/AUTOMATION-CONTINUATION-GATE.md',
  `この場合は **Degraded-Continue** とし、可能な可視情報（目的、主要工程、手動操作、待機要否、制約理由）を提示したうえで自動継続する。ただしDegraded-Continueでも現在の実行ターンでカード自体を送信する。`,
  `この場合は **Degraded-Continue** とし、可能な可視情報（目的、主要工程、手動操作、待機要否、作業量、次のユーザー操作）を提示したうえで自動継続する。時間を表示できない旨の定型文は不要とし、\`別作業\`も通常状態と異なる場合など判断材料になるときだけ表示する。ただしDegraded-Continueでも現在の実行ターンでカード自体を送信する。`
);

await replaceExact(
  'scripts/runtime-execution-gate.mjs',
  `  if (!otherWork) {\n    throw new Error('Execution turn card must state whether other work is safe.');\n  }\n`,
  ''
);

await replaceExact(
  'scripts/runtime-execution-gate.mjs',
  `  if (mode === 'degraded' && !reason) {\n    throw new Error('Degraded execution turn card must include the omission reason.');\n  }\n`,
  ''
);

await replaceExact(
  'scripts/runtime-execution-gate.mjs',
  '    version: 5,',
  '    version: 6,'
);

await replaceExact(
  'tests/execution-turn-card-gate.test.mjs',
  `    '--card-workload=medium',\n    '--card-other-work=allowed',\n    '--card-next-user-action=none'`,
  `    '--card-workload=medium',\n    '--card-next-user-action=none'`
);

await replaceExact(
  'tests/execution-turn-card-gate.test.mjs',
  `    '--card-workload=medium',\n    '--card-other-work=allowed',\n    '--card-next-user-action=none',\n    '--card-reason=higher-level execution constraint'`,
  `    '--card-workload=medium',\n    '--card-next-user-action=none'`
);

await replaceRegex(
  'tests/execution-turn-card-gate.test.mjs',
  /test\('every execution card carries practical scheduling guidance',[\s\S]*?\n\}\);\n\ntest\('degraded mode can never omit the time-omission explanation',[\s\S]*?\n\}\);/,
  `test('execution cards keep only decision-useful required guidance', () => {\n  assert.match(contract, /\`作業量\`/);\n  assert.match(contract, /\`別作業\` is optional/);\n  assert.match(contract, /\`次のユーザー操作\`/);\n  assert.doesNotMatch(\n    contract,\n    /具体的な所要時間：実行環境の制約により表示できません。/\n  );\n\n  const requiredOptions = [\n    ['--card-workload=', /must include qualitative workload/],\n    ['--card-next-user-action=', /must include the next user-action condition/]\n  ];\n\n  for (const [prefix, errorPattern] of requiredOptions) {\n    assert.throws(\n      () =>\n        parseExecutionCardEvidence(\n          validTimedArgs().filter((arg) => !arg.startsWith(prefix)),\n          {}\n        ),\n      errorPattern\n    );\n  }\n\n  const evidence = parseExecutionCardEvidence(validTimedArgs(), {});\n  assert.equal(evidence.workload, 'medium');\n  assert.equal(evidence.otherWork, '');\n  assert.equal(evidence.nextUserAction, 'none');\n});\n\ntest('degraded mode omits fixed time-unavailable filler', () => {\n  assert.doesNotMatch(\n    contract,\n    /具体的な所要時間：実行環境の制約により表示できません。/\n  );\n\n  const evidence = parseExecutionCardEvidence(validDegradedArgs(), {});\n  assert.equal(evidence.mode, 'degraded');\n  assert.equal(evidence.total, '');\n  assert.equal(evidence.reason, '');\n  assert.equal(evidence.workload, 'medium');\n  assert.equal(evidence.otherWork, '');\n  assert.equal(evidence.nextUserAction, 'none');\n});`
);

await replaceExact(
  'tests/execution-turn-card-gate.test.mjs',
  `  assert.match(runtimeGate, /version: 5/);`,
  `  assert.match(runtimeGate, /version: 6/);`
);

await replaceExact(
  'tests/work-execution-preflight.test.mjs',
  `      '--card-workload=medium',\n      '--card-other-work=allowed',\n      '--card-next-user-action=none'`,
  `      '--card-workload=medium',\n      '--card-next-user-action=none'`
);

await replaceExact(
  'tests/work-execution-preflight.test.mjs',
  `      workload: 'medium',\n      otherWork: 'allowed',\n      nextUserAction: 'none',\n      reason: ''`,
  `      workload: 'medium',\n      otherWork: '',\n      nextUserAction: 'none',\n      reason: ''`
);

await replaceExact(
  'tests/work-execution-preflight.test.mjs',
  `      '--card-workload=medium',\n      '--card-other-work=allowed',\n      '--card-next-user-action=none',\n      '--card-reason=host-policy'`,
  `      '--card-workload=medium',\n      '--card-next-user-action=none'`
);

await replaceExact(
  'tests/work-execution-preflight.test.mjs',
  `      workload: 'medium',\n      otherWork: 'allowed',\n      nextUserAction: 'none',\n      reason: 'host-policy'`,
  `      workload: 'medium',\n      otherWork: '',\n      nextUserAction: 'none',\n      reason: ''`
);

const forbidden = '具体的な所要時間：実行環境の制約により表示できません。';
for (const path of [
  'docs/EXECUTION-TURN-CARD-GATE.md',
  'docs/WORK-EXECUTION-PREFLIGHT.md',
  'AGENTS.md',
  'docs/AUTOMATION-CONTINUATION-GATE.md',
  'tests/execution-turn-card-gate.test.mjs'
]) {
  const source = await readFile(path, 'utf8');
  if (source.includes(forbidden)) {
    throw new Error(`Fixed time-unavailable filler still present in ${path}`);
  }
}

console.log('Execution-card signal-only policy applied.');
