import type { AiFullModelCard, ModelProviderKey } from 'model-bank';

import type { ChatModelCard } from '../../llm';

export interface ProviderConfig {
  /** Deployment-owned catalog; user rows must not expand its availability. */
  adminManaged?: boolean;
  /**
   * whether to auto fetch model lists
   */
  autoFetchModelLists?: boolean;
  /**
   * user defined model cards
   */
  customModelCards?: ChatModelCard[];
  enabled: boolean;
  /**
   * enabled models id
   */
  enabledModels?: string[] | null;
  /**
   * whether fetch on client
   */
  fetchOnClient?: boolean;
  /**
   * the latest fetch model list time
   */
  latestFetchTime?: number;
  name?: string;
  /**
   * fetched models from provider side
   */
  remoteModelCards?: ChatModelCard[];
  sdkType?: string;
  serverModelLists?: AiFullModelCard[];
}

export type GlobalLLMProviderKey = ModelProviderKey;

export type UserModelProviderConfig = Record<ModelProviderKey, ProviderConfig>;
