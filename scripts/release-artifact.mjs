import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

// Private select/verify/admit guard. It cannot build, publish, authenticate or retry.
const repository = 'aviaratech/ai-plugin-tools';
const packageName = '@aviaratech/ai-plugin-tools';
const versions = ['24.0.0', '24.21.0', '26.2.0'];
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const hex = (value, size) => typeof value === 'string' && new RegExp('^[a-f0-9]{' + size + '}$').test(value);
const fresh = (date) =>
  Number.isFinite(Date.parse(date)) &&
  Date.now() - Date.parse(date) >= -30_000 &&
  Date.now() - Date.parse(date) < 5 * 60_000;
const historical = (date) =>
  typeof date === 'string' && Number.isFinite(Date.parse(date)) && Date.parse(date) <= Date.now() + 30_000;

function validate(directory) {
  const p = json(join(directory, 'producer.json'));
  assert.equal(p.schemaVersion, 1, 'unsupported qualification schema');
  assert.equal(p.repository, repository, 'noncanonical repository');
  assert.equal(p.version, '0.1.0', 'unadmitted version');
  assert(hex(p.sourceSha, 40) && hex(p.sourceTree, 40), 'missing exact source identity');
  assert.equal(p.sourceSha, process.env.REVIEWED_SOURCE_SHA, 'unreviewed source');
  assert.equal(p.version, process.env.RELEASE_VERSION, 'version mismatch');
  assert.equal(p.archiveSHA256, process.env.REVIEWED_ARCHIVE_SHA256, 'unreviewed archive');
  assert(hex(p.archiveSHA256, 64) && hex(p.lockSHA256, 64), 'invalid artifact identity');
  assert.equal(p.archiveName, 'aviaratech-ai-plugin-tools-0.1.0.tgz', 'noncanonical archive name');
  assert.equal(basename(p.archiveName), p.archiveName, 'archive traversal');
  assert.deepEqual(p.toolchain, { node: 'v24.21.0', npm: '11.19.0' }, 'wrong contributor toolchain');
  assert.equal(p.checks.exitCode, 0, 'source checks failed');
  assert.equal(p.secrets.exitCode, 0, 'secrets scan failed');
  assert.equal(digest(readFileSync(join(directory, 'checks.log'))), p.checks.logSHA256, 'changed checks evidence');
  assert.equal(digest(readFileSync(join(directory, 'secrets.json'))), p.secrets.reportSHA256, 'changed scan evidence');
  assert.deepEqual(json(join(directory, 'secrets.json')), [], 'secret findings remain');
  assert.equal(digest(readFileSync(join(directory, 'source-lock.json'))), p.lockSHA256, 'changed source lock');
  assert(hex(p.consumerSHA256, 64) && hex(p.typeFixtureSHA256, 64), 'missing consumer source identity');
  const expectedFiles = [
    'producer.json',
    'source-lock.json',
    'checks.log',
    'secrets.json',
    p.archiveName,
    ...versions,
  ].sort();
  assert.deepEqual(readdirSync(directory).sort(), expectedFiles, 'unexpected qualification members');
  for (const file of expectedFiles) assert(!lstatSync(join(directory, file)).isSymbolicLink(), 'qualification symlink');
  const archive = join(directory, p.archiveName);
  const bytes = readFileSync(archive);
  assert.equal(digest(bytes), p.archiveSHA256, 'changed archive');
  assert.equal('sha512-' + digest(bytes, 'sha512', 'base64'), p.archiveIntegrity, 'archive SRI mismatch');
  const expectedMembers = [
    'package/LICENSE',
    'package/README.md',
    'package/package.json',
    ...['index', 'marketplace', 'nativePluginArgs'].flatMap((name) => [
      'package/dist/' + name + '.js',
      'package/dist/' + name + '.d.ts',
    ]),
  ].sort();
  const members = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
    .trim()
    .split('\n')
    .sort();
  assert.deepEqual(members, expectedMembers, 'unexpected archive inventory');
  const listing = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert(
    listing
      .trim()
      .split('\n')
      .every((line) => line.startsWith('-')),
    'archive must contain regular files only',
  );
  const manifest = JSON.parse(execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8' }));
  assert.equal(manifest.name, packageName, 'wrong package');
  assert.equal(manifest.version, p.version, 'wrong package version');
  assert.equal(manifest.type, 'module', 'package must be ESM');
  assert.equal(manifest.engines.node, '>=24 <25 || 26.2.0', 'unqualified engine range');
  assert.deepEqual(
    manifest.exports,
    { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    'wrong exports',
  );
  assert.deepEqual(manifest.dependencies ?? {}, {}, 'runtime dependencies forbidden');
  assert.equal(manifest.bin, undefined, 'CLI forbidden');
  for (const version of versions) {
    const root = join(directory, version);
    assert.deepEqual(readdirSync(root).sort(), ['consumer.json', 'execution.json'], 'unexpected consumer evidence');
    assert(!lstatSync(join(root, 'consumer.json')).isSymbolicLink(), 'consumer receipt symlink');
    assert(!lstatSync(join(root, 'execution.json')).isSymbolicLink(), 'consumer execution symlink');
    const receipt = json(join(root, 'consumer.json'));
    const identity = receipt.identity;
    const execution = json(join(root, 'execution.json'));
    assert.equal(execution.exitCode, 0, 'enclosing consumer command failed');
    assert.deepEqual(execution.identity, identity, 'consumer command identity mismatch');
    assert.equal(receipt.passed, true, 'consumer failed');
    assert.equal(receipt.cleanup.complete, true, 'consumer cleanup unconfirmed');
    assert.equal(identity.schemaVersion, 1, 'consumer schema mismatch');
    for (const key of [
      'sourceSha',
      'sourceTree',
      'lockSHA256',
      'archiveSHA256',
      'archiveIntegrity',
      'consumerSHA256',
      'typeFixtureSHA256',
    ])
      assert.equal(identity[key], p[key], 'consumer identity mismatch: ' + key);
    assert.equal(identity.nodeVersion, 'v' + version, 'missing exact runtime');
    assert(hex(identity.nodeExecutableSHA256, 64), 'missing runtime binary identity');
  }
  return p;
}

function select(source, output) {
  validate(source);
  assert(!existsSync(output), 'artifact output already exists');
  const temporary = join(dirname(output), '.artifact-' + randomUUID());
  mkdirSync(temporary, { mode: 0o700 });
  try {
    cpSync(source, temporary, { recursive: true, preserveTimestamps: true });
    validate(temporary);
    assert(!existsSync(output), 'artifact output changed during selection');
    renameSync(temporary, output);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true });
  }
}

function admit(directory, providerDirectory) {
  const p = validate(directory);
  const get = (name) => json(join(providerDirectory, name + '.json'));
  const observation = get('observation');
  assert.equal(observation.repository, repository, 'wrong provider repository');
  assert(fresh(observation.observedAt), 'stale provider readback');
  const main = get('main');
  assert.equal(main.sha, p.sourceSha, 'protected main drifted');
  assert.equal(main.commit.tree.sha, p.sourceTree, 'main source tree changed');
  const pr = get('pr');
  const head = get('head');
  assert.equal(pr.merged, true, 'source PR is not merged');
  assert.equal(pr.base.repo.full_name, repository, 'wrong PR repository');
  assert.equal(pr.base.ref, 'main', 'wrong PR base');
  assert.equal(pr.merge_commit_sha, p.sourceSha, 'merge SHA mismatch');
  assert.equal(pr.head.sha, head.sha, 'review head mismatch');
  assert.equal(head.tree.sha, p.sourceTree, 'reviewed tree differs from merged source');
  assert.equal(
    get('review-decision').data.repository.pullRequest.reviewDecision,
    'APPROVED',
    'GitHub required approval is unconfirmed',
  );
  // The reviewed workflow owns the App/Bot mapping. Live review records prove
  // the exact actor and counted approval without an App-directory credential.
  assert(/^[1-9][0-9]*$/.test(process.env.REVIEWER_APP_ID ?? ''), 'reviewer App is not configured');
  assert(/^[1-9][0-9]*$/.test(process.env.REVIEWER_BOT_ID ?? ''), 'reviewer Bot is not configured');
  const login = process.env.REVIEWER_BOT_LOGIN;
  assert(typeof login === 'string' && /^[a-z0-9-]+\[bot\]$/i.test(login), 'reviewer Bot login is not configured');
  assert.notEqual(login, pr.user.login, 'author cannot supply independent approval');
  const reviews = get('reviews')
    .filter((review) => String(review.user.id) === process.env.REVIEWER_BOT_ID)
    .sort((a, b) => b.id - a.id);
  assert(reviews.length > 0, 'independent App review absent');
  assert.equal(reviews[0].user.login, login, 'review actor mismatch');
  assert.equal(reviews[0].user.type, 'Bot', 'review actor is not App Bot');
  assert.equal(reviews[0].state, 'APPROVED', 'review dismissed or unaccepted');
  assert.equal(reviews[0].commit_id, head.sha, 'stale App review');
  const eligibility = get('app-review-eligibility').data.node;
  assert.equal(eligibility.id, reviews[0].node_id, 'App review node mismatch');
  assert.equal(String(eligibility.fullDatabaseId), String(reviews[0].id), 'App review identity mismatch');
  assert.equal(eligibility.state, 'APPROVED', 'App review is not currently approved');
  assert.equal(
    eligibility.author.login.replace(/\[bot\]$/, ''),
    login.replace(/\[bot\]$/, ''),
    'App review author mismatch',
  );
  assert.equal(eligibility.commit.oid, head.sha, 'App review eligibility is stale');
  assert.equal(eligibility.pullRequest.number, pr.number, 'App review belongs to another PR');
  assert.equal(eligibility.pullRequest.headRefOid, head.sha, 'App review PR head drifted');
  assert.equal(eligibility.pullRequest.baseRepository.nameWithOwner, repository, 'App review repository mismatch');
  assert.equal(eligibility.authorCanPushToRepository, true, 'configured App approval does not count');
  const protection = get('protection');
  assert.equal(protection.required_status_checks.strict, true, 'strict checks required');
  const contexts = protection.required_status_checks.contexts;
  assert(contexts.includes('checks') && contexts.includes('secrets'), 'required checks changed');
  assert(protection.required_pull_request_reviews.required_approving_review_count >= 1, 'counted approval required');
  assert.equal(protection.required_pull_request_reviews.dismiss_stale_reviews, true, 'stale dismissal required');
  assert.equal(protection.enforce_admins.enabled, true, 'admin enforcement required');
  assert.equal(protection.required_linear_history.enabled, true, 'linear history required');
  assert.equal(protection.allow_force_pushes.enabled, false, 'force push forbidden');
  assert.equal(protection.allow_deletions.enabled, false, 'protected deletion forbidden');
  const checks = get('checks').check_runs;
  for (const name of contexts) {
    const runs = checks.filter((check) => check.name === name).sort((a, b) => b.id - a.id);
    assert(runs.length > 0, 'missing required check: ' + name);
    assert.equal(runs[0].head_sha, p.sourceSha, 'stale check');
    assert.equal(runs[0].status, 'completed', 'incomplete check');
    assert.equal(runs[0].conclusion, 'success', 'failed required check');
    assert.equal(runs[0].app.slug, 'github-actions', 'unexpected check producer');
  }
  const publisher = get('publisher');
  assert.equal(publisher.package, packageName, 'wrong publisher package');
  assert.equal(publisher.repository, repository, 'wrong publisher repository');
  assert.equal(publisher.workflow, 'release.yml', 'wrong publisher workflow');
  assert.equal(publisher.environment, 'release', 'wrong protected environment');
  assert.equal(publisher.admitted, true, 'first-publisher route is not admitted');
  assert.equal(publisher.mode, 'oidc', 'only the admitted OIDC publisher is supported');
  assert(typeof publisher.actor === 'string' && publisher.actor.length > 0, 'publisher actor is unverified');
  assert(historical(publisher.observedAt), 'invalid historical publisher observation');
  const packageRegistry = get('package-registry');
  assert.equal(packageRegistry.statusCode, 200, 'existing package ownership is unavailable');
  assert.equal(packageRegistry.body.name, packageName, 'noncanonical existing package');
  assert.equal(publisher.actor, packageName.slice(1).split('/')[0], 'unadmitted namespace owner');
  assert(
    packageRegistry.body.maintainers?.some((x) => x.name === publisher.actor),
    'package owner is unconfirmed',
  );
  assert(historical(publisher.trustObservedAt), 'invalid historical trusted-publisher readback');
  const trust = publisher.trust;
  assert(
    typeof process.env.TRUSTED_PUBLISHER_ID === 'string' && process.env.TRUSTED_PUBLISHER_ID.length > 0,
    'trusted-publisher identity is not configured',
  );
  assert.equal(trust?.id, process.env.TRUSTED_PUBLISHER_ID, 'trusted-publisher identity mismatch');
  assert.equal(trust.type, 'github', 'wrong trusted-publisher provider');
  assert.equal(trust.repository, repository, 'wrong trusted-publisher repository');
  assert.equal(trust.file, publisher.workflow, 'wrong trusted-publisher workflow');
  assert.equal(trust.environment, publisher.environment, 'wrong trusted-publisher environment');
  assert(
    Array.isArray(trust.permissions) && trust.permissions.includes('createPackage'),
    'trusted publisher cannot publish directly',
  );
  const registry = get('registry');
  if (registry.statusCode === 200) {
    assert.equal(registry.body.name, packageName, 'registry package conflict');
    assert.equal(registry.body.version, p.version, 'registry version conflict');
    if (registry.body.gitHead !== undefined)
      assert.equal(registry.body.gitHead, p.sourceSha, 'registry source conflict');
    assert.equal(registry.body.dist.integrity, p.archiveIntegrity, 'registry archive conflict');
    assert(
      registry.body.dist.signatures?.length > 0 && registry.body.dist.attestations?.url,
      'published signature/provenance metadata absent; cryptographic readback required',
    );
    return 'readback-only';
  }
  assert.equal(registry.statusCode, 404, 'registry state unavailable or unauthorized');
  assert(
    registry.body === `version not found: ${p.version}` || ['E404', 'Not found'].includes(registry.body?.error),
    'registry absence unconfirmed',
  );
  assert.equal(get('issue').state, 'open', 'initial release issue is not open');
  assert.deepEqual(
    get('publication-history').intents,
    [],
    'prior publication intent requires original-run reconciliation',
  );
  return 'publish-once';
}

try {
  const [command, directory, other, ...extra] = process.argv.slice(2);
  assert(
    extra.length === 0 && directory,
    'usage: select <qualification> <artifact> | verify <artifact> | admit <artifact> <provider-evidence>',
  );
  if (command === 'select') {
    assert(other);
    select(resolve(directory), resolve(other));
  } else if (command === 'verify') {
    assert(!other);
    validate(resolve(directory));
  } else if (command === 'admit') {
    assert(other);
    console.log(admit(resolve(directory), resolve(other)));
  } else throw new Error('unknown release-artifact command');
} catch (error) {
  console.error('Release artifact refused: ' + error.message);
  process.exitCode = 1;
}
