import { env } from '../../lib/env.js';
import { logger } from '../../lib/logger.js';

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_TOKENS = 200;

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
}

/**
 * Minimal Gemini 1.5 Flash REST client (architecture doc §10).
 *
 * Deliberately not the `@google/generative-ai` SDK — one `fetch` call,
 * no new dependency, and every failure path collapses to `null` so the
 * caller can fall back silently. AI is never load-bearing here: a
 * missing key, a network error, a rate-limit, a timeout, or a
 * malformed response all mean "no risk data", never a thrown error.
 */
export async function generateRiskNote(
  prompt: string,
): Promise<string | null> {
  if (!env.GEMINI_API_KEY) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      `${GEMINI_ENDPOINT}/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          },
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      logger.warn(
        { status: response.status },
        'no-show scoring: Gemini request failed',
      );
      return null;
    }

    const body = (await response.json()) as GeminiResponse;
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    return text && text.length > 0 ? text : null;
  } catch (error) {
    logger.warn(
      { err: error },
      'no-show scoring: Gemini call errored',
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
