export type MarketplaceSpec = {
  marketplaceName: string;
  pluginName: string;
  relativeSource: string;
  version: string;
  ownerName: string;
  metadata:
    | {
        kind: 'interface-policy';
        displayName: string;
        policy: { installation: string; authentication: string };
        category: string;
      }
    | { kind: 'described'; description: string };
};

type InterfacePolicyDocuments = {
  codexDocument: {
    name: string;
    interface: { displayName: string };
    plugins: [
      {
        name: string;
        source: { source: 'local'; path: string };
        policy: { installation: string; authentication: string };
        category: string;
      },
    ];
  };
  claudeDocument: {
    name: string;
    owner: { name: string };
    plugins: [{ name: string; source: string; version: string }];
  };
};
type DescribedDocuments = {
  codexDocument: {
    name: string;
    owner: { name: string };
    plugins: [
      {
        name: string;
        version: string;
        description: string;
        source: { source: 'local'; path: string };
      },
    ];
  };
  claudeDocument: {
    name: string;
    owner: { name: string };
    plugins: [{ name: string; version: string; description: string; source: string }];
  };
};
export type MarketplaceDocuments = InterfacePolicyDocuments | DescribedDocuments;

function closedRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      return property !== undefined && Object.hasOwn(property, 'value');
    })
  );
}

function valid(value: unknown): value is MarketplaceSpec {
  if (
    !closedRecord(value, ['marketplaceName', 'pluginName', 'relativeSource', 'version', 'ownerName', 'metadata']) ||
    !['marketplaceName', 'pluginName', 'relativeSource', 'version', 'ownerName'].every(
      (key) => typeof value[key] === 'string',
    )
  )
    return false;
  const metadata = value.metadata;
  if (closedRecord(metadata, ['kind', 'description']))
    return metadata.kind === 'described' && typeof metadata.description === 'string';
  return (
    closedRecord(metadata, ['kind', 'displayName', 'policy', 'category']) &&
    metadata.kind === 'interface-policy' &&
    typeof metadata.displayName === 'string' &&
    typeof metadata.category === 'string' &&
    closedRecord(metadata.policy, ['installation', 'authentication']) &&
    typeof metadata.policy.installation === 'string' &&
    typeof metadata.policy.authentication === 'string'
  );
}

export function marketplaceDocuments(spec: MarketplaceSpec): MarketplaceDocuments {
  // Only ordinary data properties are read. Invalid direct input never enters a constructor.
  let accepted = false;
  try {
    accepted = valid(spec);
  } catch {
    /* A non-JSON exotic record is invalid. */
  }
  if (!accepted) throw new TypeError('Invalid marketplaceDocuments input.');
  if (spec.metadata.kind === 'interface-policy') {
    return {
      codexDocument: {
        name: spec.marketplaceName,
        interface: { displayName: spec.metadata.displayName },
        plugins: [
          {
            name: spec.pluginName,
            source: { source: 'local', path: spec.relativeSource },
            policy: {
              installation: spec.metadata.policy.installation,
              authentication: spec.metadata.policy.authentication,
            },
            category: spec.metadata.category,
          },
        ],
      },
      claudeDocument: {
        name: spec.marketplaceName,
        owner: { name: spec.ownerName },
        plugins: [{ name: spec.pluginName, source: spec.relativeSource, version: spec.version }],
      },
    };
  }
  return {
    codexDocument: {
      name: spec.marketplaceName,
      owner: { name: spec.ownerName },
      plugins: [
        {
          name: spec.pluginName,
          version: spec.version,
          description: spec.metadata.description,
          source: { source: 'local', path: spec.relativeSource },
        },
      ],
    },
    claudeDocument: {
      name: spec.marketplaceName,
      owner: { name: spec.ownerName },
      plugins: [
        {
          name: spec.pluginName,
          version: spec.version,
          description: spec.metadata.description,
          source: spec.relativeSource,
        },
      ],
    },
  };
}
