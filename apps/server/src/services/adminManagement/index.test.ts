import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyAdminCatalog,
  getAdminCatalog,
  getAdminProviderPayload,
  hasUserProviderConfiguration,
} from './index';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Go admin integration', () => {
  it('removes built-in defaults and stale models when the managed catalog is empty', () => {
    const config = applyAdminCatalog(
      {
        openai: {
          enabled: true,
          enabledModels: ['gpt-4'],
          serverModelLists: [{ id: 'gpt-4', type: 'chat', enabled: true }],
        },
      },
      { providers: [], prices: [] },
    );
    expect(config.openai).toMatchObject({
      adminManaged: true,
      enabled: false,
      enabledModels: [],
      serverModelLists: [],
    });
  });

  it('keeps configured providers with no published prices empty', () => {
    const config = applyAdminCatalog(
      { openai: { enabled: true, enabledModels: ['gpt-4'] } },
      {
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            sdkType: 'openai',
            baseURL: '',
            enabled: true,
            configured: true,
          },
        ],
        prices: [],
      },
    );
    expect(config.openai.enabled).toBe(false);
    expect(config.openai.serverModelLists).toEqual([]);
  });

  it('normalizes an OpenAI origin to its API path for custom numeric provider IDs', async () => {
    vi.stubEnv('ADMIN_SERVICE_URL', 'http://admin:3211');
    vi.stubEnv('ADMIN_INTEGRATION_TOKEN', 'test-token');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({
            success: true,
            data: {
              id: '1',
              sdkType: 'openai',
              baseURL: 'https://api.example',
              enabled: true,
              apiKey: 'server-only',
            },
          }),
        ),
    );
    expect(await getAdminProviderPayload('1')).toMatchObject({
      runtimeProvider: 'openai',
      baseURL: 'https://api.example/v1',
      apiKey: 'server-only',
    });
  });
  it('leaves installations without an admin service unchanged', async () => {
    vi.stubEnv('ADMIN_SERVICE_URL', '');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await getAdminCatalog()).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps platform credentials away from every user-configured endpoint', () => {
    expect(hasUserProviderConfiguration({})).toBe(false);
    expect(hasUserProviderConfiguration({ apiKey: '' })).toBe(false);
    expect(hasUserProviderConfiguration({ baseURL: 'https://user.example/v1' })).toBe(true);
    expect(hasUserProviderConfiguration({ apiKey: 'user-key' })).toBe(true);
  });

  it('fails closed for disabled providers and backend outages', async () => {
    vi.stubEnv('ADMIN_SERVICE_URL', 'http://admin:3211');
    vi.stubEnv('ADMIN_INTEGRATION_TOKEN', 'test-token');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({
            success: true,
            data: { id: 'openai', sdkType: 'openai', baseURL: '', enabled: false },
          }),
        ),
    );
    await expect(getAdminProviderPayload('openai')).rejects.toThrow('disabled');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(getAdminProviderPayload('openai')).rejects.toThrow('unavailable');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(getAdminCatalog()).rejects.toThrow('unavailable');
    await expect(getAdminProviderPayload('missing')).rejects.toThrow('not configured');
  });

  it('exposes managed model availability without exposing provider secrets', async () => {
    vi.stubEnv('ADMIN_SERVICE_URL', 'http://admin:3211');
    vi.stubEnv('ADMIN_INTEGRATION_TOKEN', 'test-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          success: true,
          data: {
            providers: [
              {
                id: 'openai',
                name: 'OpenAI',
                sdkType: 'openai',
                baseURL: 'https://api.example/v1',
                enabled: true,
                configured: true,
                apiKey: 'must-not-leak',
              },
            ],
            prices: [
              {
                id: 'p1',
                provider: 'openai',
                modelId: 'managed-model',
                displayName: 'Managed model',
                promptCreditsPerKToken: 3,
                completionCreditsPerKToken: 8,
                contextWindow: 128000,
                functionCall: true,
                vision: false,
              },
            ],
          },
        }),
      ),
    );
    const catalog = await getAdminCatalog();
    expect(catalog).toBeDefined();
    const config = applyAdminCatalog({}, catalog!);
    expect(config.openai.enabledModels).toEqual(['managed-model']);
    expect(config.openai.enabled).toBe(true);
    expect(JSON.stringify(config)).not.toContain('must-not-leak');
    expect(JSON.stringify(config)).not.toContain('api.example');
  });
});
