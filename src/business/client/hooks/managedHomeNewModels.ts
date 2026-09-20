import type { EnabledAiModel } from 'model-bank';

import type { HomeNewModelItem } from './useHomeNewModels';

export const managedHomeNewModels = (models: EnabledAiModel[]): HomeNewModelItem[] =>
  models
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
