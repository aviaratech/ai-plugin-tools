import { expect, test, vi } from 'vitest';
import { nativePluginArgs } from './index.js';
import type { NativePluginSpec } from './index.js';

// Literal vectors independently match both pinned caller constructors identified
// in marketplace.test.ts; expected arrays never use the new mapping implementation.
const vectors: [NativePluginSpec, string[]][] = [
  [
    { host: 'codex', action: 'install', scope: 'user', pluginId: 'example@market' },
    ['plugin', 'add', 'example@market', '--json'],
  ],
  [
    { host: 'codex', action: 'update', scope: 'user', pluginId: 'example@market' },
    ['plugin', 'add', 'example@market', '--json'],
  ],
  [
    { host: 'codex', action: 'remove', scope: 'user', pluginId: 'example@market' },
    ['plugin', 'remove', 'example@market', '--json'],
  ],
  [
    { host: 'claude-code', action: 'install', scope: 'user', pluginId: 'example@market' },
    ['plugin', 'install', 'example@market', '--scope', 'user'],
  ],
  [
    { host: 'claude-code', action: 'update', scope: 'user', pluginId: 'example@market' },
    ['plugin', 'update', 'example@market', '--scope', 'user'],
  ],
  [
    { host: 'claude-code', action: 'remove', scope: 'user', pluginId: 'example@market' },
    ['plugin', 'uninstall', 'example@market', '--scope', 'user', '--keep-data'],
  ],
  [
    { host: 'claude-code', action: 'install', scope: 'project', pluginId: 'example@market' },
    ['plugin', 'install', 'example@market', '--scope', 'project'],
  ],
  [
    { host: 'claude-code', action: 'update', scope: 'project', pluginId: 'example@market' },
    ['plugin', 'update', 'example@market', '--scope', 'project'],
  ],
  [
    { host: 'claude-code', action: 'remove', scope: 'project', pluginId: 'example@market' },
    ['plugin', 'uninstall', 'example@market', '--scope', 'project', '--keep-data'],
  ],
  [
    { host: 'claude-code', action: 'install', scope: 'local', pluginId: 'example@market' },
    ['plugin', 'install', 'example@market', '--scope', 'local'],
  ],
  [
    { host: 'claude-code', action: 'update', scope: 'local', pluginId: 'example@market' },
    ['plugin', 'update', 'example@market', '--scope', 'local'],
  ],
  [
    { host: 'claude-code', action: 'remove', scope: 'local', pluginId: 'example@market' },
    ['plugin', 'uninstall', 'example@market', '--scope', 'local', '--keep-data'],
  ],
];

test.each(vectors)('native argv matches literal vector %j', (input, want) => {
  expect(nativePluginArgs(input)).toEqual(want);
});
test('native argv preserves opaque selectors and fresh mutable arrays', () => {
  for (const pluginId of ['', 'opaque selector @ value', '  opaque\n@ value  ']) {
    const input: NativePluginSpec = { host: 'claude-code', action: 'remove', pluginId, scope: 'local' };
    const first = nativePluginArgs(input);
    const second = nativePluginArgs(input);
    expect(first).not.toBe(second);
    expect(first).toEqual(['plugin', 'uninstall', pluginId, '--scope', 'local', '--keep-data']);
    first.push('changed');
    expect(second).toHaveLength(6);
    expect(input.pluginId).toBe(pluginId);
  }
});
test('native argv rejects unsupported closed inputs without logging or dispatch', () => {
  const spies = ['log', 'error', 'warn', 'info', 'debug'].map((method) =>
    vi.spyOn(console, method as 'log').mockImplementation(() => {}),
  );
  try {
    const valid = vectors[0]![0];
    const inputs: unknown[] = [
      null,
      [],
      'secret',
      {},
      { ...valid, host: 'unknown' },
      { ...valid, action: 'rollback' },
      { ...valid, scope: 'project' },
      { ...valid, scope: 'local' },
      { ...valid, extra: 'secret' },
      { ...valid, [Symbol('unknown')]: 'secret' },
      { ...vectors[3]![0], scope: 'unknown' },
    ];
    for (const key of Object.keys(valid)) {
      const missing = { ...valid } as Record<string, unknown>;
      delete missing[key];
      inputs.push(
        missing,
        { ...valid, [key]: undefined },
        { ...valid, [key]: 12 },
        Object.assign(Object.create({ [key]: valid[key as keyof NativePluginSpec] }), missing),
      );
    }
    for (const input of inputs) {
      let caught: unknown;
      try {
        nativePluginArgs(input as NativePluginSpec);
      } catch (error) {
        caught = error;
      }
      expect(caught?.constructor).toBe(TypeError);
      expect((caught as Error).message).toBe('Invalid nativePluginArgs input.');
      expect(Object.hasOwn(caught as object, 'cause')).toBe(false);
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
