/**
 * @fileoverview Lookup tool validation and complete MCP output parity.
 * @module tests/tools/get-word-info.tool.test
 */
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getWordInfoTool } from '@/mcp-server/tools/definitions/get-word-info.tool.js';
import {
  disposeDatamuseService,
  initDatamuseService,
} from '@/services/datamuse/datamuse-service.js';

beforeEach(() => {
  vi.useFakeTimers();
  initDatamuseService();
});
afterEach(() => {
  disposeDatamuseService();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function assertOutputParity(result: Awaited<ReturnType<typeof runToolContract>>): void {
  const text = result.content.find((block) => block.type === 'text')?.text;
  const json = text?.match(/\n```json\n([^\n]+)\n```$/)?.[1];
  if (json === undefined) throw new Error('Expected a fenced JSON result.');
  expect(JSON.parse(json)).toEqual(result.structuredContent);
}

it.each([{}, { vocabulary: 'en' as const }])(
  'preserves a complete English echo and caller spelling on both surfaces with %j',
  async (options) => {
    const row = {
      word: 'ice cream',
      tags: ['query', 'pron: AY1 S '],
      future: { nested: [null, '```<x>'] },
    };
    const fetch = vi.fn(async (_url: URL) => Response.json([row]));
    vi.stubGlobal('fetch', fetch);
    const result = await runToolContract(getWordInfoTool, {
      words: [' Ice Cream '],
      include_ipa: true,
      ...options,
    });
    expect(result.isError).not.toBe(true);
    expect(fetch.mock.calls.map(([url]) => url.searchParams.has('v'))).toEqual([false]);
    expect(result.structuredContent).toEqual({
      vocabulary: 'en',
      outcomes: [{ index: 0, input: 'Ice Cream', status: 'success', row }],
    });
    assertOutputParity(result);
  },
);

it('routes the complete Spanish batch and preserves echoes and failures on both surfaces', async () => {
  const row = {
    word: 'corazón',
    numSyllables: 3,
    tags: ['query', 'f:191.289594'],
    future: { nested: [{ pronunciation: ['raw'] }] },
  };
  const fetch = vi.fn(async (url: URL) =>
    Response.json(url.searchParams.get('sp') === 'Corazón' ? [row] : [{ word: 'hola' }]),
  );
  vi.stubGlobal('fetch', fetch);
  const pending = runToolContract(getWordInfoTool, {
    words: [' Corazón ', 'hola'],
    vocabulary: 'es',
  });
  await vi.advanceTimersByTimeAsync(1000);
  const result = await pending;
  expect(result.isError).not.toBe(true);
  expect(fetch.mock.calls.map(([url]) => url.searchParams.get('v'))).toEqual(['es', 'es']);
  const expected = {
    vocabulary: 'es',
    outcomes: [
      { index: 0, input: 'Corazón', status: 'success', row },
      {
        index: 1,
        input: 'hola',
        status: 'failure',
        reason: 'missing_query_echo',
        recovery: 'Check the supplied spelling and retry this word later.',
      },
    ],
  };
  expect(result.structuredContent).toEqual(expected);
  assertOutputParity(result);
});

it.each([[], [{ word: 'correction', tags: ['query'] }], [{ word: 4 }]].map((raw) => ({ raw })))(
  'renders failed item reasons and recovery completely for $raw',
  async ({ raw }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(raw)),
    );
    const result = await runToolContract(getWordInfoTool, {
      words: ['supplied'],
      vocabulary: 'es',
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      vocabulary: 'es',
      outcomes: [
        {
          index: 0,
          input: 'supplied',
          status: 'failure',
          reason:
            typeof raw[0]?.word === 'number' ? 'invalid_upstream_response' : 'missing_query_echo',
          recovery: expect.any(String),
        },
      ],
    });
    assertOutputParity(result);
  },
);
it('rejects an unsupported vocabulary before network I/O', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const result = await runToolContract(getWordInfoTool, {
    words: ['test'],
    vocabulary: 'enwiki' as 'en',
  });
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    error: { data: { reason: 'invalid_arguments' } },
  });
  expect(result.content).toEqual([
    expect.objectContaining({ type: 'text', text: expect.stringContaining('invalid_arguments') }),
  ]);
  expect(fetch).not.toHaveBeenCalled();
});
it.each(
  [[], Array.from({ length: 101 }, () => 'x'), [' '], ['x'.repeat(201)]].map((words) => ({
    words,
  })),
)('rejects invalid inputs before network $words', async ({ words }) => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const result = await runToolContract(getWordInfoTool, { words });
  expect(result.isError).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
