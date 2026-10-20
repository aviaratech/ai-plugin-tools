# Contributing

Use Node 24.21.0 and npm 11.19.0. Install the exact lockfile with

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run checks
```

Unit expectations come from literal native vectors and independently captured
original constructor bytes. Golden provenance is recorded in the tests.
The package has two runtime exports and no runtime dependencies. Keep native
admission, serialization, writes, execution, policy, receipts and recovery in
the caller. Strings are opaque. Runtime APIs and export subpaths require an
explicit contract change.

Qualification packs clean committed source once, retains the archive and
producer identity, and runs npm run test:packed separately with Node 24.0.0,
24.21.0 and 26.2.0. AI_PLUGIN_TOOLS_ARCHIVE selects the archive,
AI_PLUGIN_TOOLS_RESULTS is an owned directory outside the checkout, and
AI_PLUGIN_TOOLS_EXPECTED_NODE is the exact selected version including v.
AI_PLUGIN_TOOLS_CONTROLLER, AI_PLUGIN_TOOLS_NPM_CLI and
AI_PLUGIN_TOOLS_TYPESCRIPT select the admitted contributor tools. No ambient
checkout dependency may resolve in the production install. Successful runtime
receipts are reusable only with identical source, lock, archive, consumer and
runtime identities. Preserve receipts and archives on failure.

An early consumer.json is a reusable completed package unit, not proof that the
enclosing refusal/recovery/cleanup tests passed. execution.json records that
command's actual exit status joined to the same identity. Release selection
requires both and refuses absent or failed execution evidence.

Required CI contexts are checks and secrets. Changes require fresh
consequential exact-head independent review and GitHub-counted approval through
the configured reviewer App, distinct from the PR author. Preserve strict
branch protection, stale dismissal, administrator enforcement and linear history.
PR source merge does not complete a package-release issue.

First package ownership, the initial publisher, a main-restricted release
environment and trusted publishing must be admitted and read back separately.
Never infer namespace ownership from a 404 or invent credentials to bootstrap
publication. Only the protected publish job receives OIDC permission.
The release guard selects and verifies the tested archive; it never rebuilds,
publishes or retries. Reconcile ambiguous publication through the original run
and registry readback before any further mutation. Accept actual registry bytes
only after signature and provenance verification against the reviewed source
and trusted workflow identity.

The repository's maintained reviewer route is gpt-reviewer, App 2450500,
at-gpt-reviewer[bot] (Bot 249028089), independent of the host-user author.
Installation access does not establish counted approval; verify the exact
submitted review through GitHub before merging.

The release workflow is manual on main. Its source, archive digest and CI-run
inputs must identify the same accepted candidate. The release environment must
be restricted to main before dispatch. publisher_admission is a credential-free
record of the actually admitted package, repository, workflow, environment,
actor and mode, with admitted=true and a fresh observedAt. It grants no access.
Bootstrap mode additionally checks the configured NPM_BOOTSTRAP_TOKEN's actual
npm identity and namespace owner/admin readback. This secret reference is a
proposed repository binding; creating or changing it requires admission of the
supported first-publisher route. An existing HTTP 401 is a stopped access gate,
never permission to substitute credentials or another account. OIDC cannot
bootstrap a nonexistent npm package. Its subsequent trust binding is a separate
read-back transition after initial ownership exists.

An intent artifact is retained before the single publish command. Any prior
intent with an absent registry version stops publication for original-run
reconciliation. An already matching version emits readback-only. Neither
metadata nor this decision verifies registry signatures or provenance: the
release owner must still verify the actual archive, cryptographic signatures
and trusted Sigstore/source/workflow identity, run an isolated published
consumer, and accept cleanup before closing the issue.
