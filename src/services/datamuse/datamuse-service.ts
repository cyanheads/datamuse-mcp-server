/**
 * @fileoverview Fixed-endpoint Datamuse queries with shared pacing and bounded retries.
 * @module services/datamuse/datamuse-service
 */
import type { Context } from '@cyanheads/mcp-ts-core';
import {
  JsonRpcErrorCode,
  McpError,
  serializationError,
  serviceUnavailable,
} from '@cyanheads/mcp-ts-core/errors';
import { createPacer, fetchWithTimeout, withRetry } from '@cyanheads/mcp-ts-core/utils';
import {
  type DatamuseQuery,
  metadataOptions,
  RELATION_CODES,
  type SearchToolName,
  type WordResult,
  wordResultSchema,
} from './types.js';

/** Indexed lookup outcome; upstream rows remain complete and separate from caller input. */
export type WordInfoOutcome =
  | { index: number; input: string; status: 'success'; row: WordResult }
  | { index: number; input: string; status: 'failure'; reason: string; recovery: string }
  | {
      index: number;
      input: string;
      status: 'unprocessed';
      reason: 'processing_cap' | 'deadline_exceeded';
      recovery: string;
    };

/** Serialize only supported parameters against the immutable HTTPS endpoint. */
export function buildSearchUrl(query: DatamuseQuery): URL {
  const url = new URL('https://api.datamuse.com/words');
  const pairs = [
    ['ml', query.means_like],
    ['sp', query.spelled_like],
    ['sl', query.sounds_like],
    ['lc', query.left_context],
    ['rc', query.right_context],
  ] as const;
  for (const [key, value] of pairs) if (value !== undefined) url.searchParams.append(key, value);
  for (const entry of query.relations ?? [])
    url.searchParams.append(`rel_${RELATION_CODES[entry.relation]}`, entry.word);
  if (query.topics?.length) url.searchParams.append('topics', query.topics.join(','));
  if (query.vocabulary === 'es') url.searchParams.append('v', 'es');
  url.searchParams.append(
    'max',
    String(Math.min(1000, (query.offset ?? 0) + Math.min(1000, query.limit))),
  );
  const metadata = metadataOptions(query);
  url.searchParams.append('md', metadata.metadata);
  if (metadata.include_ipa) url.searchParams.append('ipa', '1');
  return url;
}

const statusReasons: Readonly<Record<number, string>> = {
  400: 'upstream_rejected',
  401: 'upstream_unauthorized',
  403: 'upstream_forbidden',
  404: 'upstream_not_found',
  409: 'upstream_conflict',
  422: 'upstream_validation',
  429: 'upstream_rate_limited',
};

/** Discard upstream text, URLs, and causes while retaining framework classifications. */
function safeError(error: unknown, tool: SearchToolName, callerSignal: AbortSignal): unknown {
  if (!(error instanceof McpError)) {
    if (callerSignal.aborted) return error;
    return serviceUnavailable('Datamuse response could not be read.', {
      recovery: {
        hint: `Retry ${tool} later; call datamuse_list_reference with topic='limitations' for availability and quota guidance.`,
      },
    });
  }
  const data: Record<string, unknown> = {};
  for (const key of [
    'status',
    'reason',
    'retryAfter',
    'retryAttempts',
    'maxRetries',
    'requestId',
    'issues',
    'retryable',
    'errorSource',
  ]) {
    if (error.data?.[key] !== undefined) data[key] = error.data[key];
  }
  const status = data.status;
  if (typeof status === 'number') {
    if (statusReasons[status]) data.reason = statusReasons[status];
    else if (status >= 300 && status < 500 && status !== 408 && status !== 425)
      data.reason = 'upstream_unexpected_status';
    if (status === 429) data.retryable = true;
    else if (status < 500 && status !== 408 && status !== 425) data.retryable = false;
  }
  if (
    error.code === JsonRpcErrorCode.Timeout ||
    error.code === JsonRpcErrorCode.ServiceUnavailable
  ) {
    data.recovery = {
      hint: `Retry ${tool} later; call datamuse_list_reference with topic='limitations' for availability and quota guidance.`,
    };
  }
  const message =
    error.code === JsonRpcErrorCode.RequestCancelled
      ? 'Datamuse request was cancelled.'
      : 'Datamuse request could not be completed.';
  return new McpError(error.code, message, data);
}

/** One shared service; attempts hold their pacing slot through response validation. */
export class DatamuseService {
  private readonly pacer = createPacer({
    name: 'datamuse',
    minStartGapMs: 1000,
    maxConcurrent: 1,
    maxQueueDepth: 20,
    cooldown: { baseMs: 2000, maxMs: 60000 },
  });

  /** Search, preserving every valid upstream row and field. */
  async search(
    query: DatamuseQuery,
    ctx: Context,
    tool: SearchToolName,
    request?: { echo: true; deadlineMs: number },
  ): Promise<{ words: WordResult[] }> {
    const url = buildSearchUrl(query);
    if (request) url.searchParams.set('qe', 'sp');
    try {
      const words = await withRetry(
        async ({ signal, remainingMs }) =>
          this.pacer.run(
            async (attemptSignal) => {
              try {
                const response = await fetchWithTimeout(url, Math.min(8000, remainingMs), ctx, {
                  signal: attemptSignal,
                  redirect: 'manual',
                  errorBodyLimit: 0,
                });
                const text = await response.text();
                if (/^\s*<(?:!doctype\s+html|html[\s>])/i.test(text))
                  throw serviceUnavailable('Datamuse returned HTML instead of JSON.');
                let raw: unknown;
                try {
                  raw = JSON.parse(text);
                } catch {
                  throw serializationError('Datamuse returned invalid JSON.', {
                    reason: 'invalid_upstream_response',
                    retryable: false,
                  });
                }
                const parsed = wordResultSchema.array().safeParse(raw);
                if (!parsed.success)
                  throw serializationError('Datamuse returned malformed word data.', {
                    reason: 'invalid_upstream_response',
                    retryable: false,
                    issues: parsed.error.issues.map((issue) => ({
                      path: issue.path.map(String),
                      code: issue.code,
                    })),
                  });
                return parsed.data;
              } catch (error) {
                throw safeError(error, tool, ctx.signal);
              }
            },
            { signal, maxWaitMs: 5000 },
          ),
        {
          maxRetries: 1,
          baseDelayMs: 1000,
          maxDelayMs: 5000,
          deadlineMs: request?.deadlineMs ?? 20000,
          signal: ctx.signal,
          context: ctx,
          operation: 'datamuse.search',
        },
      );
      return { words };
    } catch (error) {
      throw safeError(error, tool, ctx.signal);
    }
  }

  /** Look up ten supplied spellings sequentially within one whole-call deadline. */
  async lookup(
    words: string[],
    options: Pick<DatamuseQuery, 'include_definitions' | 'include_pronunciation' | 'include_ipa'>,
    ctx: Context,
  ): Promise<{ outcomes: WordInfoOutcome[] }> {
    const deadline = Date.now() + 20000;
    const outcomes: WordInfoOutcome[] = [];
    for (const [index, value] of words.entries()) {
      if (ctx.signal.aborted)
        throw new McpError(JsonRpcErrorCode.RequestCancelled, 'Datamuse request was cancelled.');
      const input = value.trim();
      const remaining = deadline - Date.now();
      if (index >= 10 || remaining <= 0) {
        outcomes.push({
          index,
          input,
          status: 'unprocessed',
          reason: index >= 10 ? 'processing_cap' : 'deadline_exceeded',
          recovery: 'Submit this word in a new lookup call.',
        });
        continue;
      }
      try {
        const result = await this.search(
          { ...options, spelled_like: input, vocabulary: 'en', limit: 1 },
          ctx,
          'datamuse_get_word_info',
          { echo: true, deadlineMs: remaining },
        );
        const row = result.words.find(
          (row) => row.tags?.includes('query') && row.word.toLowerCase() === input.toLowerCase(),
        );
        if (!row)
          outcomes.push({
            index,
            input,
            status: 'failure',
            reason: 'missing_query_echo',
            recovery: 'Check the supplied spelling and retry this word later.',
          });
        else outcomes.push({ index, input, status: 'success', row });
      } catch (error) {
        if (
          ctx.signal.aborted ||
          (error instanceof McpError && error.code === JsonRpcErrorCode.RequestCancelled)
        )
          throw error;
        if (Date.now() >= deadline)
          outcomes.push({
            index,
            input,
            status: 'unprocessed',
            reason: 'deadline_exceeded',
            recovery: 'Submit this word in a new lookup call.',
          });
        else
          outcomes.push({
            index,
            input,
            status: 'failure',
            reason:
              error instanceof McpError && typeof error.data?.reason === 'string'
                ? error.data.reason
                : 'upstream_failure',
            recovery:
              'Retry this word later; consult datamuse_list_reference for availability guidance.',
          });
      }
    }
    return { outcomes };
  }

  /** Reject queued work and release pacing timers. */
  dispose(): void {
    this.pacer.dispose();
  }
}

let service: DatamuseService | undefined;
/** Initialize once during server setup. */
export function initDatamuseService(): void {
  service = new DatamuseService();
}
/** Access the initialized service from tool handlers. */
export function getDatamuseService(): DatamuseService {
  if (!service)
    throw new Error('DatamuseService not initialized; call initDatamuseService() in setup().');
  return service;
}
/** Dispose the process service during teardown. */
export function disposeDatamuseService(): void {
  service?.dispose();
  service = undefined;
}
