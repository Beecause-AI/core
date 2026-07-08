import type { ModelKey } from './api';

export type AiProviderId = 'anthropic' | 'openai' | 'google' | 'openai-compatible';

export type AiProvider = {
  id: AiProviderId;
  label: string; // 'Anthropic (Claude)'
  blurb: string;
  needsBaseUrl: boolean;
  placeholder: string; // API-key input placeholder
  href: string; // '/admin/ai-providers/anthropic'
};

/** Single source of truth for the AI Providers hub and every detail page. */
export const AI_PROVIDERS: AiProvider[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', blurb: 'Use your Anthropic API key for Claude models.', needsBaseUrl: false, placeholder: 'sk-ant-…', href: '/admin/ai-providers/anthropic' },
  { id: 'openai', label: 'OpenAI', blurb: 'Use your OpenAI API key for GPT models.', needsBaseUrl: false, placeholder: 'sk-…', href: '/admin/ai-providers/openai' },
  { id: 'google', label: 'Google (Gemini)', blurb: 'Use your Gemini API key from Google AI Studio.', needsBaseUrl: false, placeholder: 'AIza…', href: '/admin/ai-providers/google' },
  { id: 'openai-compatible', label: 'Custom (OpenAI-compatible)', blurb: 'Any OpenAI-compatible endpoint — Groq, Together, OpenRouter, or self-hosted.', needsBaseUrl: true, placeholder: 'sk-…', href: '/admin/ai-providers/openai-compatible' },
];

export function getAiProvider(id: string): AiProvider | undefined {
  return AI_PROVIDERS.find((p) => p.id === id);
}

export type ProviderStatus = { label: string; status: 'ok' | 'crit' | 'neutral' };

/** Status shown on the hub card and the detail panel, derived from the stored key. */
export function providerStatus(key: ModelKey | undefined): ProviderStatus {
  if (!key) return { label: 'Not configured', status: 'neutral' };
  if (!key.enabled) return { label: 'Disabled', status: 'neutral' };
  if (key.lastTestOk === false) return { label: 'Rejected', status: 'crit' };
  return { label: 'Connected', status: 'ok' };
}
