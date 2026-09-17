import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyAdminCatalog,
  getAdminCatalog,
  getAdminProviderPayload,
  hasUserProviderConfiguration,
} from './index';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Go admin integration', () => {
  it('leaves installations without an admin service unchanged', async () => {
    vi.stubEnv('ADMIN_SERVICE_URL', '');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, data: { id: 'openai', sdkType: 'openai', baseURL: '', enabled: false } })));
    await expect(getAdminProviderPayload('openai')).rejects.toThrow('disabled');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(getAdminProviderPayload('openai')).rejects.toThrow('unavailable');
  });

  it('exposes managed model availability without exposing provider secrets', async () => {
    vi.stubEnv('ADMIN_SERVICE_URL', 'http://admin:3211');
    vi.stubEnv('ADMIN_INTEGRATION_TOKEN', 'test-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, data: {
      providers: [{ id: 'openai', name: 'OpenAI', sdkType: 'openai', baseURL: 'https://api.example/v1', enabled: true, configured: true, apiKey: 'must-not-leak' }],
      prices: [{ id: 'p1', provider: 'openai', modelId: 'managed-model', displayName: 'Managed model', promptCreditsPerKToken: 3, completionCreditsPerKToken: 8, contextWindow: 128000, functionCall: true, vision: false }],
    } })));
    const catalog = await getAdminCatalog();
    expect(catalog).toBeDefined();
    const config = applyAdminCatalog({}, catalog!);
    expect(config.openai.enabledModels).toEqual(['managed-model']);
    expect(config.openai.enabled).toBe(true);
    expect(JSON.stringify(config)).not.toContain('must-not-leak');
    expect(JSON.stringify(config)).not.toContain('api.example');
  });
});
