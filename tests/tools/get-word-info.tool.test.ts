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

beforeEach(() => initDatamuseService());
afterEach(() => {
  disposeDatamuseService();
  vi.unstubAllGlobals();
});
it('preserves a complete raw echo and caller spelling on both surfaces', async () => {
  const row = {
    word: 'ice cream',
    tags: ['query', 'pron: AY1 S '],
    future: { nested: [null, '```<x>'] },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json([row])),
  );
  const result = await runToolContract(getWordInfoTool, {
    words: [' Ice Cream '],
    include_ipa: true,
  });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual({
    outcomes: [{ index: 0, input: 'Ice Cream', status: 'success', row }],
  });
  const text = result.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  expect(JSON.parse(text.split('```json\n')[1]!.split('\n```')[0]!)).toEqual(
    result.structuredContent,
  );
});

it.each([[], [{ word: 'correction', tags: ['query'] }], [{ word: 4 }]].map((raw) => ({ raw })))(
  'renders failed item reasons and recovery completely for $raw',
  async ({ raw }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(raw)),
    );
    const result = await runToolContract(getWordInfoTool, { words: ['supplied'] });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
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
    const text = result.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    expect(JSON.parse(text.split('```json\n')[1]!.split('\n```')[0]!)).toEqual(
      result.structuredContent,
    );
  },
);
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
