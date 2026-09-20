import type { AiProviderListItem } from '@lobechat/types';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { LobeChatDatabase } from '../../../type';
import { AiInfraRepos } from '../index';

const userId = 'test-user-id';
const mockProviderConfigs = {
  openai: { enabled: true },
  anthropic: { enabled: false },
};

let serverDB: LobeChatDatabase;
let repo: AiInfraRepos;

beforeAll(async () => {
  serverDB = await getTestDB();
}, 30000);

beforeEach(() => {
  vi.clearAllMocks();
  repo = new AiInfraRepos(serverDB, userId, mockProviderConfigs);
});

describe('AiInfraRepos', () => {
  describe('getAiProviderList', () => {
    it('publishes numeric managed providers without user-created provider rows', async () => {
      const managed = new AiInfraRepos(serverDB, userId, {
        openai: { adminManaged: true, enabled: false, serverModelLists: [] },
        '1': {
          adminManaged: true,
          enabled: true,
          name: 'Managed',
          sdkType: 'openai',
          serverModelLists: [{ id: 'managed-model', type: 'chat', enabled: true }],
        },
      });
      expect(await managed.getAiProviderList()).toEqual([
        { id: '1', name: 'Managed', enabled: true, source: 'builtin' },
      ]);
      expect(await managed.getEnabledModels(false)).toMatchObject([
        { id: 'managed-model', providerId: '1', enabled: true },
      ]);
      expect(await managed.getAiProviderModelList('openai')).toEqual([]);
      expect(await managed.getAiProviderModelList('not-configured')).toEqual([]);
    });
    it('should merge builtin and user providers correctly', async () => {
      const mockUserProviders = [
        { id: 'openai', enabled: true, name: 'Custom OpenAI' },
        { id: 'custom', enabled: true, name: 'Custom Provider' },
      ] as AiProviderListItem[];

      vi.spyOn(repo.aiProviderModel, 'getAiProviderList').mockResolvedValueOnce(mockUserProviders);

      const result = await repo.getAiProviderList();

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      // Verify the merge logic
      const openaiProvider = result.find((p) => p.id === 'openai');
      expect(openaiProvider).toMatchObject({ enabled: true, name: 'Custom OpenAI' });
    });

    it('should sort providers according to DEFAULT_MODEL_PROVIDER_LIST order', async () => {
      vi.spyOn(repo.aiProviderModel, 'getAiProviderList').mockResolvedValue([]);

      const result = await repo.getAiProviderList();

      expect(result).toEqual(
        expect.arrayContaining(
          DEFAULT_MODEL_PROVIDER_LIST.map((item) =>
            expect.objectContaining({
              id: item.id,
              source: 'builtin',
            }),
          ),
        ),
      );
    });
  });
});
