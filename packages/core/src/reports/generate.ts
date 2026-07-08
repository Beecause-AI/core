import type { ConversationThread, ThreadEvent } from '../conversations/thread.js';
import { REPORT_STYLE_PROMPT } from './style-prompt.js';

export interface GenerateReportDeps {
  complete: (prompt: string) => Promise<string>;
}

export interface GenerateReportInput {
  thread: ConversationThread;
  skillPrompt?: string;
}

/** Truncate a string to maxLen chars, appending '…' if truncated. */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '…';
}

/** Serialize the investigation into a plain-text transcript: each message (author: text) and each
 *  tool call as "TOOL <name>  INPUT <json>  OUTPUT <excerpt>" so the report-writer can cite the
 *  exact queries. Keep tool INPUT complete (it is the replication detail); truncate OUTPUT to ~600 chars. */
export function serializeThread(thread: ConversationThread): string {
  const nameForKey = (key: string): string =>
    thread.participants.find((p) => p.key === key)?.name ?? key;

  const lines: string[] = [];

  for (const event of thread.events) {
    if (event.kind === 'message') {
      const author = nameForKey(event.participantKey);
      lines.push(`${author}: ${event.text}`);
    } else if (event.kind === 'tool') {
      const inputStr = event.input ?? '{}';
      const outputStr = event.output ? truncate(event.output, 600) : '(no output)';
      lines.push(`TOOL ${event.name}\nINPUT ${inputStr}\nOUTPUT ${outputStr}`);
    }
    // handover and return events carry no useful text content for the report writer
  }

  return lines.join('\n\n');
}

/** Strip a leading/trailing markdown code fence (```html ... ```), if the model wrapped its output. */
export function stripCodeFences(s: string): string {
  const trimmed = s.trim();
  // Match opening fence: ``` optionally followed by a language tag, then a newline
  const openFenceMatch = trimmed.match(/^```(?:\w+)?\n/);
  if (!openFenceMatch) return s;
  // Must also end with closing fence
  if (!trimmed.endsWith('\n```') && trimmed !== '```') {
    // Check for closing fence at end
    if (!trimmed.endsWith('```')) return s;
  }
  const afterOpen = trimmed.slice(openFenceMatch[0].length);
  // Remove trailing ```
  const closingFenceIdx = afterOpen.lastIndexOf('\n```');
  if (closingFenceIdx === -1) return s;
  return afterOpen.slice(0, closingFenceIdx);
}

/** One model call: prompt = skill prompt + transcript -> standalone HTML document. */
export async function generateReportHtml(
  deps: GenerateReportDeps,
  input: GenerateReportInput,
): Promise<{ html: string }> {
  const transcript = serializeThread(input.thread);
  const prompt =
    (input.skillPrompt ?? REPORT_STYLE_PROMPT) +
    '\n\n--- INVESTIGATION TRANSCRIPT ---\n' +
    transcript;
  const raw = await deps.complete(prompt);
  return { html: stripCodeFences(raw).trim() };
}
