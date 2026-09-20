import { useAiInfraStore } from '@/store/aiInfra';
import { useServerConfigStore } from '@/store/serverConfig';

import { managedHomeNewModels } from './managedHomeNewModels';

export type HomeNewModelType = 'chat' | 'image' | 'video';

export interface HomeNewModelItem {
  iconModel?: string;
  /** Optional image URL rendered instead of the model icon mapping. */
  iconUrl?: string;
  model: string;
  provider?: string;
  title: string;
  type: HomeNewModelType;
}

export interface HomeNewModelsState {
  isLoading: boolean;
  items: HomeNewModelItem[];
}

export const useHomeNewModels = (fallbackItems: HomeNewModelItem[]): HomeNewModelsState => {
  // This deployment flag is enabled only when ADMIN_SERVICE_URL is configured.
  const managed = useServerConfigStore((state) => !!state.serverConfig.enableCreditBilling);
  const models = useAiInfraStore((state) => state.enabledAiModels);
  // Managed deployments have no global "new model" promotions: only published
  // catalog entries may become shortcuts, including their actual provider IDs.
  return {
    isLoading: managed && models == null,
    items: managed ? managedHomeNewModels(models) : fallbackItems,
  };
};
