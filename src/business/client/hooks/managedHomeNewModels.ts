import type { EnabledAiModel } from 'model-bank';

import type { HomeNewModelItem } from './useHomeNewModels';

// Runtime models are absent on a cold start until the provider request resolves.
export const managedHomeNewModels = (models?: EnabledAiModel[] | null): HomeNewModelItem[] =>
  (models ?? [])
    .flatMap((model): HomeNewModelItem[] => {
      if (!model.enabled || !['chat', 'image', 'video'].includes(model.type)) return [];
      return [
        {
          model: model.id,
          provider: model.providerId,
          title: model.displayName || model.id,
          type: model.type as HomeNewModelItem['type'],
        },
      ];
    })
    .slice(0, 4);
