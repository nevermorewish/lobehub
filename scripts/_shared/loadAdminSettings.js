const allowedKeys = new Set([
  'APP_URL',
  'INTERNAL_APP_URL',
  'SEARXNG_URL',
  'LLM_VISION_IMAGE_USE_BASE64',
  'S3_ENDPOINT',
  'S3_INTERNAL_ENDPOINT',
  'S3_BUCKET',
  'S3_REGION',
  'S3_PUBLIC_DOMAIN',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_ENABLE_PATH_STYLE',
  'S3_SET_ACL',
  'S3_PREVIEW_URL_EXPIRE_IN',
]);

// Load before spawning Next.js: env modules, auth callbacks and S3 clients capture
// their configuration during initialization. Never log the response or credentials.
async function loadAdminSettings(env = process.env, fetcher = fetch) {
  if (!env.ADMIN_SERVICE_URL) return;
  if (!env.ADMIN_INTEGRATION_TOKEN) throw new Error('ADMIN_INTEGRATION_TOKEN is required');
  let response;
  try {
    response = await fetcher(`${env.ADMIN_SERVICE_URL.replace(/\/$/, '')}/internal/v1/settings`, {
      headers: { Authorization: `Bearer ${env.ADMIN_INTEGRATION_TOKEN}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error('Cannot load admin settings; check admin service availability');
  }
  if (!response.ok) throw new Error(`Cannot load admin settings (${response.status})`);
  const body = await response.json();
  if (
    body?.success !== true ||
    !body.data ||
    typeof body.data !== 'object' ||
    Array.isArray(body.data)
  ) {
    throw new Error('Invalid admin settings response');
  }
  const entries = Object.entries(body.data);
  // Validate the entire response before applying any values.
  for (const [key, value] of entries) {
    if (!allowedKeys.has(key) || typeof value !== 'string' || /[\0\r\n]/.test(value)) {
      throw new Error('Invalid admin settings response');
    }
  }
  for (const [key, value] of entries) {
    if (value === '') delete env[key];
    else env[key] = value;
  }
  // Prevent the deprecated alias from resurrecting a deliberately cleared domain.
  if (Object.hasOwn(body.data, 'S3_PUBLIC_DOMAIN')) delete env.NEXT_PUBLIC_S3_DOMAIN;
}

module.exports = { loadAdminSettings };
