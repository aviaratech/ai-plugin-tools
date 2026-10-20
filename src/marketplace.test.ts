import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { marketplaceDocuments } from './index.js';
import type { MarketplaceSpec } from './index.js';

// Independent bytes captured from original public constructors:
// ai-delivery a4808e10837ca4b947b89dd7a1a259eca48ec42e src/pluginInstaller.ts:887-914
// ai-memory a8a0c98bfd51c364576e5a1cd5535ad98dde1ee0 pluginInstallation.ts:460-473
const fixture = (name: string) => readFileSync(new URL('../fixtures/marketplace/' + name, import.meta.url));
const inputs = ['interface-policy', 'described'].map(
  (name) => [name, JSON.parse(fixture(name + '.input.json').toString()) as MarketplaceSpec] as const,
);

describe('marketplaceDocuments', () => {
  test.each(inputs)('preserves independent %s catalog bytes and key order', (name, spec) => {
    const pair = marketplaceDocuments(spec);
    expect(Object.keys(pair)).toEqual(['codexDocument', 'claudeDocument']);
    for (const [host, doc] of [
      ['codex', pair.codexDocument],
      ['claude', pair.claudeDocument],
    ] as const) {
      expect(Buffer.from(JSON.stringify(doc, null, 2) + '\n')).toEqual(fixture(name + '.' + host + '.json'));
      expect(doc.plugins).toHaveLength(1);
    }
  });

  test.each(inputs)('returns fresh mutable %s records without retaining input', (_name, spec) => {
    const before = structuredClone(spec);
    const first = marketplaceDocuments(spec);
    const second = marketplaceDocuments(spec);
    expect(first).not.toBe(second);
    expect(first.codexDocument).not.toBe(second.codexDocument);
    expect(first.codexDocument.plugins).not.toBe(second.codexDocument.plugins);
    expect(first.codexDocument.plugins[0].source).not.toBe(second.codexDocument.plugins[0].source);
    first.codexDocument.plugins[0].source.path = 'changed';
    if ('policy' in first.codexDocument.plugins[0]) first.codexDocument.plugins[0].policy.installation = 'changed';
    expect(spec).toEqual(before);
    expect(second).toEqual(marketplaceDocuments(before));
  });

  test.each(inputs)('copies every opaque %s string value unchanged', (_name, spec) => {
    for (const value of ['', '  opaque\n@ value  ']) {
      const replace = (item: unknown): unknown =>
        typeof item === 'string'
          ? value
          : Object.fromEntries(
              Object.entries(item as object).map(([key, nested]) => [key, key === 'kind' ? nested : replace(nested)]),
            );
      const opaque = replace(spec) as MarketplaceSpec;
      const result = marketplaceDocuments(opaque);
      const leaves = (item: unknown): string[] =>
        typeof item === 'string' ? [item] : Object.values(item as object).flatMap(leaves);
      expect(
        leaves(result)
          .filter((leaf) => leaf !== 'local')
          .every((leaf) => leaf === value),
      ).toBe(true);
    }
  });

  test('rejects closed-shape violations without echoing input or logging', () => {
    const spies = ['log', 'error', 'warn', 'info', 'debug'].map((method) =>
      vi.spyOn(console, method as 'log').mockImplementation(() => {}),
    );
    try {
      const invalid: unknown[] = [null, [], true, 'secret', 42];
      for (const [, spec] of inputs) {
        invalid.push({ ...spec, unknown: 'secret' }, { ...spec, [Symbol('unknown')]: 'secret' });
        for (const key of Object.keys(spec)) {
          const missing = { ...spec } as Record<string, unknown>;
          delete missing[key];
          invalid.push(missing, { ...spec, [key]: undefined }, { ...spec, [key]: 42 });
          invalid.push(Object.assign(Object.create({ [key]: spec[key as keyof MarketplaceSpec] }), missing));
        }
        invalid.push(
          { ...spec, metadata: null },
          { ...spec, metadata: [] },
          { ...spec, metadata: { ...spec.metadata, unknown: 'secret' } },
          { ...spec, metadata: { ...spec.metadata, kind: 'unknown' } },
        );
        for (const key of Object.keys(spec.metadata)) {
          const metadata = { ...spec.metadata } as Record<string, unknown>;
          delete metadata[key];
          invalid.push({ ...spec, metadata }, { ...spec, metadata: { ...spec.metadata, [key]: undefined } });
        }
        if (spec.metadata.kind === 'interface-policy') {
          for (const policy of [
            null,
            [],
            {},
            { installation: '', authentication: '', extra: '' },
            { installation: undefined, authentication: '' },
            { installation: '', authentication: 1 },
          ]) {
            invalid.push({ ...spec, metadata: { ...spec.metadata, policy } });
          }
        }
      }
      for (const input of invalid) {
        let caught: unknown;
        try {
          marketplaceDocuments(input as MarketplaceSpec);
        } catch (error) {
          caught = error;
        }
        expect(caught?.constructor).toBe(TypeError);
        expect((caught as Error).message).toBe('Invalid marketplaceDocuments input.');
        expect(Object.hasOwn(caught as object, 'cause')).toBe(false);
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
