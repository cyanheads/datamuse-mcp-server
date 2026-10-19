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
  RELATION_CODES,
  type SearchToolName,
  type WordResult,
  wordResultSchema,
} from './types.js';

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
  url.searchParams.append('max', String(query.limit));
  url.searchParams.append('md', query.include_definitions ? 'psfd' : 'psf');
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
  ): Promise<{ words: WordResult[] }> {
    const url = buildSearchUrl(query);
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
          deadlineMs: 20000,
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
