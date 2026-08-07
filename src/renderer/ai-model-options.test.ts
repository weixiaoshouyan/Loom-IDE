import { describe, expect, it } from 'vitest';
import { getConfiguredModelOptions, modelSelectionValue } from './ai-model-options';

describe('ai model options', () => {
  it('only exposes models from providers with an API key', () => {
    const options = getConfiguredModelOptions({
      mode: 'builtin',
      activeProviderId: 'deepseek',
      activeProfileId: 'coder',
      streamEnabled: true,
      providers: [
        { id: 'deepseek', name: 'DeepSeek', apiKey: 'sk-a', baseUrl: '', models: ['deepseek-chat', 'deepseek-coder'], activeModel: 'deepseek-chat', isCustom: false },
        { id: 'openai', name: 'OpenAI', apiKey: '', baseUrl: '', models: ['gpt-4o'], activeModel: 'gpt-4o', isCustom: false },
        { id: 'custom', name: 'Custom', apiKey: 'sk-c', baseUrl: '', models: [''], activeModel: '', isCustom: true },
      ],
      profiles: [],
      orcaBaseUrl: 'http://127.0.0.1:18080',
    });

    expect(options.map(o => o.value)).toEqual([
      'deepseek::deepseek-chat',
      'deepseek::deepseek-coder',
    ]);
  });

  it('only exposes checked models when a provider has enabled models', () => {
    const options = getConfiguredModelOptions({
      mode: 'builtin',
      activeProviderId: 'deepseek',
      activeProfileId: 'coder',
      streamEnabled: true,
      providers: [
        {
          id: 'deepseek',
          name: 'DeepSeek',
          apiKey: 'sk-a',
          baseUrl: '',
          models: ['deepseek-chat', 'deepseek-reasoner'],
          enabledModels: ['deepseek-reasoner'],
          activeModel: 'deepseek-reasoner',
          isCustom: false,
        },
      ],
      profiles: [],
    });

    expect(options.map(o => o.value)).toEqual(['deepseek::deepseek-reasoner']);
  });

  it('uses the active provider and model as the selection value', () => {
    expect(modelSelectionValue('builtin', 'deepseek', 'deepseek-chat')).toBe('deepseek::deepseek-chat');
    expect(modelSelectionValue('orca', 'deepseek', 'deepseek-chat')).toBe('deepseek::deepseek-chat');
  });
});
