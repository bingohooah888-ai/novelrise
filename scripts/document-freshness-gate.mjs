import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  auditRegistryAtRef,
  parseSelectedGuideArgs,
  runFastFreshnessFromOriginMain,
  verifyRegistryAtRef
} from './document-freshness-lib.mjs';

function optionValue(argv, name) {
  const prefix = `--${name}=`;
  const value = argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : '';
}

export function runDocumentFreshnessGate(argv = process.argv.slice(2), env = process.env) {
  const mode = optionValue(argv, 'mode') || 'fast';
  if (mode === 'fast') {
    const result = runFastFreshnessFromOriginMain({
      selectedPaths: parseSelectedGuideArgs(argv, env),
      fetchMain: !argv.includes('--main-already-fetched')
    });
    console.log('NOVELIGHT Document Freshness Gate: PASS (fast)');
    console.log(`authoritative main: ${result.manifest.mainSha}`);
    console.log(`MASTER: ${result.manifest.master.path} [CURRENT] ${result.manifest.master.blob}`);
    console.log(`state: ${result.statePath}`);
    return result;
  }
  const ref = optionValue(argv, 'ref') || 'HEAD';
  if (mode === 'verify') {
    const result = verifyRegistryAtRef(ref);
    console.log('NOVELIGHT Document Freshness Gate: PASS (verify)');
    console.log(JSON.stringify(result));
    return result;
  }
  if (mode === 'audit') {
    const result = auditRegistryAtRef(ref);
    console.log('NOVELIGHT Document Freshness Gate: PASS (audit)');
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  throw new Error(`Unsupported Document Freshness Gate mode: ${mode}`);
}

const invoked = Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) {
  try {
    runDocumentFreshnessGate();
  } catch (error) {
    console.error(`NOVELIGHT Document Freshness Gate: FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
