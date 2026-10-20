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
The reviewed workflow owns the explicit App/Bot/login mapping. Validate the
actual REST Bot ID, login and type, review ID and node ID, exact head/PR/repository,
author independence, current approval, GraphQL counted eligibility and aggregate
required approval. App-directory access is not an available Actions-token proof.
The live review establishes the configured Bot's approval; it does not independently
attest the App-directory mapping.

The release workflow is manual on main. Its source, archive digest and CI-run
inputs must identify the same accepted candidate. The release environment must
be restricted to main before dispatch. publisher_admission is a credential-free
record of the actually admitted package, repository, workflow, environment,
actor and mode, with admitted=true and its original historical observedAt. It grants no access.
Only OIDC mode is accepted. The provider evidence contains separate canonical
package-root and target-version responses: an absent target version does not
mean package ownership is absent. The root response must identify this package
and the admitted personal namespace owner `aviaratech` among its maintainers.
The admission also carries the actual `npm trust list --json` record as `trust`
and its original historical `trustObservedAt`: the exact configuration ID pinned
by `TRUSTED_PUBLISHER_ID`, GitHub provider,
repository, `release.yml`, `release` environment and `createPackage` permission
must match. Historical timestamps must be valid and nonfuture; do not restamp them
as a new authenticated read. Fresh live GitHub and registry evidence must remain
under five minutes old. This credential-free setup record is historical admission
evidence; actual OIDC publishing proves current access. The setup account may be
revoked and is not current publishing authorization. OIDC does not independently
prove that an identical trust tuple was never deleted and recreated. Preserve
stops for known trust changes, access refusal or expiry, and do not infer provider
creation/expiry times from local observations. No npm account token or GitHub npm secret is
used by the release workflow, and an OIDC refusal has no credential fallback.

Both release and the existing CI checks job use `scripts/release-provider.sh`.
CI has repository read permissions only: no OIDC, npm command, publisher admission
or publication intent. Collection is not release admission and may observe its
own checks still running. Preserve the original outputs and enclosing CI result;
independent review must inspect every request, including GraphQL errors/nulls and
complete review/protection bindings. The observation identifies the executing
collector commit/tree/digest separately from the main source whose records were
collected. Never relabel existing-main observations as new-source qualification.

First ownership is established separately through an explicitly approved local
browser-authenticated CLI publication of the real library at `0.0.0`, tagged
`bootstrap`. This extra immutable version requires exact archive approval,
including its version-only derivation and bootstrap-only absence of CI
provenance. Use an isolated temporary account userconfig/cache outside source
and evidence, with standard npm web login and publish approval. Never change
the shared userconfig or copy credentials into GitHub. Publish the verified
archive from an exclusively owned neutral temporary path containing only public
package/version names: npm can include that path in registry metadata. Revoke
the temporary session and separately verify owned local cleanup.

After ownership exists, configure and read back the package-specific GitHub
trusted publisher for this repository, `release.yml`, environment `release`,
with direct publishing allowed. Save its actual CLI readback in the admission;
that CLI does not expose provider creation or expiry times. Complete the real
`0.1.0` OIDC release within npm's two-day activation window: saving trust alone
is not successful activation. An existing HTTP 401/403 stops its context; it
never authorizes another account, token, retry or additional package version.
The stable release retains every qualified-archive and CI provenance check.

An intent artifact is retained before the single publish command. Any prior
intent with an absent registry version stops publication for original-run
reconciliation. An already matching version emits readback-only. Neither
metadata nor this decision verifies registry signatures or provenance: the
release owner must still verify the actual archive, cryptographic signatures
and trusted Sigstore/source/workflow identity, run an isolated published
consumer, and accept cleanup before closing the issue.
