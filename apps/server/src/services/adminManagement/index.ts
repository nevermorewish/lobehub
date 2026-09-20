import type { ClientSecretPayload, ProviderConfig } from '@lobechat/types';
import { z } from 'zod';

const providerSchema = z.object({
  baseURL: z.string(),
  configured: z.boolean(),
  enabled: z.boolean(),
  id: z.string(),
  name: z.string(),
  sdkType: z.string(),
});
const priceSchema = z.object({
  modelType: z.enum(['chat', 'image', 'video']).default('chat'),
  requestCreditsFlat: z.number().int().nonnegative().default(0),
  completionCreditsPerKToken: z.number().int().nonnegative(),
  contextWindow: z.number().int().nonnegative(),
  displayName: z.string(),
  functionCall: z.boolean(),
  id: z.string(),
  modelId: z.string(),
  promptCreditsPerKToken: z.number().int().nonnegative(),
  provider: z.string(),
  vision: z.boolean(),
});
const catalogSchema = z.object({
  providers: z.array(providerSchema),
  prices: z.array(priceSchema),
});
const runtimeSchema = z.object({
  accessKeyId: z.string().optional(),
  apiKey: z.string().optional(),
  baseURL: z.string(),
  enabled: z.boolean(),
  id: z.string(),
  region: z.string().optional(),
  sdkType: z.string(),
  secretAccessKey: z.string().optional(),
  sessionToken: z.string().optional(),
});

export type AdminCatalog = z.infer<typeof catalogSchema>;

// An opt-in integration: installations without ADMIN_SERVICE_URL retain existing behavior.
// Credentials never travel through client/global configuration responses.
async function request<T>(path: string, schema: z.ZodType<T>): Promise<T | undefined> {
  const baseURL = process.env.ADMIN_SERVICE_URL;
  if (!baseURL) return undefined;
  const token = process.env.ADMIN_INTEGRATION_TOKEN;
  if (!token) throw new Error('ADMIN_INTEGRATION_TOKEN is required with ADMIN_SERVICE_URL');
  const response = await fetch(`${baseURL.replace(/\/$/, '')}/internal/v1${path}`, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Admin service unavailable (${response.status})`);
  const body: unknown = await response.json();
  return z.object({ data: schema, success: z.literal(true) }).parse(body).data;
}

export const getAdminCatalog = async () => {
  const catalog = await request('/catalog', catalogSchema);
  if (!catalog && process.env.ADMIN_SERVICE_URL) throw new Error('Admin model catalog unavailable');
  return catalog;
};

const alipaySchema = z.object({
  enabled: z.boolean(),
  config: z.object({
    appId: z.string().min(1),
    merchantId: z.string().min(1),
    currency: z.literal('CNY'),
    notifyURL: z.url(),
    returnURL: z.url(),
    sandbox: z.boolean(),
  }),
  privateKey: z.string().min(1),
  publicKey: z.string().min(1),
});

export const getAdminAlipayConfig = () => request('/payments/alipay', alipaySchema);
export type AlipayConfig = z.infer<typeof alipaySchema>;

export async function getAdminProviderPayload(
  provider: string,
): Promise<ClientSecretPayload | undefined> {
  const data = await request(`/providers/${encodeURIComponent(provider)}`, runtimeSchema);
  if (!data) {
    if (process.env.ADMIN_SERVICE_URL)
      throw new Error('This provider is not configured by the administrator');
    return undefined;
  }
  if (!data.enabled) throw new Error('This platform provider is disabled by the administrator');
  let baseURL = data.baseURL || undefined;
  if (baseURL && data.sdkType === 'openai') {
    const url = new URL(baseURL);
    if (url.pathname === '/') {
      url.pathname = '/v1';
      baseURL = url.toString();
    }
  }
  return {
    apiKey: data.apiKey,
    awsAccessKeyId: data.accessKeyId,
    awsRegion: data.region,
    awsSecretAccessKey: data.secretAccessKey,
    awsSessionToken: data.sessionToken,
    baseURL,
    runtimeProvider: data.sdkType,
  };
}

/** Never send platform credentials to an endpoint supplied by a user. */
export const hasUserProviderConfiguration = (keyVaults: object) =>
  Object.values(keyVaults).some((value) => value !== undefined && value !== null && value !== '');

export function applyAdminCatalog(config: Record<string, ProviderConfig>, catalog: AdminCatalog) {
  // An integrated deployment has an allowlist, not an overlay on model-bank.
  for (const id of Object.keys(config)) {
    config[id] = {
      adminManaged: true,
      enabled: false,
      enabledModels: [],
      fetchOnClient: false,
      serverModelLists: [],
    };
  }
  for (const provider of catalog.providers) {
    const prices = catalog.prices.filter((price) => price.provider === provider.id);
    const enabled = provider.enabled && provider.configured && prices.length > 0;
    config[provider.id] = {
      adminManaged: true,
      name: provider.name,
      sdkType: provider.sdkType,
      enabled,
      fetchOnClient: false,
      enabledModels: enabled ? prices.map((price) => price.modelId) : [],
      serverModelLists: enabled
        ? prices.map((price) => ({
            abilities: { functionCall: price.functionCall, vision: price.vision },
            contextWindowTokens: price.contextWindow,
            displayName: price.displayName || price.modelId,
            enabled: true,
            id: price.modelId,
            type: price.modelType,
          }))
        : [],
    };
  }
  return config;
}

/** Listing platform models never calls an upstream API or needs browser credentials. */
export async function getAdminProviderModels(provider: string) {
  const catalog = await getAdminCatalog();
  if (!catalog) return undefined;
  return applyAdminCatalog({}, catalog)[provider]?.serverModelLists ?? [];
}
