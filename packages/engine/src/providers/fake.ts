import type { ModelEvent, ModelProvider } from '../provider.js';

export type FakeScriptStep =
  | ModelEvent
  | { type: 'error'; error: unknown }
  | { type: 'delay'; ms: number };

class AbortError extends Error {
  constructor() { super('aborted'); this.name = 'AbortError'; }
}

/** A scripted provider for deterministic engine tests. Honors the AbortSignal
 *  between steps and during delays. */
export function fakeProvider(id: string, script: FakeScriptStep[]): ModelProvider {
  return {
    id,
    async *run(_req, _ctx, signal) {
      for (const step of script) {
        if (signal.aborted) throw new AbortError();
        if (step.type === 'error') throw step.error;
        if (step.type === 'delay') {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, step.ms);
            signal.addEventListener('abort', () => { clearTimeout(timer); reject(new AbortError()); }, { once: true });
          });
          continue;
        }
        yield step;
      }
    },
  };
}
