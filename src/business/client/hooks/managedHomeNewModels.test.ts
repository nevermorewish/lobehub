import type { EnabledAiModel } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { managedHomeNewModels } from './managedHomeNewModels';

describe('managed homepage model shortcuts', () => {
  it.each([undefined, null])('keeps the first render stable while models are %s', (models) => {
    expect(managedHomeNewModels(models)).toEqual([]);
  });

  it('keeps empty deployments empty rather than promoting built-in models', () => {
    expect(managedHomeNewModels([])).toEqual([]);
  });

  it('preserves the managed provider and excludes disabled and non-generation models', () => {
    const models = [
      {
        id: 'gpt-6-astra',
        providerId: '1',
        displayName: 'Managed GPT',
        enabled: true,
        type: 'chat',
      },
      { id: 'hidden', providerId: '1', enabled: false, type: 'chat' },
      { id: 'embed', providerId: '1', enabled: true, type: 'embedding' },
    ] as EnabledAiModel[];
    expect(managedHomeNewModels(models)).toEqual([
      { model: 'gpt-6-astra', provider: '1', title: 'Managed GPT', type: 'chat' },
    ]);
  });
});
