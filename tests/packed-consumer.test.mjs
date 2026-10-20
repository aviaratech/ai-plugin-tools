import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
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
import { join, resolve, dirname, basename, relative, isAbsolute } from 'node:path';
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
    atomic(
      join(cwd, 'children.json'),
      [...owned].map(([pid, birth]) => ({ pid, birth, group: child.pid })),
    );
  };
  let stdout = '';
  let stderr = '';
  let overflow = false;
  let outputBytes = 0;
  let stopping = false;
  let killTimer;
  let signalFailure;
  let rejectCancellation;
  const cancellationFailure = new Promise((_accept, reject) => {
    rejectCancellation = reject;
  });
  const signalOwned = (name) => {
    observe();
    for (const item of processes(child.pid).reverse()) {
      assert.equal(owned.get(item.pid), item.birth, 'child process identity changed');
      try {
        process.kill(item.pid, name);
      } catch (error) {
        // A snapshot can race process exit. A live refusal remains an error.
        const stillOwned = processes(child.pid).some((now) => now.pid === item.pid && now.birth === item.birth);
        if (error.code !== 'ESRCH' && stillOwned) throw error;
      }
    }
  };
  const stop = () => {
    if (stopping) return;
    stopping = true;
    try {
      signalOwned('SIGTERM');
    } catch (error) {
      signalFailure = error;
      rejectCancellation(error);
      return;
    }
    killTimer ??= setTimeout(() => {
      try {
        signalOwned('SIGKILL');
      } catch (error) {
        signalFailure = error;
        rejectCancellation(error);
      }
    }, 5_000); // Cleanup grace for an owned child that ignores termination.
  };
  const collect = (kind, chunk) => {
    outputBytes += chunk.length;
    if (outputBytes > 32 * 1024 ** 2) {
      overflow = true;
      stop();
      return;
    }
    if (kind === 'out') stdout += chunk;
    else stderr += chunk;
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
    code = await Promise.race([closed, cancellationFailure]);
  } finally {
    clearInterval(monitor);
    clearTimeout(killTimer);
    signal?.removeEventListener('abort', stop);
    const remaining = processes(child.pid);
    assert(
      remaining.every((item) => owned.get(item.pid) === item.birth),
      'child process identity changed',
    );
    if (remaining.length) {
      if (signalFailure) throw signalFailure;
      signalOwned('SIGTERM');
      for (let i = 0; i < 100 && processes(child.pid).length; i++) await delay(50);
      if (processes(child.pid).length) {
        assert(processes(child.pid).every((item) => owned.get(item.pid) === item.birth));
        signalOwned('SIGKILL');
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

function processBirth(pid) {
  assert(Number.isSafeInteger(pid) && pid > 0, 'invalid process identity');
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' });
  if (result.status === 1 && result.stderr.trim() === '') return undefined;
  assert.equal(result.status, 0, 'process identity is unavailable');
  assert(result.stdout.trim(), 'empty process identity');
  return result.stdout.trim();
}
function rootLocation(results, owner) {
  assert.equal(dirname(owner.root), results, 'install root escaped its results directory');
  assert(basename(owner.root).startsWith('install-'), 'unexpected install root');
}
function reconcileRoots(results) {
  const pointer = join(results, 'active-root.json');
  let active;
  if (existsSync(pointer)) {
    assert(lstatSync(pointer).isFile() && !lstatSync(pointer).isSymbolicLink(), 'invalid active root pointer');
    active = json(pointer);
    rootLocation(results, active);
  }
  for (const entry of readdirSync(results).filter((name) => name.startsWith('install-'))) {
    const root = join(results, entry);
    const marker = join(root, 'owner.json');
    assert(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(), 'invalid prior install root');
    assert(lstatSync(marker).isFile() && !lstatSync(marker).isSymbolicLink(), 'invalid prior owner marker');
    const owner = json(marker);
    rootLocation(results, owner);
    assert.equal(owner.root, root, 'prior owner root mismatch');
    if (active?.root === root) assert.deepEqual(active, owner, 'prior owner pointer mismatch');
    assert(owner.controller?.birth, 'prior controller identity unavailable');
    assert.notEqual(processBirth(owner.controller.pid), owner.controller.birth, 'prior install controller is active');
    removeRoot(owner);
  }
  if (active && existsSync(pointer)) {
    assert(!existsSync(active.root), 'prior install remains');
    assert.deepEqual(json(pointer), active, 'active root pointer changed');
    rmSync(pointer);
  }
}
function ownRoot(results) {
  reconcileRoots(results);
  const controller = { pid: process.pid, birth: processBirth(process.pid) };
  const root = mkdtempSync(join(results, 'install-'));
  const stat = lstatSync(root);
  const owner = { root, device: stat.dev, inode: stat.ino, nonce: randomUUID(), controller };
  atomic(join(root, 'owner.json'), owner);
  atomic(join(results, 'active-root.json'), owner);
  return owner;
}
function removeRoot(owner) {
  if (owner.controller?.pid !== process.pid)
    assert.notEqual(processBirth(owner.controller.pid), owner.controller.birth, 'prior install controller is active');
  else assert.equal(processBirth(process.pid), owner.controller.birth, 'controller identity changed');
  if (!existsSync(owner.root)) return;
  const stat = lstatSync(owner.root);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.dev === owner.device && stat.ino === owner.inode);
  assert.deepEqual(json(join(owner.root, 'owner.json')), owner);
  if (existsSync(join(owner.root, 'children.json'))) {
    for (const child of json(join(owner.root, 'children.json'))) {
      assert.equal(processes(child.group).length, 0, 'preserve install root while child group is active');
    }
  }
  rmSync(owner.root, { recursive: true });
  assert(!existsSync(owner.root), 'owned install cleanup failed');
  const pointer = join(dirname(owner.root), 'active-root.json');
  if (existsSync(pointer) && json(pointer).nonce === owner.nonce) {
    assert.deepEqual(json(pointer), owner, 'active root pointer changed');
    rmSync(pointer);
  }
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
  reconcileRoots(results);
  const receipt = join(results, 'consumer.json');
  if (existsSync(receipt)) {
    const prior = json(receipt);
    assert.deepEqual(prior.identity, identity, 'incompatible completed unit');
    assert.equal(prior.passed, true);
    assert.equal(prior.cleanup.complete, true);
    assert(!existsSync(prior.cleanup.root));
    return { reused: true, receipt: prior };
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
        "import { fileURLToPath } from 'node:url';",
        "import { realpathSync } from 'node:fs';",
        "const mod = await import('@aviaratech/ai-plugin-tools');",
        "assert.deepEqual(Object.keys(mod).sort(), ['marketplaceDocuments','nativePluginArgs']);",
        "assert.deepEqual(mod.nativePluginArgs({host:'codex',action:'update',pluginId:'opaque selector @ value',scope:'user'}), ['plugin','add','opaque selector @ value','--json']);",
        "for (const metadata of [{kind:'described',description:''},{kind:'interface-policy',displayName:'',policy:{installation:'',authentication:''},category:''}]) {",
        "const pair=mod.marketplaceDocuments({marketplaceName:'',pluginName:'',relativeSource:'',version:'',ownerName:'',metadata});",
        "assert.deepEqual(Object.keys(pair), ['codexDocument','claudeDocument']);",
        "assert.equal(pair.codexDocument.plugins[0].source.path,''); }",
        "const resolved=fileURLToPath(import.meta.resolve('@aviaratech/ai-plugin-tools'));",
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

// Exercise an untrappable interruption in the real owner path before test registration.
if (process.env.AI_PLUGIN_TOOLS_INTERRUPTION_PROBE === '1') {
  ownRoot(process.env.AI_PLUGIN_TOOLS_RESULTS);
  process.kill(process.pid, 'SIGKILL');
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
    let abandoned;
    try {
      assert.throws(
        () =>
          execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
            env: { ...cleanEnv(), AI_PLUGIN_TOOLS_INTERRUPTION_PROBE: '1' },
            stdio: 'pipe',
          }),
        (error) => error.signal === 'SIGKILL',
      );
      abandoned = json(join(results, 'active-root.json'));
      assert(existsSync(abandoned.root), 'interruption must leave an owned root');
      assert.equal((await consume(archive, results, expected, producer)).reused, true);
      assert(!existsSync(abandoned.root), 'resume must reconcile the abandoned root before receipt reuse');
      assert.deepEqual(readFileSync(join(results, 'consumer.json')), original, 'completed checkpoint must be reused');
    } finally {
      if (abandoned && existsSync(abandoned.root)) removeRoot(abandoned);
    }
    assert.throws(
      () =>
        execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
          env: { ...cleanEnv(), AI_PLUGIN_TOOLS_INTERRUPTION_PROBE: '1' },
          stdio: 'pipe',
        }),
      (error) => error.signal === 'SIGKILL',
    );
    const unindexed = json(join(results, 'active-root.json'));
    rmSync(join(results, 'active-root.json'));
    const replacement = ownRoot(results);
    try {
      assert(!existsSync(unindexed.root), 'owner creation must reconcile an unindexed abandoned root');
      const pointer = readFileSync(join(results, 'active-root.json'));
      await assert.rejects(consume(archive, results, expected, producer), /prior install controller is active/);
      assert.throws(() => ownRoot(results), /prior install controller is active/);
      assert.deepEqual(readFileSync(join(results, 'active-root.json')), pointer, 'live owner pointer must survive');
      assert(existsSync(replacement.root), 'live owner root must survive');
    } finally {
      removeRoot(replacement);
    }
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
        "const {spawn}=require('node:child_process'); spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{stdio:'inherit'});process.on('SIGTERM',()=>{});setInterval(()=>{},1000);",
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
