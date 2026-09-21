import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { assertAllowedCommand, createSecurityConfig, resolveAllowedPath } from "../src/security.js";

test("path guard rejects traversal", () => {
  const root = path.resolve("test-root");
  const config = createSecurityConfig({ NOVELIGHT_COMMANDER_ROOT: root, NOVELIGHT_COMMANDER_COMMANDS: "git,node" });
  assert.equal(resolveAllowedPath("docs/a.txt", config), path.join(root, "docs", "a.txt"));
  assert.throws(() => resolveAllowedPath("../outside.txt", config), /outside/);
});

test("command allowlist blocks unknown executable", () => {
  const config = createSecurityConfig({ NOVELIGHT_COMMANDER_ROOT: path.resolve("test-root"), NOVELIGHT_COMMANDER_COMMANDS: "git,node" });
  assert.equal(assertAllowedCommand("git", config), "git");
  assert.throws(() => assertAllowedCommand("curl", config), /allowlisted/);
});
