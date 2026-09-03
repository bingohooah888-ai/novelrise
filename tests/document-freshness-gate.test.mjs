import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { URL } from 'node:url';

import {
  buildFastFreshnessManifest,
  extractDocumentReferences,
  indexRegistry,
  parseDocumentRegistry,
  validateSelectedCurrentDocuments,
  verifyCurrentReferences,
  verifyRegistryAtRef,
  verifyRegistryCoverage
} from '../scripts/document-freshness-lib.mjs';

const registrySource = readFileSync(
  new URL('../docs/DOCUMENT-SOURCE-OF-TRUTH.md', import.meta.url),
  'utf8'
);
const registry = parseDocumentRegistry(registrySource);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function entry(path) {
  const found = registry.documents.find((item) => item.path === path);
  assert.ok(found, `fixture entry missing: ${path}`);
  return found;
}

test('registry defines one current MASTER and no first-PR delete candidates', () => {
  const indexed = indexRegistry(registry);
  assert.equal(registry.masterPath, 'docs/NOVELIGHT-MASTER.md');
  assert.deepEqual(indexed.currentByRole.get('master'), [
    'docs/NOVELIGHT-MASTER.md'
  ]);
  assert.deepEqual(registry.deleteCandidates, []);
  assert.deepEqual(registry.holdCandidates, []);
});

test('historical release records are archived while dated counsel handoff stays current', () => {
  assert.equal(
    entry('docs/BETA-RELEASE-EVIDENCE-2026-08-23.md').status,
    'ARCHIVED'
  );
  assert.equal(
    entry('docs/BETA-RELEASE-EVIDENCE-2026-08-26.md').status,
    'ARCHIVED'
  );
  assert.equal(
    entry('docs/BETA-RELEASE-DECISION-2026-08-28.md').status,
    'ARCHIVED'
  );
  assert.equal(
    entry('docs/LEGAL-COUNSEL-HANDOFF-2026-08-28.md').status,
    'CURRENT'
  );
});

test('old exposure spec is superseded by the trusted-receipt v2 spec', () => {
  const old = entry('docs/exposure-allocation-beta.md');
  assert.equal(old.status, 'SUPERSEDED');
  assert.equal(old.supersededBy, 'docs/exposure-allocation-beta-v2.md');
  assert.equal(entry(old.supersededBy).status, 'CURRENT');
});

test('archived or superseded files cannot be selected as Current State', () => {
  assert.throws(
    () =>
      validateSelectedCurrentDocuments(registry, [
        'docs/BETA-RELEASE-EVIDENCE-2026-08-23.md'
      ]),
    /cannot be used as Current State/
  );
  assert.throws(
    () =>
      validateSelectedCurrentDocuments(registry, [
        'docs/exposure-allocation-beta.md'
      ]),
    /cannot be used as Current State/
  );
});

test('duplicate current singleton role fails closed', () => {
  const broken = clone(registry);
  broken.documents.push({
    path: 'docs/MASTER-backup.md',
    status: 'CURRENT',
    role: 'master',
    singletonRole: true,
    classification: 'CURRENT_CANDIDATE',
    historicalReferences: []
  });
  assert.throws(
    () => indexRegistry(broken),
    /Singleton role master|MASTER Source of Truth/
  );
});

test('superseded document without a current same-role successor fails closed', () => {
  const broken = clone(registry);
  const successor = broken.documents.find(
    (item) => item.path === 'docs/exposure-allocation-beta-v2.md'
  );
  successor.status = 'ARCHIVED';
  assert.throws(() => indexRegistry(broken), /successor must be CURRENT/);
});

test('registry enumeration of archived and superseded entries is not treated as a Current State dependency', () => {
  const files = new Map(registry.documents.map((item) => [item.path, '']));
  files.set('docs/DOCUMENT-SOURCE-OF-TRUTH.md', registrySource);
  const errors = verifyCurrentReferences({
    registry,
    readText: (path) => files.get(path),
    exists: (path) => files.has(path)
  });
  assert.deepEqual(errors, []);
});

test('registry coverage detects unregistered formal docs and missing registered docs', () => {
  const formal = registry.documents.map((item) => item.path);
  let errors = verifyRegistryCoverage({
    registry,
    formalPaths: [...formal, 'docs/UNREGISTERED.md']
  });
  assert.ok(errors.some((message) => message.includes('UNREGISTERED')));
  errors = verifyRegistryCoverage({
    registry,
    formalPaths: formal.filter((path) => path !== 'docs/NOVELIGHT-ADMIN.md')
  });
  assert.ok(errors.some((message) => message.includes('NOVELIGHT-ADMIN')));
});

test('current references reject archived dependencies unless explicitly historical', () => {
  const miniature = {
    schemaVersion: 1,
    registryStatus: 'CURRENT',
    registryPath: 'docs/DOCUMENT-SOURCE-OF-TRUTH.md',
    masterPath: 'docs/NOVELIGHT-MASTER.md',
    startupRequiredCurrent: ['docs/NOVELIGHT-MASTER.md'],
    documents: [
      {
        path: 'docs/NOVELIGHT-MASTER.md',
        status: 'CURRENT',
        role: 'master',
        singletonRole: true,
        historicalReferences: []
      },
      {
        path: 'docs/HISTORY.md',
        status: 'ARCHIVED',
        role: 'history',
        singletonRole: false,
        historicalReferences: []
      }
    ]
  };
  const files = new Map([
    ['docs/NOVELIGHT-MASTER.md', 'Current basis: `docs/HISTORY.md`'],
    ['docs/HISTORY.md', 'historical']
  ]);
  let errors = verifyCurrentReferences({
    registry: miniature,
    readText: (path) => files.get(path),
    exists: (path) => files.has(path)
  });
  assert.equal(errors.length, 1);
  miniature.documents[0].historicalReferences = ['docs/HISTORY.md'];
  errors = verifyCurrentReferences({
    registry: miniature,
    readText: (path) => files.get(path),
    exists: (path) => files.has(path)
  });
  assert.deepEqual(errors, []);
});

test('missing current document references fail structural verification', () => {
  const miniature = clone(registry);
  const master = miniature.documents.find(
    (item) => item.path === miniature.masterPath
  );
  master.historicalReferences = [];
  const files = new Map(miniature.documents.map((item) => [item.path, '']));
  files.set(miniature.masterPath, 'Use `docs/DOES-NOT-EXIST.md`.');
  const errors = verifyCurrentReferences({
    registry: miniature,
    readText: (path) => files.get(path),
    exists: (path) => files.has(path)
  });
  assert.ok(errors.some((message) => message.includes('DOES-NOT-EXIST')));
});

test('LATEST in a filename grants no authority outside registry status', () => {
  const miniature = clone(registry);
  miniature.documents.push({
    path: 'docs/FAKE-LATEST.md',
    status: 'ARCHIVED',
    role: 'fake-history',
    singletonRole: false,
    classification: 'ARCHIVE_CANDIDATE',
    historicalReferences: []
  });
  assert.throws(
    () => validateSelectedCurrentDocuments(miniature, ['docs/FAKE-LATEST.md']),
    /cannot be used as Current State/
  );
});

test('fast manifest records exact main, registry, MASTER and selected guide blobs', () => {
  const blobs = new Map(
    registry.documents.map((item, index) => [
      item.path,
      index.toString(16).padStart(40, '0')
    ])
  );
  blobs.set('docs/DOCUMENT-SOURCE-OF-TRUTH.md', 'f'.repeat(40));
  const manifest = buildFastFreshnessManifest({
    registrySource,
    mainSha: 'a'.repeat(40),
    selectedPaths: ['docs/STAGING-RUNBOOK.md'],
    resolveBlob: (path) => blobs.get(path)
  });
  assert.equal(manifest.mainSha, 'a'.repeat(40));
  assert.equal(manifest.registry.status, 'CURRENT');
  assert.equal(manifest.master.path, 'docs/NOVELIGHT-MASTER.md');
  assert.equal(manifest.master.status, 'CURRENT');
  assert.ok(
    manifest.selectedDocuments.some(
      (item) => item.path === 'docs/STAGING-RUNBOOK.md'
    )
  );
});

test('document reference extraction is bounded to formal markdown paths', () => {
  assert.deepEqual(
    extractDocumentReferences(
      'See `docs/ONE.md`, [two](docs/TWO.md), AGENTS.md and src/app.js.'
    ),
    ['docs/ONE.md', 'docs/TWO.md', 'AGENTS.md']
  );
});

function sh(cwd, args) {
  return execFileSync(args[0], args.slice(1), { cwd, encoding: 'utf8' }).trim();
}

function write(root, path, content) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

test(
  'verify mode detects repo/document registry drift without mutating files',
  { concurrency: false },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'novelight-doc-freshness-'));
    sh(root, ['git', 'init', '-q']);
    sh(root, ['git', 'config', 'user.email', 'fixture@example.com']);
    sh(root, ['git', 'config', 'user.name', 'fixture']);
    const mini = {
      schemaVersion: 1,
      registryStatus: 'CURRENT',
      registryPath: 'docs/DOCUMENT-SOURCE-OF-TRUTH.md',
      masterPath: 'docs/NOVELIGHT-MASTER.md',
      startupRequiredCurrent: [
        'docs/NOVELIGHT-MASTER.md',
        'docs/DOCUMENT-SOURCE-OF-TRUTH.md'
      ],
      deleteCandidates: [],
      holdCandidates: [],
      documents: [
        {
          path: 'docs/DOCUMENT-SOURCE-OF-TRUTH.md',
          status: 'CURRENT',
          role: 'document-source-of-truth-registry',
          singletonRole: true,
          historicalReferences: []
        },
        {
          path: 'docs/NOVELIGHT-MASTER.md',
          status: 'CURRENT',
          role: 'master',
          singletonRole: true,
          historicalReferences: []
        }
      ]
    };
    const miniSource = `# registry\n${'<!-- NOVELIGHT_DOCUMENT_REGISTRY_BEGIN -->'}\n\`\`\`json\n${JSON.stringify(mini, null, 2)}\n\`\`\`\n${'<!-- NOVELIGHT_DOCUMENT_REGISTRY_END -->'}\n`;
    write(root, 'docs/DOCUMENT-SOURCE-OF-TRUTH.md', miniSource);
    write(root, 'docs/NOVELIGHT-MASTER.md', '# master\n');
    sh(root, ['git', 'add', '.']);
    sh(root, ['git', 'commit', '-qm', 'fixture']);
    const before = sh(root, ['git', 'status', '--porcelain']);
    const previous = process.cwd();
    process.chdir(root);
    try {
      const result = verifyRegistryAtRef('HEAD');
      assert.equal(result.formalDocumentCount, 2);
    } finally {
      process.chdir(previous);
    }
    const after = sh(root, ['git', 'status', '--porcelain']);
    assert.equal(before, '');
    assert.equal(after, '');

    write(root, 'docs/UNREGISTERED.md', '# unregistered\n');
    sh(root, ['git', 'add', '.']);
    sh(root, ['git', 'commit', '-qm', 'add unregistered']);
    process.chdir(root);
    try {
      assert.throws(() => verifyRegistryAtRef('HEAD'), /lacks registry status/);
    } finally {
      process.chdir(previous);
    }
  }
);

test(
  'runtime wrapper reuses already-fetched origin/main and persists compact freshness basis',
  { concurrency: false },
  () => {
    const root = mkdtempSync(
      join(tmpdir(), 'novelight-runtime-doc-freshness-')
    );
    sh(root, ['git', 'init', '-q']);
    sh(root, ['git', 'config', 'user.email', 'fixture@example.com']);
    sh(root, ['git', 'config', 'user.name', 'fixture']);
    sh(root, [
      'git',
      'remote',
      'add',
      'origin',
      'https://example.invalid/novelight.git'
    ]);

    for (const item of registry.documents) {
      if (item.path === 'docs/DOCUMENT-SOURCE-OF-TRUTH.md') {
        write(root, item.path, registrySource);
      } else {
        write(root, item.path, `# ${item.path}\n`);
      }
    }
    const scriptRoot = join(root, 'scripts');
    mkdirSync(scriptRoot, { recursive: true });
    writeFileSync(
      join(scriptRoot, 'document-freshness-lib.mjs'),
      readFileSync(
        new URL('../scripts/document-freshness-lib.mjs', import.meta.url),
        'utf8'
      ),
      'utf8'
    );
    writeFileSync(
      join(scriptRoot, 'runtime-gate-entry.mjs'),
      readFileSync(
        new URL('../scripts/runtime-gate-entry.mjs', import.meta.url),
        'utf8'
      ),
      'utf8'
    );
    writeFileSync(
      join(scriptRoot, 'runtime-execution-gate.mjs'),
      `import { execFileSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\nconst gitDir = execFileSync('git',['rev-parse','--git-dir'],{encoding:'utf8'}).trim();\nwriteFileSync(join(gitDir,'novelight-runtime-gate.json'), JSON.stringify({version:11})+'\\n');\n`,
      'utf8'
    );
    sh(root, ['git', 'add', '.']);
    sh(root, ['git', 'commit', '-qm', 'fixture']);
    const head = sh(root, ['git', 'rev-parse', 'HEAD']);
    sh(root, ['git', 'update-ref', 'refs/remotes/origin/main', head]);

    const output = execFileSync(
      process.execPath,
      ['scripts/runtime-gate-entry.mjs', '--phase=start'],
      {
        cwd: root,
        encoding: 'utf8'
      }
    );
    assert.equal(output, '');
    const state = JSON.parse(
      readFileSync(join(root, '.git', 'novelight-runtime-gate.json'), 'utf8')
    );
    assert.equal(state.version, 12);
    assert.equal(state.documentFreshness.mainSha, head);
    assert.equal(
      state.documentFreshness.master.path,
      'docs/NOVELIGHT-MASTER.md'
    );
    assert.equal(state.documentFreshness.registry.status, 'CURRENT');
  }
);
