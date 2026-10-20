# ai-plugin-tools

Pure marketplace document and native plugin argument compatibility helpers.
ESM only, with TypeScript declarations and no runtime dependencies.

Install an exact accepted version:

```sh
npm install --save-exact @aviaratech/ai-plugin-tools@0.1.0
```

```ts
import { marketplaceDocuments, nativePluginArgs } from '@aviaratech/ai-plugin-tools';

const documents = marketplaceDocuments({
  marketplaceName: 'example-market',
  pluginName: 'example',
  relativeSource: './plugin',
  version: '1.0.0',
  ownerName: 'Example',
  metadata: { kind: 'described', description: 'Example plugin' },
});
const args = nativePluginArgs({
  host: 'codex',
  action: 'update',
  pluginId: 'example@example-market',
  scope: 'user',
});
// ['plugin', 'add', 'example@example-market', '--json']
```

marketplaceDocuments returns fresh mutable codexDocument and claudeDocument
records, in that order. The described metadata form retains owner, version and
description. The interface-policy form takes displayName, policy with
installation and authentication strings, and category; it preserves the native
hosts' distinct field sets. Callers own JSON serialization and writes.

nativePluginArgs supports install, update and remove. Codex supports user scope
and maps update to plugin add. Claude Code supports user, project and local;
removal retains --keep-data. The plugin ID stays one unchanged string token.

Inputs are closed data records with required fields. Strings, including empty
strings, are copied unchanged. Invalid direct inputs throw built-in TypeError
with "Invalid marketplaceDocuments input." or "Invalid nativePluginArgs input."
without including input values. Imports and calls perform no I/O or native
operations. Callers retain validation, policy, authentication, execution,
readback, receipts and recovery.

Node support is >=24 <25 || 26.2.0. Contributor and package qualification
requirements are in [CONTRIBUTING.md](CONTRIBUTING.md).
