import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseExecutionCardEvidence } from "../scripts/runtime-execution-gate.mjs";

const agents = await readFile("AGENTS.md", "utf8");
const preflight = await readFile("docs/WORK-EXECUTION-PREFLIGHT.md", "utf8");
const continuation = await readFile(
  "docs/AUTOMATION-CONTINUATION-GATE.md",
  "utf8",
);
const contract = await readFile("docs/EXECUTION-TURN-CARD-GATE.md", "utf8");
const runtimeGate = await readFile(
  "scripts/runtime-execution-gate.mjs",
  "utf8",
);

function validTimedArgs() {
  return [
    "--card-visible",
    "--card-total=20-30m",
    "--card-steps=a,b,c",
    "--card-manual=0",
    "--card-wait=none",
  ];
}

test("all execution governance layers retain the first-visible-message rule", () => {
  for (const text of [agents, preflight, continuation]) {
    assert.match(text, /最初のユーザー可視メッセージ/);
    assert.match(text, /カード送信前.*ツール呼び出し.*禁止/s);
  }

  assert.match(contract, /Zero-tool rule/);
  assert.match(contract, /first visible message/i);
  assert.match(
    contract,
    /Adding the degraded explanation later in the turn is also invalid/,
  );
  assert.match(contract, /late card as invalid for that turn/);
});

test("degraded mode can never omit the time-omission explanation", () => {
  assert.match(contract, /時間見積もり：実行環境の上位制約により省略。/);

  assert.throws(
    () =>
      parseExecutionCardEvidence(
        [
          "--card-visible",
          "--card-mode=degraded",
          "--card-steps=a,b,c",
          "--card-manual=0",
          "--card-wait=none",
        ],
        {},
      ),
    /must include the omission reason/,
  );

  const evidence = parseExecutionCardEvidence(
    [
      "--card-visible",
      "--card-mode=degraded",
      "--card-steps=a,b,c",
      "--card-manual=0",
      "--card-wait=none",
      "--card-reason=higher-level execution constraint",
    ],
    {},
  );
  assert.equal(evidence.mode, "degraded");
  assert.equal(evidence.total, "");
  assert.equal(evidence.reason, "higher-level execution constraint");
});

test("timed mode still requires total estimated time", () => {
  const evidence = parseExecutionCardEvidence(validTimedArgs(), {});
  assert.equal(evidence.mode, "timed");
  assert.equal(evidence.total, "20-30m");

  assert.throws(
    () =>
      parseExecutionCardEvidence(
        validTimedArgs().filter((arg) => !arg.startsWith("--card-total=")),
        {},
      ),
    /must include total estimated time/,
  );
});

test("runtime gate treats the dedicated execution-card contract as authoritative", () => {
  assert.match(runtimeGate, /docs\/EXECUTION-TURN-CARD-GATE\.md/);
  assert.match(runtimeGate, /version: 3/);
});
