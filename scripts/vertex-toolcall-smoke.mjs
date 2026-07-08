#!/usr/bin/env node
/**
 * Live Vertex Gemini tool-calling smoke test.
 *
 * Proves a Gemini model on Vertex AI can do a full tool-calling loop:
 *   Turn 1: given a `functionDeclarations` tool, the model returns a `functionCall(add)`.
 *   Turn 2: after we send the `functionResponse` back, it returns a final text answer ("5").
 *
 * Request shape mirrors the worker exactly:
 *   - URL:    `${baseUrl}/models/${MODEL}:streamGenerateContent?alt=sse`
 *             (packages/engine/src/providers/google-vertex.ts:14)
 *   - baseUrl: vertexBaseUrl(project, location) =
 *             `https://${host}/v1/projects/${project}/locations/${location}/publishers/google`
 *             host = 'aiplatform.googleapis.com' for location 'global', else `${location}-aiplatform.googleapis.com`
 *             (packages/engine/src/providers/vertex-base.ts:3-6)
 *   - headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }
 *             (packages/engine/src/providers/google-vertex.ts:17)
 *   - body:    geminiBody(req) — tools become a single `tools:[{functionDeclarations:[...]}]`,
 *             a `tool` role msg becomes `{role:'user', parts:[{functionResponse:{name, response:{result}}}]}`,
 *             an assistant tool call becomes `{role:'model', parts:[{functionCall:{name, args}}]}`.
 *             (packages/engine/src/providers/gemini-sse.ts:7-43)
 *   SSE parse mirrors streamGeminiEvents (gemini-sse.ts:54-99): functionCall parts -> tool calls,
 *   text parts -> concatenated answer.
 *
 * Prod defaults: project <your-gcp-project>, location 'global' (confirmed: no `vertexLocation`
 * override in infra/Pulumi.prod.yaml, so the worker's `VERTEX_LOCATION` default 'global' applies —
 * apps/engine-worker/src/config.ts:11, infra/index.ts:251,289).
 *
 * ── RUN ────────────────────────────────────────────────────────────────────
 *   # Personal account (this repo's prod is on the 'wisely' gcloud config):
 *   VERTEX_TOKEN="$(CLOUDSDK_ACTIVE_CONFIG_NAME=wisely gcloud auth print-access-token)" \
 *     node scripts/vertex-toolcall-smoke.mjs
 *
 *   # Or let the script shell out to gcloud itself (uses the active gcloud config):
 *   node scripts/vertex-toolcall-smoke.mjs
 *
 *   # With explicit gcloud config without exporting a token:
 *   CLOUDSDK_ACTIVE_CONFIG_NAME=wisely node scripts/vertex-toolcall-smoke.mjs
 *
 *   # Dry validation (no real call): prints the URL + bodies it WOULD send, never fetches.
 *   VERTEX_DRY_RUN=1 node scripts/vertex-toolcall-smoke.mjs
 *   node --check scripts/vertex-toolcall-smoke.mjs   # syntax only
 *
 * ── ENV ────────────────────────────────────────────────────────────────────
 *   VERTEX_PROJECT   default <your-gcp-project>
 *   VERTEX_LOCATION  default global
 *   VERTEX_MODEL     default gemini-3.1-flash-lite-preview
 *   VERTEX_TOKEN     ADC access token; if unset, runs `gcloud auth print-access-token`
 *                    (honouring CLOUDSDK_ACTIVE_CONFIG_NAME for account selection)
 *   VERTEX_DRY_RUN   if set (any value), print constructed URL + bodies and exit without calling
 *
 * Exit 0 on PASS, 1 on FAIL.
 */

import { execFileSync } from 'node:child_process';

const PROJECT = process.env.VERTEX_PROJECT || '<your-gcp-project>';
const LOCATION = process.env.VERTEX_LOCATION || 'global';
const MODEL = process.env.VERTEX_MODEL || 'gemini-3.1-flash-lite-preview';
const DRY_RUN = !!process.env.VERTEX_DRY_RUN;

// ── mirrors packages/engine/src/providers/vertex-base.ts:3-6 ────────────────
function vertexBaseUrl(project, location) {
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${project}/locations/${location}/publishers/google`;
}

// ── mirrors packages/engine/src/providers/gemini-sse.ts:7-43 ────────────────
function toGeminiContents(messages) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (m.role === 'tool') {
        if (!m.name) throw new Error('tool message missing name (required for Gemini functionResponse)');
        return { role: 'user', parts: [{ functionResponse: { name: m.name, response: { result: m.content } } }] };
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        const parts = [];
        if (m.content) parts.push({ text: m.content });
        for (const c of m.toolCalls) {
          const part = { functionCall: { name: c.name, args: c.arguments } };
          if (c.thoughtSignature) part.thoughtSignature = c.thoughtSignature;
          parts.push(part);
        }
        return { role: 'model', parts };
      }
      return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
    });
  return sys ? { contents, systemInstruction: { parts: [{ text: sys }] } } : { contents };
}

function geminiBody(req) {
  return JSON.stringify({
    ...toGeminiContents(req.messages),
    ...(req.tools?.length
      ? { tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }] }
      : {}),
    ...(req.maxOutputTokens ? { generationConfig: { maxOutputTokens: req.maxOutputTokens } } : {}),
  });
}

// ── mirrors packages/engine/src/providers/gemini-sse.ts:54-99 ───────────────
// Parses the full SSE stream into { text, toolCalls, finishReason }.
async function streamGemini(res) {
  let finishReason = 'STOP';
  let callSeq = 0;
  let text = '';
  const toolCalls = [];
  function handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let parsed;
    try { parsed = JSON.parse(data); } catch { return; }
    const cand = parsed.candidates?.[0];
    const parts = cand?.content?.parts ?? [];
    text += parts.map((x) => x?.text ?? '').join('');
    for (const part of parts) {
      if (part?.functionCall) {
        toolCalls.push({
          id: `call_${callSeq++}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args ?? {},
          ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
        });
      }
    }
    if (cand?.finishReason) finishReason = cand.finishReason;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    }
    if (buf.length > 0) handleLine(buf);
  } finally {
    await reader.cancel().catch(() => {});
  }
  return { text, toolCalls, finishReason };
}

function getToken() {
  if (process.env.VERTEX_TOKEN) return process.env.VERTEX_TOKEN.trim();
  // Honours CLOUDSDK_ACTIVE_CONFIG_NAME for account selection (inherited env).
  const out = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' });
  return out.trim();
}

function fail(reason, body) {
  console.error(`FAIL — ${reason}`);
  if (body !== undefined) console.error('--- raw response body ---\n' + body);
  process.exit(1);
}

const TOOL = {
  name: 'add',
  description: 'Add two integers',
  parameters: {
    type: 'object',
    properties: { a: { type: 'integer' }, b: { type: 'integer' } },
    required: ['a', 'b'],
  },
};

async function callVertex(base, token, messages) {
  const url = `${base}/models/${MODEL}:streamGenerateContent?alt=sse`;
  const body = geminiBody({ messages, tools: [TOOL], maxOutputTokens: 1024 });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body,
  });
  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => '<no body>');
    fail(`HTTP ${res.status} from Vertex on ${url}`, raw);
  }
  const parsed = await streamGemini(res);
  return parsed;
}

async function main() {
  const base = vertexBaseUrl(PROJECT, LOCATION);
  const url = `${base}/models/${MODEL}:streamGenerateContent?alt=sse`;

  const turn1Messages = [{ role: 'user', content: 'What is 2 + 3? Use the add tool.' }];
  const turn1Body = geminiBody({ messages: turn1Messages, tools: [TOOL], maxOutputTokens: 1024 });

  if (DRY_RUN) {
    console.log('DRY RUN — no request will be sent.');
    console.log('project :', PROJECT);
    console.log('location:', LOCATION);
    console.log('model   :', MODEL);
    console.log('URL     :', url);
    console.log('headers : content-type: application/json, authorization: Bearer <token>');
    console.log('--- Turn 1 body ---');
    console.log(JSON.stringify(JSON.parse(turn1Body), null, 2));
    // Show Turn 2 shape using a representative assistant call + tool response.
    const turn2Preview = geminiBody({
      messages: [
        ...turn1Messages,
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_0', name: 'add', arguments: { a: 2, b: 3 } }] },
        { role: 'tool', name: 'add', content: '5' },
      ],
      tools: [TOOL],
      maxOutputTokens: 1024,
    });
    console.log('--- Turn 2 body (representative) ---');
    console.log(JSON.stringify(JSON.parse(turn2Preview), null, 2));
    process.exit(0);
  }

  let token;
  try {
    token = getToken();
  } catch (e) {
    fail(`could not obtain access token (set VERTEX_TOKEN or fix gcloud): ${e.message}`);
  }
  if (!token) fail('empty access token');

  // ── Turn 1: expect functionCall(add) with numeric args ────────────────────
  const t1 = await callVertex(base, token, turn1Messages);
  const call = t1.toolCalls.find((c) => c.name === 'add');
  if (!call) {
    fail(`Turn 1 returned no functionCall(add) (finishReason=${t1.finishReason})`, JSON.stringify(t1, null, 2));
  }
  const a = call.arguments?.a;
  const b = call.arguments?.b;
  if (typeof a !== 'number' || typeof b !== 'number') {
    fail(`Turn 1 functionCall(add) args not numeric: ${JSON.stringify(call.arguments)}`, JSON.stringify(t1, null, 2));
  }
  const computed = a + b; // 5 for the 2+3 prompt

  // ── Turn 2: append assistant functionCall + tool functionResponse ─────────
  // Gemini 3.x returns a thoughtSignature on the functionCall part; Vertex requires it
  // to be echoed when replaying the call, else Turn 2 400s with "missing a thought_signature".
  const turn2Messages = [
    ...turn1Messages,
    { role: 'assistant', content: t1.text || '', toolCalls: [{ id: call.id, name: 'add', arguments: call.arguments, ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}) }] },
    { role: 'tool', name: 'add', content: String(computed) },
  ];
  const t2 = await callVertex(base, token, turn2Messages);
  const answer = (t2.text || '').trim();
  if (!answer.includes('5')) {
    fail(`Turn 2 final answer did not contain "5": ${JSON.stringify(answer)}`, JSON.stringify(t2, null, 2));
  }

  console.log(`PASS — Gemini emitted functionCall(add) and consumed functionResponse; final answer: "${answer}"`);
  process.exit(0);
}

main().catch((e) => fail(`unexpected error: ${e?.stack || e?.message || String(e)}`));
