import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const cli = resolve('scripts/release-artifact.mjs');
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const write = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const sha = 'a'.repeat(40),
  tree = 'b'.repeat(40),
  head = 'c'.repeat(40);
const environment = () => ({
  ...process.env,
  REVIEWED_SOURCE_SHA: sha,
  RELEASE_VERSION: '0.1.0',
  REVIEWED_ARCHIVE_SHA256: '',
  REVIEWER_APP_ID: '101',
  REVIEWER_BOT_ID: '202',
  REVIEWER_BOT_LOGIN: 'independent-review[bot]',
  TRUSTED_PUBLISHER_ID: 'trusted-config',
});
const invoke = (args, env) => spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ai-plugin-tools-release-'));
  const candidate = join(root, 'candidate'),
    providers = join(root, 'providers');
  mkdirSync(candidate);
  mkdirSync(providers);
  const pkg = join(root, 'package');
  mkdirSync(join(pkg, 'dist'), { recursive: true });
  const manifest = {
    name: '@aviaratech/ai-plugin-tools',
    version: '0.1.0',
    type: 'module',
    engines: { node: '>=24 <25 || 26.2.0' },
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
  };
  write(join(pkg, 'package.json'), manifest);
  writeFileSync(join(pkg, 'README.md'), 'synthetic\n');
  writeFileSync(join(pkg, 'LICENSE'), 'MIT\n');
  const members = ['package/package.json', 'package/README.md', 'package/LICENSE'];
  for (const file of ['index', 'marketplace', 'nativePluginArgs'])
    for (const extension of ['js', 'd.ts']) {
      const name = 'dist/' + file + '.' + extension;
      writeFileSync(join(pkg, name), 'export {};\n');
      members.push('package/' + name);
    }
  const archiveName = 'aviaratech-ai-plugin-tools-0.1.0.tgz';
  execFileSync('tar', ['-czf', join(candidate, archiveName), '-C', root, ...members]);
  const bytes = readFileSync(join(candidate, archiveName));
  write(join(candidate, 'source-lock.json'), { lockfileVersion: 3 });
  writeFileSync(join(candidate, 'checks.log'), 'synthetic checks passed\n');
  writeFileSync(join(candidate, 'secrets.json'), '[]\n');
  const producer = {
    schemaVersion: 1,
    repository: 'aviaratech/ai-plugin-tools',
    version: '0.1.0',
    sourceSha: sha,
    sourceTree: tree,
    lockSHA256: hash(readFileSync(join(candidate, 'source-lock.json'))),
    archiveName,
    archiveSHA256: hash(bytes),
    archiveIntegrity: 'sha512-' + hash(bytes, 'sha512', 'base64'),
    consumerSHA256: 'd'.repeat(64),
    typeFixtureSHA256: 'e'.repeat(64),
    toolchain: { node: 'v24.21.0', npm: '11.19.0' },
    checks: { exitCode: 0, logSHA256: hash(readFileSync(join(candidate, 'checks.log'))) },
    secrets: { exitCode: 0, reportSHA256: hash(readFileSync(join(candidate, 'secrets.json'))) },
  };
  write(join(candidate, 'producer.json'), producer);
  for (const nodeVersion of ['v24.0.0', 'v24.21.0', 'v26.2.0']) {
    const directory = join(candidate, nodeVersion.slice(1));
    mkdirSync(directory);
    write(join(directory, 'consumer.json'), {
      identity: {
        schemaVersion: 1,
        sourceSha: sha,
        sourceTree: tree,
        lockSHA256: producer.lockSHA256,
        archiveSHA256: producer.archiveSHA256,
        archiveIntegrity: producer.archiveIntegrity,
        nodeVersion,
        nodeExecutableSHA256: 'f'.repeat(64),
        consumerSHA256: producer.consumerSHA256,
        typeFixtureSHA256: producer.typeFixtureSHA256,
      },
      passed: true,
      cleanup: { complete: true, root: '/synthetic/removed' },
    });
    write(join(directory, 'execution.json'), {
      identity: read(join(directory, 'consumer.json')).identity,
      exitCode: 0,
    });
  }
  write(join(providers, 'observation.json'), { repository: producer.repository, observedAt: new Date().toISOString() });
  write(join(providers, 'main.json'), { sha, commit: { tree: { sha: tree } } });
  write(join(providers, 'pr.json'), {
    number: 2,
    merged: true,
    merge_commit_sha: sha,
    base: { ref: 'main', repo: { full_name: producer.repository } },
    head: { sha: head },
    user: { login: 'operator' },
  });
  write(join(providers, 'head.json'), { sha: head, tree: { sha: tree } });
  write(join(providers, 'review-decision.json'), {
    data: { repository: { pullRequest: { reviewDecision: 'APPROVED' } } },
  });
  write(join(providers, 'reviews.json'), [
    {
      id: 1,
      node_id: 'review-node',
      state: 'APPROVED',
      commit_id: head,
      user: { id: 202, login: 'independent-review[bot]', type: 'Bot' },
    },
  ]);
  write(join(providers, 'app-review-eligibility.json'), {
    data: {
      node: {
        id: 'review-node',
        fullDatabaseId: 1,
        state: 'APPROVED',
        authorCanPushToRepository: true,
        author: { login: 'independent-review' },
        commit: { oid: head },
        pullRequest: { number: 2, headRefOid: head, baseRepository: { nameWithOwner: producer.repository } },
      },
    },
  });
  write(join(providers, 'protection.json'), {
    required_status_checks: { strict: true, contexts: ['checks', 'secrets'] },
    required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true },
    enforce_admins: { enabled: true },
    required_linear_history: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  });
  write(join(providers, 'checks.json'), {
    check_runs: ['checks', 'secrets'].map((name, i) => ({
      id: i + 1,
      name,
      head_sha: sha,
      status: 'completed',
      conclusion: 'success',
      app: { slug: 'github-actions' },
    })),
  });
  write(join(providers, 'registry.json'), { statusCode: 404, body: { error: 'E404' } });
  write(join(providers, 'publication-history.json'), { intents: [] });
  write(join(providers, 'package-registry.json'), {
    statusCode: 200,
    body: { name: manifest.name, maintainers: [{ name: 'aviaratech' }] },
  });
  write(join(providers, 'issue.json'), { state: 'open' });
  write(join(providers, 'publisher.json'), {
    package: manifest.name,
    repository: producer.repository,
    workflow: 'release.yml',
    environment: 'release',
    admitted: true,
    mode: 'oidc',
    actor: 'aviaratech',
    trustObservedAt: new Date().toISOString(),
    trust: {
      id: 'trusted-config',
      type: 'github',
      repository: producer.repository,
      file: 'release.yml',
      environment: 'release',
      permissions: ['createPackage'],
    },
    observedAt: new Date().toISOString(),
  });
  const env = { ...environment(), REVIEWED_ARCHIVE_SHA256: producer.archiveSHA256 };
  return { root, candidate, providers, producer, env, artifact: join(root, 'artifact') };
}

test('release artifact preserves the tested archive and original receipts', () => {
  const f = fixture();
  try {
    const selected = invoke(['select', f.candidate, f.artifact], f.env);
    assert.equal(selected.status, 0, selected.stderr);
    assert.deepEqual(
      readFileSync(join(f.artifact, f.producer.archiveName)),
      readFileSync(join(f.candidate, f.producer.archiveName)),
    );
    assert.deepEqual(
      readFileSync(join(f.artifact, '24.0.0/consumer.json')),
      readFileSync(join(f.candidate, '24.0.0/consumer.json')),
    );
    assert.equal(invoke(['verify', f.artifact], f.env).status, 0);
    assert.notEqual(invoke(['select', f.candidate, f.artifact], f.env).status, 0, 'conflicting output must refuse');
  } finally {
    rmSync(f.root, { recursive: true });
  }
});

test('release artifact refuses unaccepted candidates', () => {
  for (const mutate of [
    (f) => {
      const p = read(join(f.candidate, 'producer.json'));
      p.sourceSha = '0'.repeat(40);
      write(join(f.candidate, 'producer.json'), p);
    },
    (f) => writeFileSync(join(f.candidate, f.producer.archiveName), 'corrupt'),
    (f) => writeFileSync(join(f.candidate, 'source-lock.json'), 'changed'),
    (f) => rmSync(join(f.candidate, '24.0.0/consumer.json')),
    (f) => rmSync(join(f.candidate, '24.21.0/execution.json')),
    (f) => {
      const p = read(join(f.candidate, '24.21.0/execution.json'));
      p.exitCode = 1;
      write(join(f.candidate, '24.21.0/execution.json'), p);
    },
    (f) => {
      const p = read(join(f.candidate, '26.2.0/consumer.json'));
      p.cleanup.complete = false;
      write(join(f.candidate, '26.2.0/consumer.json'), p);
    },
    (f) => {
      const p = read(join(f.candidate, 'producer.json'));
      p.toolchain.npm = '0';
      write(join(f.candidate, 'producer.json'), p);
    },
    (f) => {
      const p = read(join(f.candidate, 'producer.json'));
      p.checks.exitCode = 1;
      write(join(f.candidate, 'producer.json'), p);
    },
    (f) => rmSync(join(f.candidate, 'secrets.json')),
  ]) {
    const f = fixture();
    try {
      mutate(f);
      assert.notEqual(invoke(['select', f.candidate, f.artifact], f.env).status, 0);
    } finally {
      rmSync(f.root, { recursive: true });
    }
  }
});

test('admit rejects stale, author-only, dismissed, drifted and unknown provider states', () => {
  const cases = [
    ['observation.json', (x) => ({ ...x, observedAt: '2000-01-01T00:00:00Z' })],
    ['reviews.json', () => []],
    ['reviews.json', (x) => [{ ...x[0], user: { ...x[0].user, login: 'operator' } }]],
    ['reviews.json', (x) => [{ ...x[0], user: { ...x[0].user, id: 999 } }]],
    ['reviews.json', (x) => [{ ...x[0], user: { ...x[0].user, type: 'User' } }]],
    ['reviews.json', (x) => [{ ...x[0], state: 'DISMISSED' }]],
    ['app-review-eligibility.json', (x) => ({ data: { node: { ...x.data.node, authorCanPushToRepository: false } } })],
    ['app-review-eligibility.json', (x) => ({ data: { node: { ...x.data.node, authorCanPushToRepository: null } } })],
    ['app-review-eligibility.json', (x) => ({ data: { node: { ...x.data.node, fullDatabaseId: 99 } } })],
    ['app-review-eligibility.json', (x) => ({ data: { node: { ...x.data.node, id: 'wrong-node' } } })],
    ['app-review-eligibility.json', (x) => ({ data: { node: { ...x.data.node, author: { login: 'other' } } } })],
    ['app-review-eligibility.json', () => ({ data: { node: null }, errors: [{ message: 'denied' }] })],
    [
      'app-review-eligibility.json',
      (x) => ({ data: { node: { ...x.data.node, pullRequest: { ...x.data.node.pullRequest, number: 3 } } } }),
    ],
    ['main.json', (x) => ({ ...x, sha: '0'.repeat(40) })],
    ['head.json', (x) => ({ ...x, tree: { sha: '0'.repeat(40) } })],
    ['checks.json', (x) => ({ check_runs: [{ ...x.check_runs[0], conclusion: 'failure' }] })],
    ['protection.json', (x) => ({ ...x, enforce_admins: { enabled: false } })],
    ['registry.json', () => ({ statusCode: 401, body: {} })],
    ['registry.json', () => ({ statusCode: 200, body: { version: '0.1.0', dist: { integrity: 'conflict' } } })],
    ['publisher.json', (x) => ({ ...x, admitted: false })],
    ['publication-history.json', () => ({ intents: [{ id: 123, expired: false }] })],
  ];
  for (const [file, mutate] of cases) {
    const f = fixture();
    try {
      cpSync(f.candidate, f.artifact, { recursive: true });
      write(join(f.providers, file), mutate(read(join(f.providers, file))));
      const result = invoke(['admit', f.artifact, f.providers], f.env);
      assert.notEqual(result.status, 0, file);
      assert(!['publish-once', 'readback-only'].includes(result.stdout.trim()), file);
    } finally {
      rmSync(f.root, { recursive: true });
    }
  }
});

test('another maintainer approval cannot make the configured App approval count', () => {
  const f = fixture();
  try {
    const eligibility = read(join(f.providers, 'app-review-eligibility.json'));
    eligibility.data.node.authorCanPushToRepository = false;
    write(join(f.providers, 'app-review-eligibility.json'), eligibility);
    const reviews = read(join(f.providers, 'reviews.json'));
    reviews.push({ id: 2, state: 'APPROVED', commit_id: head, user: { id: 303, login: 'maintainer', type: 'User' } });
    write(join(f.providers, 'reviews.json'), reviews);
    const result = invoke(['admit', f.candidate, f.providers], f.env);
    assert.notEqual(result.status, 0, 'aggregate APPROVED cannot substitute for counted App eligibility');
    assert.match(result.stderr, /configured App approval does not count/);
  } finally {
    rmSync(f.root, { recursive: true });
  }
});

test('configured counted review is sufficient without App-directory responses', () => {
  const f = fixture();
  try {
    rmSync(join(f.providers, 'reviewer-app.json'), { force: true });
    rmSync(join(f.providers, 'reviewer-bot.json'), { force: true });
    const result = invoke(['admit', f.candidate, f.providers], f.env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'publish-once');
    const mismatch = invoke(['admit', f.candidate, f.providers], {
      ...f.env,
      REVIEWER_BOT_LOGIN: 'another-reviewer[bot]',
    });
    assert.notEqual(mismatch.status, 0, 'configured login must match the actual review');
  } finally {
    rmSync(f.root, { recursive: true });
  }
});

test('historical setup uses the exact saved trust while live observations remain fresh', () => {
  const cases = [
    { accepted: true, change: () => {} },
    { accepted: false, change: (x) => (x.trust.id = 'another-saved-config') },
    { accepted: false, change: (x) => (x.trustObservedAt = 'not-a-date') },
    { accepted: false, change: (x) => (x.observedAt = null) },
    { accepted: false, change: (x) => (x.trustObservedAt = '2999-01-01T00:00:00Z') },
    { accepted: false, change: (x) => (x.observedAt = '2999-01-01T00:00:00Z') },
  ];
  for (const [index, { accepted, change }] of cases.entries()) {
    const f = fixture();
    try {
      const publisher = read(join(f.providers, 'publisher.json'));
      publisher.observedAt = publisher.trustObservedAt = '2026-01-01T00:00:00Z';
      change(publisher);
      write(join(f.providers, 'publisher.json'), publisher);
      const result = invoke(['admit', f.candidate, f.providers], f.env);
      assert.equal(result.status === 0, accepted, 'historical setup case ' + index + ': ' + result.stderr);
      assert.equal(result.stdout.trim() === 'publish-once', accepted);
      if (accepted) {
        write(join(f.providers, 'observation.json'), {
          repository: f.producer.repository,
          observedAt: '2026-01-01T00:00:00Z',
        });
        assert.notEqual(invoke(['admit', f.candidate, f.providers], f.env).status, 0, 'stale live read must stop');
      }
    } finally {
      rmSync(f.root, { recursive: true });
    }
  }
});

test('an otherwise valid publisher cannot substitute another saved trust configuration', () => {
  const f = fixture();
  try {
    const publisher = read(join(f.providers, 'publisher.json'));
    publisher.trust.id = 'another-saved-config';
    write(join(f.providers, 'publisher.json'), publisher);
    const result = invoke(['admit', f.candidate, f.providers], f.env);
    assert.notEqual(result.status, 0, 'another nonempty configuration ID must not be admitted');
  } finally {
    rmSync(f.root, { recursive: true });
  }
});

test('guarded single-publisher sequence never retries ambiguous or existing publication', () => {
  const f = fixture();
  try {
    cpSync(f.candidate, f.artifact, { recursive: true });
    const attempts = join(f.root, 'attempts');
    const sequence = () => {
      const admission = invoke(['admit', f.artifact, f.providers], f.env);
      if (admission.status === 0 && admission.stdout.trim() === 'publish-once') {
        return spawnSync(process.execPath, [
          '-e',
          "require('node:fs').appendFileSync(process.argv[1], 'attempt\\n'); process.exit(1);",
          attempts,
        ]);
      }
      return admission;
    };
    assert.notEqual(sequence().status, 0, 'synthetic ambiguous publisher exits nonzero');
    assert.equal(readFileSync(attempts, 'utf8'), 'attempt\n');
    write(join(f.providers, 'publication-history.json'), { intents: [{ id: 123 }] });
    assert.notEqual(sequence().status, 0);
    assert.equal(readFileSync(attempts, 'utf8'), 'attempt\n');
    write(join(f.providers, 'registry.json'), {
      statusCode: 200,
      body: {
        name: '@aviaratech/ai-plugin-tools',
        version: '0.1.0',
        gitHead: sha,
        dist: {
          integrity: f.producer.archiveIntegrity,
          signatures: [{}],
          attestations: { url: 'https://registry.npmjs.org/example' },
        },
      },
    });
    const readback = sequence();
    assert.equal(readback.status, 0, readback.stderr);
    assert.equal(readback.stdout.trim(), 'readback-only');
    assert.equal(readFileSync(attempts, 'utf8'), 'attempt\n');
    assert(existsSync(join(f.artifact, f.producer.archiveName)));
  } finally {
    rmSync(f.root, { recursive: true });
  }
});

test('OIDC admits an absent target only for an existing owned package and exact admitted trust', () => {
  const cases = [
    { accepted: true, mutate: () => {} },
    ...[401, 403, 404].map((statusCode) => ({
      accepted: false,
      mutate: (f) => write(join(f.providers, 'package-registry.json'), { statusCode, body: {} }),
    })),
    ...[
      (x) => ({ ...x, body: { ...x.body, name: '@other/ai-plugin-tools' } }),
      (x) => ({ ...x, body: { ...x.body, maintainers: [] } }),
      (x) => ({ ...x, body: { ...x.body, maintainers: [{ name: 'other-owner' }] } }),
    ].map((change) => ({
      accepted: false,
      mutate: (f) =>
        write(join(f.providers, 'package-registry.json'), change(read(join(f.providers, 'package-registry.json')))),
    })),
    ...[
      (x) => ({ ...x, mode: 'bootstrap' }),
      (x) => ({ ...x, actor: 'other-owner' }),
      (x) => ({ ...x, trust: undefined }),
      (x) => ({ ...x, trustObservedAt: 'invalid' }),
      (x) => ({ ...x, observedAt: 'invalid' }),
      ...[
        { id: '' },
        { type: 'gitlab' },
        { repository: 'other/repository' },
        { file: 'other.yml' },
        { environment: 'other' },
        { permissions: ['createStagedPackage'] },
        { permissions: 'createPackage' },
      ].map((change) => (x) => ({ ...x, trust: { ...x.trust, ...change } })),
    ].map((change) => ({
      accepted: false,
      mutate: (f) => write(join(f.providers, 'publisher.json'), change(read(join(f.providers, 'publisher.json')))),
    })),
    { accepted: false, mutate: (f) => rmSync(join(f.providers, 'package-registry.json')) },
  ];
  for (const [index, item] of cases.entries()) {
    const f = fixture();
    try {
      item.mutate(f);
      const result = invoke(['admit', f.candidate, f.providers], f.env);
      assert.equal(result.status === 0, item.accepted, 'case ' + index + result.stderr);
      assert.equal(result.stdout.trim() === 'publish-once', item.accepted);
    } finally {
      rmSync(f.root, { recursive: true });
    }
  }
});

test('admit recognizes exact target-version absence and refuses other registry responses', () => {
  const cases = [
    { name: 'actual npm missing-version response', statusCode: 404, body: 'version not found: 0.1.0', accepted: true },
    { name: 'another version', statusCode: 404, body: 'version not found: 0.2.0', accepted: false },
    { name: 'unknown message', statusCode: 404, body: 'Not Found', accepted: false },
    { name: 'empty body', statusCode: 404, body: null, accepted: false },
    { name: 'unknown object', statusCode: 404, body: { error: 'unavailable' }, accepted: false },
    { name: 'unauthenticated', statusCode: 401, body: 'version not found: 0.1.0', accepted: false },
    { name: 'forbidden', statusCode: 403, body: 'version not found: 0.1.0', accepted: false },
    { name: 'provider failure', statusCode: 500, body: 'version not found: 0.1.0', accepted: false },
  ];
  for (const { name, statusCode, body, accepted } of cases) {
    const f = fixture();
    try {
      write(join(f.providers, 'registry.json'), { statusCode, body });
      const result = invoke(['admit', f.candidate, f.providers], f.env);
      assert.equal(result.status === 0, accepted, name + ': ' + result.stderr);
      assert.equal(result.stdout.trim() === 'publish-once', accepted, name);
    } finally {
      rmSync(f.root, { recursive: true });
    }
  }
});

test('publish workflow environment loads npm config before retaining an intent', () => {
  const root = mkdtempSync(join(tmpdir(), 'ai-plugin-tools-npm-config-'));
  try {
    const workflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8').split('\n  publish:\n')[1];
    const [job, steps] = workflow.split('    steps:\n');
    const jobEnvironment = job.match(/^    env:\n((?:      .*\n)+)/m)?.[1];
    assert(jobEnvironment, 'publish job must declare its global npm config');
    assert.doesNotMatch(jobEnvironment, /\$\{\{\s*runner\b/, 'runner context is unavailable in job-level env');
    const globals = [...jobEnvironment.matchAll(/^      NPM_CONFIG_GLOBALCONFIG: (.+)$/gm)];
    assert.equal(globals.length, 1, 'publish global config must have one unambiguous value');
    const initializer = steps.match(
      /^      - name: Initialize isolated npm configuration\n        shell: bash\n        run: \|\n((?:          .*\n)+)/,
    );
    assert(initializer, 'isolated npm config must initialize before other publish steps');
    const environmentFile = join(root, 'github-env');
    const initialize = spawnSync(
      'bash',
      ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', initializer[1].replace(/^          /gm, '')],
      {
        cwd: root,
        env: { PATH: process.env.PATH, RUNNER_TEMP: root, GITHUB_ENV: environmentFile },
        encoding: 'utf8',
      },
    );
    assert.equal(initialize.status, 0, initialize.stderr);
    const exported = readFileSync(environmentFile, 'utf8').trim().split('\n');
    assert.equal(exported.length, 1, 'initializer must emit exactly one npm user config');
    assert(exported[0].startsWith('NPM_CONFIG_USERCONFIG='));
    const env = {
      PATH: process.env.PATH,
      NPM_CONFIG_CACHE: join(root, 'cache'),
      NPM_CONFIG_USERCONFIG: exported[0].slice('NPM_CONFIG_USERCONFIG='.length),
      NPM_CONFIG_GLOBALCONFIG: globals[0][1],
    };
    assert.equal(env.NPM_CONFIG_USERCONFIG, join(root, 'npm-oidc-user.npmrc'));
    assert.notEqual(env.NPM_CONFIG_USERCONFIG, env.NPM_CONFIG_GLOBALCONFIG);
    const result = spawnSync('npm', ['config', 'get', 'registry', '--logs-max=0'], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'https://registry.npmjs.org/');
  } finally {
    rmSync(root, { recursive: true });
  }
});
