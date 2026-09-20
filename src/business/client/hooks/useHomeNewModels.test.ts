import { renderHook } from '@testing-library/react';
import type { EnabledAiModel } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHomeNewModels } from './useHomeNewModels';

const { infra, server } = vi.hoisted(() => ({
  infra: { enabledAiModels: undefined } as { enabledAiModels?: EnabledAiModel[] },
  server: { serverConfig: { enableCreditBilling: true } },
}));

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (select: (state: typeof infra) => unknown) => select(infra),
}));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (select: (state: typeof server) => unknown) => select(server),
}));

beforeEach(() => {
  infra.enabledAiModels = undefined;
  server.serverConfig.enableCreditBilling = true;
});

describe('homepage model loading', () => {
  const fallback = [{ model: 'unconfigured', title: 'Promotion', type: 'chat' as const }];

  it('renders safely before models arrive and updates to the configured catalog', () => {
    const { result, rerender } = renderHook(() => useHomeNewModels(fallback));
    expect(result.current).toEqual({ isLoading: true, items: [] });

    infra.enabledAiModels = [{
      abilities: {},
      enabled: true,
      id: 'configured',
      providerId: '1',
      type: 'chat',
    }];
    rerender();
    expect(result.current).toEqual({
      isLoading: false,
      items: [{ model: 'configured', provider: '1', title: 'configured', type: 'chat' }],
    });
  });

  it('does not fall back to built-in promotions when a managed catalog is empty', () => {
    infra.enabledAiModels = [];
    const { result } = renderHook(() => useHomeNewModels(fallback));
    expect(result.current).toEqual({ isLoading: false, items: [] });
  });

  it('preserves unmanaged promotions without waiting for the provider store', () => {
    server.serverConfig.enableCreditBilling = false;
    const { result } = renderHook(() => useHomeNewModels(fallback));
    expect(result.current).toEqual({ isLoading: false, items: fallback });
  });
});
