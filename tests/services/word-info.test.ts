/**
 * @fileoverview Query-echo lookup behavior through the real paced HTTP service.
 * @module tests/services/word-info.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatamuseService } from '@/services/datamuse/datamuse-service.js';

let service: DatamuseService;
beforeEach(() => {
  vi.useFakeTimers();
  service = new DatamuseService();
});
afterEach(() => {
  service.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const options = { include_definitions: false, include_pronunciation: false, include_ipa: false };

it('characterizes sparse raw search metadata before extending the service', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json([{ word: 'ice cream', tags: ['query'], future: { nested: [null] } }]),
    ),
  );
  await expect(
    service.search(
      { ...options, vocabulary: 'en', limit: 1, spelled_like: 'Ice Cream' },
      createMockContext(),
      'datamuse_find_words',
    ),
  ).resolves.toEqual({
    words: [{ word: 'ice cream', tags: ['query'], future: { nested: [null] } }],
  });
});

it('keeps caller identity, duplicates, raw rows and metadata options through paced query echo', async () => {
  const starts: number[] = [];
  const fetch = vi.fn(async (url: URL) => {
    starts.push(Date.now());
    expect(url.searchParams.get('qe')).toBe('sp');
    expect(url.searchParams.get('max')).toBe('1');
    expect(url.searchParams.get('md')).toBe('psfdr');
    expect(url.searchParams.get('ipa')).toBe('1');
    return Response.json([
      { word: 'ice cream', tags: ['query', 'future:x'], future: { nested: [null] } },
    ]);
  });
  vi.stubGlobal('fetch', fetch);
  const pending = service.lookup(
    [' Ice Cream ', 'Ice Cream'],
    { ...options, include_definitions: true, include_ipa: true },
    createMockContext(),
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(await pending).toEqual({
    outcomes: [0, 1].map((index) => ({
      index,
      input: 'Ice Cream',
      status: 'success',
      row: { word: 'ice cream', tags: ['query', 'future:x'], future: { nested: [null] } },
    })),
  });
  expect(starts[1]! - starts[0]!).toBe(1000);
});

it.each(
  [
    [],
    [{ word: 'wrong', tags: ['query'] }],
    [{ word: 'test' }],
    [{ word: 'tést', tags: ['query'] }],
    [{ word: 'test', tags: [3] }],
  ].map((raw) => ({ raw })),
)('rejects missing, mismatched, untagged or malformed echo $raw and continues', async ({ raw }) => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json(raw))
      .mockResolvedValueOnce(Response.json([{ word: 'second', tags: ['query'] }])),
  );
  const pending = service.lookup(['test', 'second'], options, createMockContext());
  await vi.advanceTimersByTimeAsync(1000);
  expect(await pending).toMatchObject({
    outcomes: [
      {
        index: 0,
        status: 'failure',
        reason:
          raw.length && raw[0] && 'tags' in raw[0] && typeof raw[0].tags?.[0] === 'number'
            ? 'invalid_upstream_response'
            : 'missing_query_echo',
      },
      { index: 1, status: 'success', row: { word: 'second' } },
    ],
  });
});

it.each([10, 11, 100])('processes only ten of %i inputs including duplicates', async (count) => {
  const fetch = vi.fn(async () => Response.json([{ word: 'x', tags: ['query'] }]));
  vi.stubGlobal('fetch', fetch);
  const pending = service.lookup(
    Array.from({ length: count }, () => 'x'),
    options,
    createMockContext(),
  );
  await vi.advanceTimersByTimeAsync(10000);
  const { outcomes } = await pending;
  expect(fetch).toHaveBeenCalledTimes(10);
  expect(outcomes).toHaveLength(count);
  expect(outcomes.slice(10)).toEqual(
    Array.from({ length: count - 10 }, (_, i) => ({
      index: i + 10,
      input: 'x',
      status: 'unprocessed',
      reason: 'processing_cap',
      recovery: 'Submit this word in a new lookup call.',
    })),
  );
});

it('preserves completed successes while the one deadline interrupts later body reads', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json([{ word: 'first', tags: ['query'] }]))
    .mockImplementation((_url: URL, init: RequestInit) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason), {
                once: true,
              });
            },
          }),
        ),
      ),
    );
  vi.stubGlobal('fetch', fetch);
  const pending = service.lookup(
    ['first', 'second', 'third', 'fourth'],
    options,
    createMockContext(),
  );
  await vi.advanceTimersByTimeAsync(20000);
  expect(await pending).toMatchObject({
    outcomes: [
      { status: 'success' },
      { status: 'failure' },
      { status: 'unprocessed', reason: 'deadline_exceeded' },
      { status: 'unprocessed', reason: 'deadline_exceeded' },
    ],
  });
  const calls = fetch.mock.calls.length;
  await vi.advanceTimersByTimeAsync(30000);
  expect(fetch).toHaveBeenCalledTimes(calls);
});

it('propagates caller cancellation and dispatches no later input', async () => {
  const controller = new AbortController();
  const fetch = vi.fn(async () => {
    controller.abort();
    return Response.json([{ word: 'first', tags: ['query'] }]);
  });
  vi.stubGlobal('fetch', fetch);
  await expect(
    service.lookup(['first', 'second'], options, createMockContext({ signal: controller.signal })),
  ).rejects.toMatchObject({ code: JsonRpcErrorCode.RequestCancelled });
  await vi.advanceTimersByTimeAsync(30000);
  expect(fetch).toHaveBeenCalledTimes(1);
});
