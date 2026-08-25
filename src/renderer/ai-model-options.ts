export interface AIProviderOptionSource {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  enabledModels?: string[];
  activeModel: string;
  isCustom: boolean;
}

export interface AIConfigOptionSource {
  mode?: 'orca' | 'builtin';
  activeProviderId: string;
  activeProfileId?: string;
  providers: AIProviderOptionSource[];
  profiles?: any[];
  streamEnabled?: boolean;
  orcaBaseUrl?: string;
}

export interface ModelOption {
  providerId: string;
  providerName: string;
  model: string;
  label: string;
  value: string;
}

export const ORCA_MODEL_VALUE = 'orca::__local';

export function modelSelectionValue(mode: 'orca' | 'builtin' | undefined, providerId: string, model: string): string {
  return `${providerId}::${model}`;
}

export function parseModelSelection(value: string): { mode: 'orca' } | { mode: 'builtin'; providerId: string; model: string } {
  if (value === ORCA_MODEL_VALUE) return { mode: 'orca' };
  const [providerId, ...modelParts] = value.split('::');
  return { mode: 'builtin', providerId: providerId!, model: modelParts.join('::') };
}

export function getConfiguredModelOptions(config: AIConfigOptionSource): ModelOption[] {
  return config.providers.flatMap(provider => {
    if (!provider.apiKey?.trim()) return [];
    const visibleModels = provider.enabledModels && provider.enabledModels.length > 0
      ? provider.models.filter(model => provider.enabledModels?.includes(model))
      : provider.models;
    return (visibleModels || [])
      .map(model => model.trim())
      .filter(Boolean)
      .map(model => ({
        providerId: provider.id,
        providerName: provider.name,
        model,
        label: `${provider.name} / ${model}`,
        value: `${provider.id}::${model}`,
      }));
  });
}
