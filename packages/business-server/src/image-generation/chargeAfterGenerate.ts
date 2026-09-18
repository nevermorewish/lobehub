import { type ModelPricingContext } from '@lobechat/model-runtime';
import { type SpendOrigin } from '@lobechat/types';

import { getServerDB } from '@/database/core/db-adaptor';
import { settleGeneration } from '@/server/services/billing/generation';
import { type ModelPerformance, type ModelUsage } from '@/types/index';

interface ChargeParams {
  isError?: boolean;
  metadata: SpendOrigin & {
    asyncTaskId?: string;
    generationBatchId?: string;
    modelId: string;
    topicId?: string;
  };
  metrics?: ModelPerformance;
  modelUsage?: ModelUsage;
  /** Opaque billing handle passed through from `asyncTask.metadata.precharge`. */
  prechargeResult?: unknown;
  pricingContext?: ModelPricingContext;
  provider: string;
  userId: string;
  workspaceId?: string;
}

export async function chargeAfterGenerate(params: ChargeParams): Promise<void> {
  if (!process.env.ADMIN_SERVICE_URL || !params.prechargeResult) return;
  await settleGeneration(await getServerDB(), { handle: params.prechargeResult, isError: params.isError,
    model: params.metadata.modelId, provider: params.provider, userId: params.userId });
}
