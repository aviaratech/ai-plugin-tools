export type NativePluginSpec =
  | { host: 'codex'; action: 'install' | 'update' | 'remove'; pluginId: string; scope: 'user' }
  | {
      host: 'claude-code';
      action: 'install' | 'update' | 'remove';
      pluginId: string;
      scope: 'user' | 'project' | 'local';
    };

function valid(value: unknown): value is NativePluginSpec {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Reflect.ownKeys(value).length !== 4)
    return false;
  const spec = value as Record<string, unknown>;
  if (
    !['host', 'action', 'pluginId', 'scope'].every((key) => {
      const property = Object.getOwnPropertyDescriptor(spec, key);
      return property !== undefined && Object.hasOwn(property, 'value') && typeof property.value === 'string';
    })
  )
    return false;
  return (
    ['install', 'update', 'remove'].includes(spec.action as string) &&
    (spec.host === 'codex'
      ? spec.scope === 'user'
      : spec.host === 'claude-code' && ['user', 'project', 'local'].includes(spec.scope as string))
  );
}

export function nativePluginArgs(spec: NativePluginSpec): string[] {
  let accepted = false;
  try {
    accepted = valid(spec);
  } catch {
    /* Non-JSON exotic records are invalid. */
  }
  if (!accepted) throw new TypeError('Invalid nativePluginArgs input.');
  if (spec.host === 'codex') return ['plugin', spec.action === 'remove' ? 'remove' : 'add', spec.pluginId, '--json'];
  if (spec.action === 'remove') return ['plugin', 'uninstall', spec.pluginId, '--scope', spec.scope, '--keep-data'];
  return ['plugin', spec.action, spec.pluginId, '--scope', spec.scope];
}
