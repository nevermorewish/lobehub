import { type SpendOrigin } from '@lobechat/types';

import { getServerDB } from '@/database/core/db-adaptor';
import { settleGeneration } from '@/server/services/billing/generation';

interface ChargeParams {
  computePriceParams?: { generateAudio?: boolean; resolution?: string };
  isError?: boolean;
  /** Total time from task submission to webhook callback (ms) */
  latency?: number;
  metadata: SpendOrigin & {
    asyncTaskId?: string;
    generationBatchId?: string;
    modelId: string;
    topicId?: string;
  };
  model: string;
  prechargeResult?: Record<string, unknown>;
  provider: string;
  usage?: { completionTokens: number; totalTokens: number };
  userId: string;
  workspaceId?: string;
}

export async function chargeAfterGenerate(params: ChargeParams): Promise<void> {
  if (!process.env.ADMIN_SERVICE_URL || !params.prechargeResult) return;
  await settleGeneration(await getServerDB(), { handle: params.prechargeResult, isError: params.isError,
    model: params.metadata.modelId, provider: params.provider, userId: params.userId });
}
