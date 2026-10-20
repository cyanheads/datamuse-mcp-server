/**
 * @fileoverview Datamuse service behavior at the fetch boundary, including pacing and retries.
 * @module tests/services/datamuse-service.test
 */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatamuseService } from '@/services/datamuse/datamuse-service.js';
import type { DatamuseQuery } from '@/services/datamuse/types.js';

const query: DatamuseQuery = {
  vocabulary: 'en',
  limit: 20,
  include_definitions: false,
  means_like: 'ocean',
};
const tool = 'datamuse_find_words';
let service: DatamuseService;

/** Let fetch, stream reads, and retry bookkeeping settle without moving the clock. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** A real response whose socket body stays open until the fetch signal aborts. */
function stalledResponse(signal: AbortSignal): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      },
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
  service = new DatamuseService();
});

afterEach(() => {
  service.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Datamuse service response validation', () => {
  it('fetches the bounded offset prefix without dropping metadata before tool selection', async () => {
    const words = [{ word: 'flower', tags: ['pron: F L AW1 ER0 ', 'ipa_pron:fɫˈaʊɝ'] }];
    const fetch = vi.fn().mockResolvedValue(Response.json(words));
    vi.stubGlobal('fetch', fetch);
    await expect(
      service.search(
        { ...query, offset: 990, limit: Number.MAX_SAFE_INTEGER, include_ipa: true },
        createMockContext(),
        tool,
      ),
    ).resolves.toEqual({ words });
    expect(
      Object.fromEntries(new URL(String(fetch.mock.calls[0]?.[0])).searchParams),
    ).toMatchObject({ max: '1000', md: 'psfr', ipa: '1' });
  });
  it('preserves order, sparse rows, empty metadata, and arbitrary nested JSON', async () => {
    const words = [
      {
        word: 'sea',
        score: 0,
        numSyllables: 0,
        tags: ['n', 'f:87.0', 'prop', 'future:tag'],
        defs: ['n\tsea\r\n  '],
        defHeadword: 'sea',
        future: { children: [{ value: ['x', null, false, 1] }] },
      },
      { word: 'café' },
      { word: '```\n<script>x</script>', tags: [], defs: [] },
    ];
    const fetch = vi.fn().mockResolvedValue(Response.json(words));
    vi.stubGlobal('fetch', fetch);
    await expect(service.search(query, createMockContext(), tool)).resolves.toEqual({ words });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(new URL(String(url)).origin).toBe('https://api.datamuse.com');
    expect(init).toMatchObject({ redirect: 'manual', signal: expect.any(AbortSignal) });
  });

  it('accepts an empty array as success without retry', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal('fetch', fetch);
    await expect(service.search(query, createMockContext(), tool)).resolves.toEqual({ words: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['truncated JSON', '[{"word":'],
    ['non-array root', '{"word":"sea"}'],
    ['missing word', '[{"score":4}]'],
    ['wrong word', '[{"word":4}]'],
    ['wrong score', '[{"word":"sea","score":"4"}]'],
    ['negative syllables', '[{"word":"sea","numSyllables":-1}]'],
    ['fractional syllables', '[{"word":"sea","numSyllables":1.5}]'],
    ['null tags', '[{"word":"sea","tags":null}]'],
    ['nested malformed tag', '[{"word":"sea","tags":["n",4]}]'],
    ['wrong definitions', '[{"word":"sea","defs":[false]}]'],
    ['wrong headword', '[{"word":"sea","defHeadword":3}]'],
    ['mixed valid and malformed rows', '[{"word":"valid"},{"word":"invalid","score":null}]'],
  ])('rejects %s atomically and does not retry', async (_label, body) => {
    const fetch = vi.fn().mockResolvedValue(new Response(body));
    vi.stubGlobal('fetch', fetch);
    await expect(service.search(query, createMockContext(), tool)).rejects.toMatchObject({
      code: JsonRpcErrorCode.SerializationError,
      data: { reason: 'invalid_upstream_response', retryable: false },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps nested schema issue paths without leaking raw response values', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json([{ word: 'secret', tags: ['n', { password: 'never-return' }] }]),
        ),
    );
    const error = await service
      .search(query, createMockContext(), tool)
      .catch((error: unknown) => error);
    expect(error).toMatchObject({
      data: { issues: [{ path: ['0', 'tags', '1'], code: 'invalid_type' }] },
    });
    expect(JSON.stringify(error)).not.toContain('never-return');
    expect(JSON.stringify(error)).not.toContain('secret');
  });
});

describe('HTTP classifications and sanitized failures', () => {
  it.each([
    [400, JsonRpcErrorCode.InvalidParams, 'upstream_rejected'],
    [401, JsonRpcErrorCode.Unauthorized, 'upstream_unauthorized'],
    [403, JsonRpcErrorCode.Forbidden, 'upstream_forbidden'],
    [404, JsonRpcErrorCode.NotFound, 'upstream_not_found'],
    [409, JsonRpcErrorCode.Conflict, 'upstream_conflict'],
    [422, JsonRpcErrorCode.ValidationError, 'upstream_validation'],
    [302, JsonRpcErrorCode.InvalidRequest, 'upstream_unexpected_status'],
    [418, JsonRpcErrorCode.InvalidRequest, 'upstream_unexpected_status'],
  ])(
    'classifies HTTP %i without retrying or exposing upstream text',
    async (status, code, reason) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response('<html>secret upstream body</html>', {
          status,
          headers: {
            location: 'https://attacker.example/private',
            'x-request-id': 'private-header',
          },
        }),
      );
      vi.stubGlobal('fetch', fetch);
      const error = await service
        .search(query, createMockContext(), tool)
        .catch((error: unknown) => error);
      expect(error).toMatchObject({ code, data: { status, reason, retryable: false } });
      expect(JSON.stringify(error)).not.toMatch(
        /secret|attacker|private-header|api\.datamuse|ocean|stack/,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([500, 502, 503, 504])('retries transient HTTP %i at most once', async (status) => {
    const fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response('private response', { status })));
    vi.stubGlobal('fetch', fetch);
    const pending = service
      .search(query, createMockContext(), tool)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5000);
    const error = await pending;
    expect(error).toMatchObject({
      code: status === 504 ? JsonRpcErrorCode.Timeout : JsonRpcErrorCode.ServiceUnavailable,
      data: {
        status,
        retryAttempts: 2,
        recovery: { hint: expect.stringContaining('Retry datamuse_find_words later') },
      },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(error)).not.toContain('private response');
  });

  it('retries a network disconnect with a fresh fetch and keeps no cause or URL', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('socket https://private.example?token=secret'));
    vi.stubGlobal('fetch', fetch);
    const pending = service
      .search(query, createMockContext(), tool)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      data: { retryAttempts: 2 },
    });
    expect(JSON.stringify(await pending)).not.toMatch(/socket|token|private/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries a 2xx HTML interstitial once instead of treating it as lexical data', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response('  <!DOCTYPE html><html>challenge</html>')),
      );
    vi.stubGlobal('fetch', fetch);
    const pending = service
      .search(query, createMockContext(), tool)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      data: { retryAttempts: 2 },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('pacing, Retry-After, deadlines, and cancellation', () => {
  it.each(['3', 'Mon, 19 Oct 2026 12:00:03 GMT'])(
    'honors Retry-After %s once across cooldown and retry',
    async (retryAfter) => {
      const starts: number[] = [];
      const fetch = vi.fn().mockImplementation(() => {
        starts.push(Date.now());
        return Promise.resolve(
          starts.length === 1
            ? new Response('', { status: 429, headers: { 'retry-after': retryAfter } })
            : Response.json([{ word: 'sea' }]),
        );
      });
      vi.stubGlobal('fetch', fetch);
      const pending = service.search(query, createMockContext(), tool);
      await vi.advanceTimersByTimeAsync(2999);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ words: [{ word: 'sea' }] });
      expect(starts[1]! - starts[0]!).toBe(3000);
    },
  );

  it('surfaces a Retry-After above the retry budget without another attempt', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '60' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(service.search(query, createMockContext(), tool)).rejects.toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: { reason: 'upstream_rate_limited', status: 429, retryAfter: '60', retryable: true },
    });
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('shares a FIFO start gap across different tools and tenants', async () => {
    const starts: number[] = [];
    const fetch = vi.fn().mockImplementation(() => {
      starts.push(Date.now());
      return Promise.resolve(Response.json([]));
    });
    vi.stubGlobal('fetch', fetch);
    const first = service.search(
      query,
      createMockContext({ tenantId: 'one' }),
      'datamuse_find_rhymes',
    );
    const second = service.search(
      query,
      createMockContext({ tenantId: 'two' }),
      'datamuse_find_synonyms',
    );
    const third = service.search(query, createMockContext(), tool);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1001);
    await Promise.all([first, second, third]);
    expect(starts.map((time) => time - starts[0]!)).toEqual([0, 1000, 2000]);
  });

  it('holds its concurrency slot through body parsing and sheds elapsed queue waits without retry', async () => {
    const fetch = vi
      .fn()
      .mockImplementation((_url: unknown, init: RequestInit) =>
        Promise.resolve(stalledResponse(init.signal!)),
      );
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const first = service
      .search(query, createMockContext({ signal: controller.signal }), tool)
      .catch((error: unknown) => error);
    await flush();
    const queued = service
      .search(query, createMockContext(), 'datamuse_find_synonyms')
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await queued).toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: { reason: 'pacer_shed', retryAfter: expect.any(Number) },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    controller.abort();
    await first;
  });

  it('sheds work whose projected queue wait exceeds 5 seconds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(Response.json([]))),
    );
    const pending = Array.from({ length: 7 }, () =>
      service.search(query, createMockContext(), tool).catch((error: unknown) => error),
    );
    await flush();
    expect(await pending[6]).toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: { reason: 'pacer_shed', retryAfter: expect.any(Number) },
    });
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(pending);
  });

  it('cancels a queued caller without dispatching its request', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json([])));
    vi.stubGlobal('fetch', fetch);
    await service.search(query, createMockContext(), tool);
    const controller = new AbortController();
    const pending = service
      .search(query, createMockContext({ signal: controller.signal }), tool)
      .catch((error: unknown) => error);
    controller.abort();
    await pending;
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('bounds a body stalled after headers by the 8-second attempt timeout and two attempts', async () => {
    const signals: AbortSignal[] = [];
    const fetch = vi.fn().mockImplementation((_url: unknown, init: RequestInit) => {
      signals.push(init.signal!);
      return Promise.resolve(stalledResponse(init.signal!));
    });
    vi.stubGlobal('fetch', fetch);
    const pending = service
      .search(query, createMockContext(), tool)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(19000);
    expect(await pending).toMatchObject({
      code: JsonRpcErrorCode.Timeout,
      data: { retryAttempts: 2 },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('stops in-flight work immediately on caller cancellation without retry', async () => {
    const fetch = vi
      .fn()
      .mockImplementation((_url: unknown, init: RequestInit) =>
        Promise.resolve(stalledResponse(init.signal!)),
      );
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const pending = service
      .search(query, createMockContext({ signal: controller.signal }), tool)
      .catch((error: unknown) => error);
    await flush();
    controller.abort();
    expect(await pending).toMatchObject({ code: JsonRpcErrorCode.RequestCancelled });
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('charges queue time and both body attempts to the 20-second total deadline', async () => {
    const fetch = vi
      .fn()
      .mockImplementation((_url: unknown, init: RequestInit) =>
        Promise.resolve(stalledResponse(init.signal!)),
      );
    vi.stubGlobal('fetch', fetch);
    const blocker = new AbortController();
    const first = service
      .search(query, createMockContext({ signal: blocker.signal }), tool)
      .catch((error: unknown) => error);
    await flush();
    const pending = service
      .search(query, createMockContext(), tool)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(4000);
    blocker.abort();
    await first;
    await vi.advanceTimersByTimeAsync(16000);
    expect(await pending).toMatchObject({
      code: JsonRpcErrorCode.Timeout,
      data: { reason: 'retry_deadline_exceeded', retryAttempts: 2 },
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('reports an exhausted 429 with its status, retryAfter, and attempt count', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response('', { status: 429, headers: { 'retry-after': '1' } })),
      );
    vi.stubGlobal('fetch', fetch);
    const pending = service
      .search(query, createMockContext(), tool)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: { reason: 'upstream_rate_limited', retryAfter: '1', retryAttempts: 2, retryable: true },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('disposes queued work and prevents later dispatch', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json([])));
    vi.stubGlobal('fetch', fetch);
    await service.search(query, createMockContext(), tool);
    const pending = service
      .search(query, createMockContext(), tool)
      .catch((error: unknown) => error);
    service.dispose();
    expect(await pending).toMatchObject({ code: JsonRpcErrorCode.RequestCancelled });
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
