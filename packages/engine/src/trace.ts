export type SpanStatus = 'ok' | 'error';

export interface ModelCallSpan {
  setUsage(inputTokens: number, outputTokens: number): void;
  end(status: SpanStatus, error?: string): void;
}
export interface ToolStepDetail {
  error?: string;
  argsPreview?: string;
  resultPreview?: string;
  args?: string;
  result?: string;
  childConversationId?: string;
}
export interface ToolCallSpan {
  end(status: SpanStatus, detail?: ToolStepDetail): void;
}
/** Per-turn observer the engine drives. Implementations export to OTel and/or persist basics.
 *  The engine never imports an OTel SDK — it only calls this interface. */
export interface TurnTrace {
  startModelCall(model: string): ModelCallSpan;
  startToolCall(name: string, kind?: string): ToolCallSpan;
  end(status: SpanStatus, finishReason?: string, error?: string): void;
}
/** Default no-op so the engine runs without an observer. */
export const noopTurnTrace: TurnTrace = {
  startModelCall: () => ({ setUsage() {}, end() {} }),
  startToolCall: () => ({ end() {} }),
  end() {},
};
