import { marketplaceDocuments, nativePluginArgs } from '@aviaratech/ai-plugin-tools';
import type { MarketplaceSpec, MarketplaceDocuments, NativePluginSpec } from '@aviaratech/ai-plugin-tools';
const spec: MarketplaceSpec = {
  marketplaceName: '',
  pluginName: '',
  relativeSource: '',
  version: '',
  ownerName: '',
  metadata: { kind: 'described', description: '' },
};
const documents: MarketplaceDocuments = marketplaceDocuments(spec);
documents.codexDocument.plugins[0].source.path = 'mutable';
documents.claudeDocument.name = 'mutable';
const native: NativePluginSpec = { host: 'codex', action: 'update', pluginId: '', scope: 'user' };
const args: string[] = nativePluginArgs(native);
args.push('mutable');
// @ts-expect-error Codex project scope must refuse at the type boundary.
nativePluginArgs({ host: 'codex', action: 'install', pluginId: '', scope: 'project' });
// @ts-expect-error Metadata is required.
marketplaceDocuments({ marketplaceName: '', pluginName: '', relativeSource: '', version: '', ownerName: '' });
