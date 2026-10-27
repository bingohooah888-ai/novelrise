// Server-only provider adapters. Never include API keys in client HTML,
// NEXT_PUBLIC_* variables, logs, or API responses.
export class AiProviderError extends Error {
  constructor(code, retryable = false) {
    super(code);
    this.name = 'AiProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}

async function postJson(url, apiKey, headers, body, fetchImpl, timeoutMs) {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new AiProviderError('AI_PROVIDER_NOT_CONFIGURED');
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body),
      signal: globalThis.AbortSignal.timeout(timeoutMs)
    });
  } catch {
    // Timeout can have billed already: router reserves the full attempt.
    throw new AiProviderError('AI_NETWORK_UNAVAILABLE', true);
  }
  if (!response.ok) {
    const retryable =
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500;
    throw new AiProviderError(
      retryable ? 'AI_PROVIDER_TEMPORARY_FAILURE' : 'AI_PROVIDER_REJECTED',
      retryable
    );
  }
  try {
    return await response.json();
  } catch {
    throw new AiProviderError('AI_PROVIDER_INVALID_RESPONSE');
  }
}

export function createOpenAiTextProvider({
  apiKey,
  fetchImpl = globalThis.fetch
}) {
  return {
    async generate({ model, system, user, maxOutputTokens, timeoutMs }) {
      const data = await postJson(
        'https://api.openai.com/v1/responses',
        apiKey,
        { Authorization: `Bearer ${apiKey}` },
        {
          model,
          instructions: system,
          input: user,
          max_output_tokens: maxOutputTokens,
          store: false,
          truncation: 'disabled'
        },
        fetchImpl,
        timeoutMs
      );
      const parts = (data.output || []).flatMap((item) =>
        (item.content || [])
          .filter((part) => part.type === 'output_text')
          .map((part) => part.text || '')
      );
      const result = parts.join('\n') || data.output_text || '';
      if (!result) throw new AiProviderError('AI_EMPTY_RESPONSE');
      return {
        text: result,
        usage: {
          inputTokens: data.usage?.input_tokens,
          outputTokens: data.usage?.output_tokens
        }
      };
    }
  };
}

export function createGeminiTextProvider({
  apiKey,
  fetchImpl = globalThis.fetch
}) {
  return {
    async generate({ model, system, user, maxOutputTokens, timeoutMs }) {
      if (!/^[a-z0-9._-]+$/i.test(model)) {
        throw new AiProviderError('AI_INVALID_MODEL');
      }
      const data = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        apiKey,
        { 'x-goog-api-key': apiKey },
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens }
        },
        fetchImpl,
        timeoutMs
      );
      const candidate = data.candidates?.[0];
      if (!candidate || candidate.finishReason === 'SAFETY') {
        throw new AiProviderError('AI_CONTENT_BLOCKED');
      }
      const result = (candidate.content?.parts || [])
        .map((part) => part.text || '')
        .join('');
      if (!result) throw new AiProviderError('AI_EMPTY_RESPONSE');
      return {
        text: result,
        usage: {
          inputTokens: data.usageMetadata?.promptTokenCount,
          outputTokens:
            (data.usageMetadata?.candidatesTokenCount || 0) +
            (data.usageMetadata?.thoughtsTokenCount || 0)
        }
      };
    }
  };
}
