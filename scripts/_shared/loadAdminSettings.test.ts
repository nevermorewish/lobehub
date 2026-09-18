import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

const { loadAdminSettings } = createRequire(import.meta.url)('./loadAdminSettings.js');

describe('admin deployment settings', () => {
  it('keeps non-admin deployments unchanged', async () => {
    const fetcher = vi.fn();
    const env = { APP_URL: 'https://legacy.example.com' };
    await loadAdminSettings(env, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(env.APP_URL).toBe('https://legacy.example.com');
  });

  it('applies saved settings and clears optional legacy aliases before startup', async () => {
    const env = {
      ADMIN_SERVICE_URL: 'http://admin:3211/',
      ADMIN_INTEGRATION_TOKEN: 'token',
      APP_URL: 'http://old',
      S3_PUBLIC_DOMAIN: 'http://old-files',
      NEXT_PUBLIC_S3_DOMAIN: 'http://older-files',
    };
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        data: {
          APP_URL: 'https://site.example.com',
          S3_PUBLIC_DOMAIN: '',
          S3_BUCKET: 'new-bucket',
          S3_SECRET_ACCESS_KEY: 'secret',
        },
      }),
    );
    await loadAdminSettings(env, fetcher);
    expect(env).toMatchObject({
      APP_URL: 'https://site.example.com',
      S3_BUCKET: 'new-bucket',
      S3_SECRET_ACCESS_KEY: 'secret',
    });
    expect(env).not.toHaveProperty('S3_PUBLIC_DOMAIN');
    expect(env).not.toHaveProperty('NEXT_PUBLIC_S3_DOMAIN');
    expect(fetcher).toHaveBeenCalledWith(
      'http://admin:3211/internal/v1/settings',
      expect.objectContaining({ redirect: 'error', headers: { Authorization: 'Bearer token' } }),
    );
  });

  it.each([401, 404, 500])(
    'stops startup instead of silently using stale credentials on HTTP %s',
    async (status) => {
      await expect(
        loadAdminSettings(
          { ADMIN_SERVICE_URL: 'http://admin', ADMIN_INTEGRATION_TOKEN: 'token' },
          async () => new Response('', { status }),
        ),
      ).rejects.toThrow('Cannot load admin settings');
    },
  );

  it('rejects arbitrary environment injection without partially applying values', async () => {
    const env = {
      ADMIN_SERVICE_URL: 'http://admin',
      ADMIN_INTEGRATION_TOKEN: 'token',
      APP_URL: 'http://old',
    };
    await expect(
      loadAdminSettings(env, async () =>
        Response.json({
          success: true,
          data: { APP_URL: 'http://new', NODE_OPTIONS: '--inspect' },
        }),
      ),
    ).rejects.toThrow('Invalid admin settings response');
    expect(env.APP_URL).toBe('http://old');
  });
});
