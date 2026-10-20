import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

// Bounded package qualification only; no installer or public runtime API.
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const atomic = (file, value) => {
  const temp = file + '.' + randomUUID();
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temp, file);
};
const cleanEnv = () => {
  const env = { ...process.env };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  return env;
};
const processes = (group) =>
  execFileSync('ps', ['-axo', 'pid=,pgid=,lstart='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
    .filter((row) => row && Number(row[2]) === group)
    .map((row) => ({ pid: Number(row[1]), birth: row[3] }));

async function run(executable, args, cwd, signal) {
  const child = spawn(executable, args, { cwd, env: cleanEnv(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const owned = new Map();
  const observe = () => {
    for (const item of processes(child.pid)) owned.set(item.pid, item.birth);
  };
  let stdout = '';
  let stderr = '';
  let overflow = false;
  const stop = () => {
    observe();
    if (processes(child.pid).length) process.kill(-child.pid, 'SIGTERM');
  };
  const collect = (kind, chunk) => {
    if (kind === 'out') stdout += chunk;
    else stderr += chunk;
    if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 32 * 1024 ** 2) {
      overflow = true;
      stop();
    }
  };
  child.stdout.on('data', (chunk) => collect('out', chunk));
  child.stderr.on('data', (chunk) => collect('err', chunk));
  const closed = new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('close', (code) => accept(code));
  });
  observe();
  const monitor = setInterval(observe, 100);
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  let code;
  try {
    code = await closed;
  } finally {
    clearInterval(monitor);
    signal?.removeEventListener('abort', stop);
    const remaining = processes(child.pid);
    assert(
      remaining.every((item) => owned.get(item.pid) === item.birth),
      'child process identity changed',
    );
    if (remaining.length) {
      process.kill(-child.pid, 'SIGTERM');
      for (let i = 0; i < 100 && processes(child.pid).length; i++) await delay(50);
      if (processes(child.pid).length) {
        assert(processes(child.pid).every((item) => owned.get(item.pid) === item.birth));
        process.kill(-child.pid, 'SIGKILL');
      }
      for (let i = 0; i < 100 && processes(child.pid).length; i++) await delay(50);
    }
    assert.equal(processes(child.pid).length, 0, 'owned children remain');
  }
  assert(!overflow, 'command output exceeded limit');
  assert(!signal?.aborted, 'consumer cancelled');
  assert.equal(code, 0, 'child failed: ' + stdout + stderr);
  return { stdout, stderr };
}

function ownRoot(results) {
  const root = mkdtempSync(join(results, 'install-'));
  const stat = lstatSync(root);
  const owner = { root, device: stat.dev, inode: stat.ino, nonce: randomUUID() };
  atomic(join(root, 'owner.json'), owner);
  atomic(join(results, 'active-root.json'), owner);
  return owner;
}
function removeRoot(owner) {
  if (!existsSync(owner.root)) return;
  const stat = lstatSync(owner.root);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.dev === owner.device && stat.ino === owner.inode);
  assert.deepEqual(json(join(owner.root, 'owner.json')), owner);
  rmSync(owner.root, { recursive: true });
  assert(!existsSync(owner.root), 'owned install cleanup failed');
}
const inventory = (root) => readdirSync(root, { recursive: true }).map(String).sort();

async function consume(archive, results, expectedNode, producer, signal) {
  assert.equal(process.version, expectedNode, 'wrong selected runtime');
  assert(isAbsolute(results) && relative(source, results).startsWith('..'), 'results must be outside source');
  mkdirSync(results, { recursive: true, mode: 0o700 });
  assert.equal(realpathSync(results), results, 'results cannot be a symlink');
  const bytes = readFileSync(archive);
  const identity = {
    schemaVersion: 1,
    sourceSha: producer.sourceSha,
    sourceTree: producer.sourceTree,
    lockSHA256: producer.lockSHA256,
    archiveSHA256: sha(bytes),
    archiveIntegrity: producer.archiveIntegrity,
    nodeVersion: expectedNode,
    nodeExecutableSHA256: sha(readFileSync(process.execPath)),
    consumerSHA256: sha(readFileSync(fileURLToPath(import.meta.url))),
    typeFixtureSHA256: sha(readFileSync(join(source, 'tests/fixtures/type-consumer.ts'))),
  };
  assert.equal(identity.archiveSHA256, producer.archiveSHA256, 'archive integrity changed');
  assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), producer.archiveIntegrity);
  const receipt = join(results, 'consumer.json');
  if (existsSync(receipt)) {
    const prior = json(receipt);
    assert.deepEqual(prior.identity, identity, 'incompatible completed unit');
    assert.equal(prior.passed, true);
    assert.equal(prior.cleanup.complete, true);
    assert(!existsSync(prior.cleanup.root));
    return { reused: true, receipt: prior };
  }
  if (existsSync(join(results, 'active-root.json'))) {
    const stale = json(join(results, 'active-root.json'));
    assert(!existsSync(stale.root), 'prior install requires identity-safe recovery before retry');
  }
  const owner = ownRoot(results);
  let failure;
  try {
    const members = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n').sort();
    assert(
      members.every((name) => /^package\/(package.json|README.md|LICENSE|dist\/[a-zA-Z]+(\.d)?\.(js|ts))$/.test(name)),
      'unexpected archive members',
    );
    for (const member of [
      'package/package.json',
      'package/README.md',
      'package/LICENSE',
      'package/dist/index.js',
      'package/dist/index.d.ts',
    ])
      assert(members.includes(member), 'missing archive member: ' + member);
    writeFileSync(join(owner.root, 'package.json'), '{"private":true,"type":"module"}\n');
    writeFileSync(join(owner.root, 'empty.npmrc'), '');
    const npm = process.env.AI_PLUGIN_TOOLS_NPM_CLI;
    const controller = process.env.AI_PLUGIN_TOOLS_CONTROLLER;
    const compiler = process.env.AI_PLUGIN_TOOLS_TYPESCRIPT;
    assert(npm && controller && compiler, 'missing admitted controller/npm/TypeScript paths');
    await run(
      controller,
      [
        npm,
        'install',
        '--omit=dev',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--userconfig',
        join(owner.root, 'empty.npmrc'),
        archive,
      ],
      owner.root,
      signal,
    );
    const packageRoot = join(owner.root, 'node_modules/@aviaratech/ai-plugin-tools');
    assert.equal(realpathSync(packageRoot), packageRoot, 'checkout symlink refused');
    const manifest = json(join(packageRoot, 'package.json'));
    assert.equal(manifest.name, '@aviaratech/ai-plugin-tools');
    assert.equal(manifest.version, producer.version);
    assert.equal(manifest.type, 'module');
    assert.equal(manifest.engines.node, '>=24 <25 || 26.2.0');
    assert.deepEqual(manifest.exports, { '.': { types: './dist/index.d.ts', import: './dist/index.js' } });
    assert.deepEqual(manifest.dependencies ?? {}, {});
    assert.equal(manifest.bin, undefined);
    for (const entry of readdirSync(join(packageRoot, 'dist')))
      if (entry.endsWith('.js')) {
        const code = readFileSync(join(packageRoot, 'dist', entry), 'utf8');
        assert(
          !/\b(import\s*\(|process|console|require\s*\(|node:|globalThis|fetch\s*\()/m.test(code),
          'forbidden runtime capability',
        );
      }
    const script = join(owner.root, 'exercise.mjs');
    writeFileSync(
      script,
      [
        "import assert from 'node:assert/strict';",
        "import { createRequire } from 'node:module';",
        "import { realpathSync } from 'node:fs';",
        "const mod = await import('@aviaratech/ai-plugin-tools');",
        "assert.deepEqual(Object.keys(mod).sort(), ['marketplaceDocuments','nativePluginArgs']);",
        "assert.deepEqual(mod.nativePluginArgs({host:'codex',action:'update',pluginId:'opaque selector @ value',scope:'user'}), ['plugin','add','opaque selector @ value','--json']);",
        "for (const metadata of [{kind:'described',description:''},{kind:'interface-policy',displayName:'',policy:{installation:'',authentication:''},category:''}]) {",
        "const pair=mod.marketplaceDocuments({marketplaceName:'',pluginName:'',relativeSource:'',version:'',ownerName:'',metadata});",
        "assert.deepEqual(Object.keys(pair), ['codexDocument','claudeDocument']);",
        "assert.equal(pair.codexDocument.plugins[0].source.path,''); }",
        "const resolved=createRequire(import.meta.url).resolve('@aviaratech/ai-plugin-tools');",
        'assert(realpathSync(resolved).startsWith(' + JSON.stringify(packageRoot + '/') + '));',
      ].join('\n'),
    );
    const before = inventory(owner.root);
    const exercised = await run(
      process.execPath,
      ['--permission', '--allow-fs-read=' + owner.root, script],
      owner.root,
      signal,
    );
    assert.equal(exercised.stdout, '');
    assert.equal(exercised.stderr, '');
    assert.deepEqual(inventory(owner.root), before, 'import changed owned files');
    writeFileSync(join(owner.root, 'type-consumer.ts'), readFileSync(join(source, 'tests/fixtures/type-consumer.ts')));
    atomic(join(owner.root, 'tsconfig.json'), {
      compilerOptions: {
        noEmit: true,
        strict: true,
        skipLibCheck: true,
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        types: [],
      },
      files: ['type-consumer.ts'],
    });
    await run(controller, [compiler, '--project', join(owner.root, 'tsconfig.json')], owner.root, signal);
  } catch (error) {
    failure = error;
  } finally {
    removeRoot(owner);
  }
  if (failure) throw failure;
  const completed = { identity, passed: true, cleanup: { complete: true, root: owner.root } };
  atomic(receipt, completed);
  return { reused: false, receipt: completed };
}

test('actual packed archive supports the declared runtime and production types', async () => {
  const archive = process.env.AI_PLUGIN_TOOLS_ARCHIVE;
  const results = process.env.AI_PLUGIN_TOOLS_RESULTS;
  const expected = process.env.AI_PLUGIN_TOOLS_EXPECTED_NODE;
  assert(archive && results && expected, 'AI_PLUGIN_TOOLS_ARCHIVE, RESULTS and EXPECTED_NODE are required');
  const producer = json(join(dirname(archive), 'producer.json'));
  const result = await consume(archive, results, expected, producer);
  const replay = await consume(archive, results, expected, producer);
  assert.equal(replay.reused, true);
  assert.deepEqual(replay.receipt, result.receipt);
  await assert.rejects(consume(archive, results, 'v0.0.0', producer), /wrong selected runtime/);
  await assert.rejects(
    consume(archive, results, expected, { ...producer, sourceSha: 'f'.repeat(40) }),
    /incompatible completed unit/,
  );
  const corrupt = join(results, 'corrupt.tgz');
  writeFileSync(corrupt, Buffer.concat([readFileSync(archive), Buffer.from('corrupt')]));
  try {
    await assert.rejects(consume(corrupt, results, expected, producer), /archive integrity changed/);
  } finally {
    rmSync(corrupt);
  }
  if (expected === 'v24.21.0') {
    const original = readFileSync(join(results, 'consumer.json'));
    const interrupted = join(results, 'interrupted');
    const abort = new AbortController();
    const pending = consume(archive, interrupted, expected, producer, abort.signal);
    const timer = setTimeout(() => abort.abort(), 100);
    try {
      await assert.rejects(pending, /consumer cancelled/);
    } finally {
      clearTimeout(timer);
    }
    assert(!existsSync(join(interrupted, 'consumer.json')), 'incomplete unit cannot publish a receipt');
    const resumed = await consume(archive, interrupted, expected, producer);
    assert.deepEqual(resumed.receipt.identity, result.receipt.identity);
    assert.deepEqual(readFileSync(join(results, 'consumer.json')), original, 'completed unit must remain unchanged');
  }
});

test('malformed, source-only and dev-only packed closures refuse', async () => {
  const results = process.env.AI_PLUGIN_TOOLS_RESULTS;
  assert(results, 'AI_PLUGIN_TOOLS_RESULTS required');
  for (const variant of ['missing-entry', 'source-export', 'dev-only']) {
    const fixture = ownRoot(results);
    try {
      const packageRoot = join(fixture.root, 'package');
      mkdirSync(join(packageRoot, 'dist'), { recursive: true });
      const manifest = {
        name: '@aviaratech/ai-plugin-tools',
        version: '0.1.0',
        type: 'module',
        engines: { node: '>=24 <25 || 26.2.0' },
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: variant === 'source-export' ? './src/index.ts' : './dist/index.js',
          },
        },
        devDependencies: { 'checkout-only': '1.0.0' },
      };
      atomic(join(packageRoot, 'package.json'), manifest);
      writeFileSync(join(packageRoot, 'README.md'), 'synthetic refusal fixture\n');
      writeFileSync(join(packageRoot, 'LICENSE'), 'synthetic refusal fixture\n');
      const members = ['package/package.json', 'package/README.md', 'package/LICENSE'];
      if (variant !== 'missing-entry') {
        writeFileSync(join(packageRoot, 'dist/index.js'), "import 'checkout-only';\n");
        writeFileSync(join(packageRoot, 'dist/index.d.ts'), 'export {};\n');
        members.push('package/dist/index.js', 'package/dist/index.d.ts');
      }
      const archive = join(fixture.root, 'fixture.tgz');
      execFileSync('tar', ['-czf', archive, '-C', fixture.root, ...members]);
      const bytes = readFileSync(archive);
      const producer = {
        version: '0.1.0',
        sourceSha: 'a'.repeat(40),
        sourceTree: 'b'.repeat(40),
        lockSHA256: 'c'.repeat(64),
        archiveSHA256: sha(bytes),
        archiveIntegrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
      };
      await assert.rejects(
        consume(archive, join(results, variant), process.version, producer),
        variant === 'missing-entry'
          ? /missing archive member/
          : variant === 'source-export'
            ? /deep-equal/
            : /checkout-only/,
      );
    } finally {
      removeRoot(fixture);
    }
  }
});

test('failure and cancellation drain owned children and preserve unrelated files', async () => {
  const results = process.env.AI_PLUGIN_TOOLS_RESULTS;
  assert(results, 'AI_PLUGIN_TOOLS_RESULTS required');
  mkdirSync(results, { recursive: true, mode: 0o700 });
  const sentinel = join(results, 'unrelated-sentinel');
  writeFileSync(sentinel, 'preserve\n');
  const owner = ownRoot(results);
  try {
    await assert.rejects(run(process.execPath, ['-e', 'process.exit(9)'], owner.root), /child failed/);
    const abort = new AbortController();
    const pending = run(
      process.execPath,
      [
        '-e',
        "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); process.on('SIGTERM',()=>{child.kill(); child.on('exit',()=>process.exit(0))}); setInterval(()=>{},1000);",
      ],
      owner.root,
      abort.signal,
    );
    await delay(300);
    abort.abort();
    await assert.rejects(pending, /consumer cancelled/);
  } finally {
    removeRoot(owner);
  }
  assert.equal(readFileSync(sentinel, 'utf8'), 'preserve\n');
});
