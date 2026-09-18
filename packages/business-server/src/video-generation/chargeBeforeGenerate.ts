import { getServerDB } from '@/database/core/db-adaptor';
import type { NewGeneration, NewGenerationBatch } from '@/database/schemas';
import type { CreateVideoServicePayload } from '@/server/routers/lambda/video';
import { reserveGeneration } from '@/server/services/billing/generation';

interface ChargeParams {
  generationTopicId: string;
  model: string;
  params: CreateVideoServicePayload['params'];
  provider: string;
  userId: string;
  workspaceId?: string;
}

interface ErrorBatch {
  data: {
    batch: NewGenerationBatch;
    generations: NewGeneration[];
  };
  success: true;
}

interface ChargeBeforeResult {
  errorBatch?: ErrorBatch;
  prechargeResult?: Record<string, unknown>;
}

export async function chargeBeforeGenerate(params: ChargeParams): Promise<ChargeBeforeResult> {
  if (!process.env.ADMIN_SERVICE_URL) return {};
  const handles = await reserveGeneration(await getServerDB(), { ...params, count: 1, modelType: 'video' });
  return { prechargeResult: handles?.[0] };
}
