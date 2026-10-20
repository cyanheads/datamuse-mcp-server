/**
 * @fileoverview Network tool contracts through real Datamuse service and fake HTTP.
 * @module tests/tools/search-tools.test
 */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findRhymesTool } from '@/mcp-server/tools/definitions/find-rhymes.tool.js';
import { findSynonymsTool } from '@/mcp-server/tools/definitions/find-synonyms.tool.js';
import { findWordsTool } from '@/mcp-server/tools/definitions/find-words.tool.js';
import {
  disposeDatamuseService,
  initDatamuseService,
} from '@/services/datamuse/datamuse-service.js';

const tools = [
  { tool: findRhymesTool, input: { word: ' tea ' } },
  { tool: findSynonymsTool, input: { word: ' tea ' } },
  { tool: findWordsTool, input: { means_like: ' tea ' } },
] as const;
type Result = Awaited<ReturnType<typeof runToolContract>>;
const dataOf = (result: Result) => result.structuredContent as Record<string, unknown>;
const textOf = (result: Result) =>
  result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
const fences = (result: Result): unknown[] =>
  [...textOf(result).matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]!));
function fakeJson(value: unknown) {
  const fetch = vi.fn(async (_input: Parameters<typeof globalThis.fetch>[0], _init?: RequestInit) =>
    Response.json(value),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
function assertFailure(result: Result, code: number, reason?: string, hint?: string) {
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    error: { code, ...(reason ? { data: { reason } } : {}) },
  });
  if (hint) {
    expect(result.structuredContent).toMatchObject({ error: { data: { recovery: { hint } } } });
    expect(textOf(result)).toContain(hint);
  }
}
beforeEach(() => initDatamuseService());
afterEach(() => {
  disposeDatamuseService();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

for (const { tool, input } of tools) {
  describe(tool.name, () => {
    it.each([
      { count: 0, limit: 20 },
      { count: 2, limit: 20 },
      { count: 1, limit: 1 },
      { count: 1000, limit: 1000 },
    ])(
      'validates complete enrichment for $count rows at limit $limit',
      async ({ count, limit }) => {
        const words = Array.from({ length: count }, (_, index) => ({ word: `word-${index}` }));
        const fetch = fakeJson(words);
        const result = await runToolContract(tool, { ...input, limit });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          words,
          returnedCount: count,
          limitReached: count === limit,
          effectiveQuery: { limit, include_definitions: false, vocabulary: 'en', metadata: 'psf' },
        });
        expect(fences(result)).toContainEqual({ words });
        expect(fences(result)).toContainEqual(dataOf(result).effectiveQuery);
        const notice = dataOf(result).notice;
        expect(textOf(result).replaceAll('**', '')).toContain(`returnedCount: ${count}`);
        expect(textOf(result).replaceAll('**', '')).toContain(`limitReached: ${count === limit}`);
        if (count === 0) expect(notice).toEqual(expect.stringContaining('No '));
        else if (count === 1000) {
          expect(notice).toEqual(expect.stringContaining('no continuation'));
          expect(notice).not.toEqual(expect.stringContaining('larger limit'));
        } else if (count === limit)
          expect(notice).toEqual(expect.stringContaining(`Re-run ${tool.name}`));
        else expect(notice).toBeUndefined();
        if (notice) expect(textOf(result)).toContain(notice);
        expect(fetch).toHaveBeenCalledTimes(1);
      },
    );

    it('preserves sparse rows and deep unknown data including adversarial Markdown on both surfaces', async () => {
      const words = [
        {
          word: '```\n</script>![x](https://example.test)\r\n',
          score: 1,
          tags: ['prop', 'f:0.01', 'unknown'],
          defs: ['n\tfirst\nsecond  '],
          defHeadword: 'head',
          future: { nested: [{ text: '<img src=x> ``` `', value: null, flags: [true, 2] }] },
        },
        { word: 'sparse' },
        { word: 'empty', tags: [], defs: [] },
      ];
      fakeJson(words);
      const result = await runToolContract(tool, { ...input, include_definitions: true });
      expect(result.isError).not.toBe(true);
      expect(dataOf(result).words).toEqual(words);
      expect(fences(result)).toContainEqual({ words });
      expect(dataOf(result).effectiveQuery).toMatchObject({ metadata: 'psfd' });
      expect(textOf(result)).not.toContain('<img');
      expect(textOf(result)).not.toContain('</script>');
    });

    it.each(
      Array.from({ length: 8 }, (_, flags) => ({
        include_definitions: Boolean(flags & 1),
        include_pronunciation: Boolean(flags & 2),
        include_ipa: Boolean(flags & 4),
      })),
    )('forwards all metadata options %j without changing raw tags', async (options) => {
      const words = [
        { word: 'flower', tags: ['pron: F L AW1 ER0  ', 'ipa_pron:fɫˈaʊɝ\t', 'future: unknown'] },
        { word: 'absent' },
      ];
      const fetch = fakeJson(words);
      const result = await runToolContract(tool, { ...input, ...options });
      expect(result.isError).not.toBe(true);
      const metadata = `psf${options.include_definitions ? 'd' : ''}${options.include_pronunciation || options.include_ipa ? 'r' : ''}`;
      const params = new URL(String(fetch.mock.calls[0]?.[0])).searchParams;
      expect(params.get('md')).toBe(metadata);
      expect(params.get('ipa')).toBe(options.include_ipa ? '1' : null);
      expect(dataOf(result)).toMatchObject({
        words,
        effectiveQuery: {
          ...options,
          include_pronunciation: options.include_pronunciation || options.include_ipa,
          metadata,
        },
      });
      expect(fences(result)).toContainEqual({ words });
      expect(fences(result)).toContainEqual(dataOf(result).effectiveQuery);
    });

    it('slices offset pages without inventing exhaustion and stops navigation at index 999', async () => {
      vi.useFakeTimers();
      const words = Array.from({ length: 1000 }, (_, index) => ({ word: String(index) }));
      fakeJson(words);
      const last = await runToolContract(tool, { ...input, limit: 1000, offset: 999 });
      expect(dataOf(last)).toMatchObject({
        words: [words[999]],
        returnedCount: 1,
        truncated: false,
      });
      expect(dataOf(last).nextOffset).toBeUndefined();
      expect(dataOf(last).notice).toEqual(expect.stringContaining('API result ceiling'));
      fakeJson(words.slice(0, 5));
      const pending = runToolContract(tool, { ...input, offset: 5 });
      await vi.runAllTimersAsync();
      const past = await pending;
      expect(dataOf(past)).toMatchObject({ words: [], returnedCount: 0, truncated: false });
      expect(dataOf(past).nextOffset).toBeUndefined();
      expect(JSON.stringify(past)).not.toMatch(/exhausted|totalCount/);
    });

    it.each([-1, 1000, 0.5])('rejects invalid offset %s before I/O', async (offset) => {
      const fetch = fakeJson([]);
      assertFailure(
        await runToolContract(tool, { ...input, offset }),
        JsonRpcErrorCode.InvalidParams,
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it('returns a single oversized row intact with disclosure and progress', async () => {
      const row = {
        word: 'huge',
        defs: ['n\t' + '<`😀'.repeat(20000)],
        future: { nested: [null, true] },
      };
      fakeJson([row]);
      const result = await runToolContract(tool, input);
      expect(result.isError).not.toBe(true);
      expect(dataOf(result)).toMatchObject({
        words: [row],
        returnedCount: 1,
        truncated: false,
        nextOffset: 1,
      });
      expect(dataOf(result).notice).toEqual(expect.stringContaining('oversized row'));
      expect(fences(result)).toContainEqual({ words: [row] });
      expect(textOf(result)).toContain(String(dataOf(result).notice));
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
      'rejects invalid limit %s before I/O',
      async (limit) => {
        const fetch = fakeJson([]);
        assertFailure(
          await runToolContract(tool, { ...input, limit }),
          JsonRpcErrorCode.InvalidParams,
        );
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    it.each([400, 401, 403, 404, 409, 422, 429, 302, 418])(
      'renders declared HTTP %s classification and recovery',
      async (status) => {
        vi.useFakeTimers();
        const fetch = vi.fn(
          async () =>
            new Response('private upstream secret https://example.test/?query=secret', {
              status,
              headers: { 'Retry-After': '1' },
            }),
        );
        vi.stubGlobal('fetch', fetch);
        const pending = runToolContract(tool, input);
        await vi.runAllTimersAsync();
        const result = await pending;
        const reasons: Record<number, string> = {
          400: 'upstream_rejected',
          401: 'upstream_unauthorized',
          403: 'upstream_forbidden',
          404: 'upstream_not_found',
          409: 'upstream_conflict',
          422: 'upstream_validation',
          429: 'upstream_rate_limited',
          302: 'upstream_unexpected_status',
          418: 'upstream_unexpected_status',
        };
        const contract = tool.errors!.find((entry) => entry.reason === reasons[status])!;
        assertFailure(result, contract.code, contract.reason, contract.recovery);
        expect(JSON.stringify(result)).not.toContain('private upstream secret');
        expect(JSON.stringify(result)).not.toContain('query=secret');
        expect(fetch.mock.calls.length).toBe(status === 429 ? 2 : 1);
      },
    );

    it.each(['not json', '{}', '[{"word":42}]', '[{"word":"valid"},{"word":"bad","tags":null}]'])(
      'rejects malformed payload atomically: %s',
      async (body) => {
        const fetch = vi.fn(async () => new Response(body));
        vi.stubGlobal('fetch', fetch);
        const contract = tool.errors!.find(
          (entry) => entry.reason === 'invalid_upstream_response',
        )!;
        assertFailure(
          await runToolContract(tool, input),
          contract.code,
          contract.reason,
          contract.recovery,
        );
        expect(fetch).toHaveBeenCalledTimes(1);
      },
    );

    it('returns declared queue-shed recovery when the shared queue is full', async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
                once: true,
              });
            }),
        ),
      );
      const calls = Array.from({ length: 21 }, () =>
        runToolContract(tool, input, { context: { signal: controller.signal } }),
      );
      await vi.advanceTimersByTimeAsync(0);
      const result = await runToolContract(tool, input);
      const contract = tool.errors!.find((entry) => entry.reason === 'pacer_shed')!;
      assertFailure(result, contract.code, contract.reason, contract.recovery);
      controller.abort();
      await Promise.all(calls);
    });

    it.each([500, 503])(
      'bounds retries and preserves availability recovery for HTTP %s',
      async (status) => {
        vi.useFakeTimers();
        const fetch = vi.fn(async () => new Response('secret', { status }));
        vi.stubGlobal('fetch', fetch);
        const pending = runToolContract(tool, input);
        await vi.runAllTimersAsync();
        const result = await pending;
        assertFailure(
          result,
          JsonRpcErrorCode.ServiceUnavailable,
          undefined,
          `Retry ${tool.name} later; call datamuse_list_reference with topic='limitations' for availability and quota guidance.`,
        );
        expect(fetch).toHaveBeenCalledTimes(2);
      },
    );

    it('returns timeout recovery when the network never responds', async () => {
      vi.useFakeTimers();
      const fetch = vi.fn(
        (_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
              once: true,
            });
          }),
      );
      vi.stubGlobal('fetch', fetch);
      const pending = runToolContract(tool, input);
      await vi.runAllTimersAsync();
      assertFailure(
        await pending,
        JsonRpcErrorCode.Timeout,
        undefined,
        `Retry ${tool.name} later; call datamuse_list_reference with topic='limitations' for availability and quota guidance.`,
      );
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('settles caller cancellation without suggesting retry', async () => {
      const controller = new AbortController();
      const fetch = vi.fn(
        (_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
              once: true,
            });
            controller.abort();
          }),
      );
      vi.stubGlobal('fetch', fetch);
      const result = await runToolContract(tool, input, { context: { signal: controller.signal } });
      assertFailure(result, JsonRpcErrorCode.RequestCancelled);
      expect(textOf(result)).toMatch(/cancel/i);
      expect(textOf(result)).not.toMatch(/retry/i);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
}

describe('search query semantics', () => {
  it('measures exact serialized boundary bytes after metadata and escaping, selecting one prefix for both surfaces', async () => {
    vi.useFakeTimers();
    const options = {
      means_like: '<`😀',
      include_definitions: true,
      include_pronunciation: true,
      include_ipa: true,
    };
    const rows = [
      { word: 'first', tags: ['pron: A1 ', 'ipa_pron:ɑ'] },
      { word: 'second', defs: [''] },
    ];
    fakeJson(rows);
    const base = await runToolContract(findWordsTool, options);
    const padding = 64000 - Buffer.byteLength(JSON.stringify(base.content));
    expect(padding).toBeGreaterThan(0);
    for (const delta of [-1, 0, 1]) {
      const words = [rows[0]!, { ...rows[1]!, defs: ['x'.repeat(padding + delta)] }];
      fakeJson(words);
      const pending = runToolContract(findWordsTool, options);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.isError).not.toBe(true);
      expect(Buffer.byteLength(JSON.stringify(result.content))).toBeLessThanOrEqual(64000);
      expect(Buffer.byteLength(JSON.stringify(result.structuredContent))).toBeLessThanOrEqual(
        64000,
      );
      expect(dataOf(result)).toMatchObject({
        words: words.slice(0, delta > 0 ? 1 : 2),
        truncated: delta > 0,
      });
      expect(fences(result)).toContainEqual({ words: dataOf(result).words });
      if (delta <= 0) expect(Buffer.byteLength(JSON.stringify(result.content))).toBe(64000 + delta);
      else expect(dataOf(result).nextOffset).toBe(1);
    }
  });

  it('re-runs changed rankings and walks multiple byte-cut pages to a past-end offset', async () => {
    vi.useFakeTimers();
    const words = Array.from({ length: 5 }, (_, index) => ({
      word: String(index),
      defs: ['<`😀'.repeat(2500)],
    }));
    let upstream = words;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(upstream)),
    );
    const call = async (offset: number) => {
      const pending = runToolContract(findWordsTool, { spelled_like: '*', offset, limit: 20 });
      await vi.runAllTimersAsync();
      return pending;
    };
    const first = await call(0);
    const next = dataOf(first).nextOffset as number;
    expect(next).toBe(1);
    upstream = [words[1]!, words[0]!, ...words.slice(2)];
    const second = await call(next);
    expect(dataOf(second).words).toEqual([words[0]]);
    expect(dataOf(second).notice).toEqual(expect.stringContaining('Rankings may change'));
    const third = await call(dataOf(second).nextOffset as number);
    expect(dataOf(third).words).toEqual([words[2]]);
    const last = await call(4);
    expect(dataOf(last).words).toEqual([words[4]]);
    expect(dataOf(last).nextOffset).toBeUndefined();
    const past = await call(5);
    expect(dataOf(past)).toMatchObject({ words: [], returnedCount: 0, truncated: false });
    expect(dataOf(past).nextOffset).toBeUndefined();
  });
  it('cuts an existing large definitions call before either serialized surface exceeds 64000 bytes', async () => {
    fakeJson(
      Array.from({ length: 100 }, (_, index) => ({
        word: String(index),
        defs: ['n\t' + 'large'.repeat(1000)],
      })),
    );
    const result = await runToolContract(findRhymesTool, {
      word: 'day',
      limit: 100,
      include_definitions: true,
    });
    expect(result.isError).not.toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result.content))).toBeLessThanOrEqual(64000);
    expect(Buffer.byteLength(JSON.stringify(result.structuredContent))).toBeLessThanOrEqual(64000);
  });
  it.each([
    { tool: findRhymesTool, input: { word: 'ice cream', rhyme_type: 'exact' as const } },
    { tool: findRhymesTool, input: { word: 'ice cream', rhyme_type: 'near' as const } },
    { tool: findSynonymsTool, input: { word: 'look after' } },
    {
      tool: findWordsTool,
      input: { relations: [{ relation: 'synonyms' as const, word: 'look after' }] },
    },
  ])('explains empty phrase relations in $tool.name', async ({ tool, input }) => {
    fakeJson([]);
    const result = await runToolContract(tool, input);
    expect(result.isError).not.toBe(true);
    expect(dataOf(result).notice).toEqual(
      expect.stringContaining('Phrase relations may have limited coverage'),
    );
    expect(dataOf(result).notice).toEqual(expect.stringContaining('means_like'));
    expect(textOf(result)).toContain(String(dataOf(result).notice));
    if (tool === findRhymesTool)
      expect(dataOf(result).notice).toEqual(expect.stringContaining('final word'));
  });

  it('bounds whole rows on each assembled surface and advances through byte-cut pages', async () => {
    vi.useFakeTimers();
    const words = Array.from({ length: 20 }, (_, index) => ({
      word: String(index),
      tags: ['pron: F L AW1 ER0 ', 'ipa_pron:fɫˈaʊɝ'],
      defs: ['n\t' + '<`😀\\"\n'.repeat(400)],
    }));
    const fetch = fakeJson(words);
    const first = await runToolContract(findRhymesTool, {
      word: 'day',
      limit: 20,
      include_pronunciation: true,
      include_ipa: true,
    });
    expect(first.isError).not.toBe(true);
    expect(Buffer.byteLength(JSON.stringify(first.structuredContent))).toBeLessThanOrEqual(64000);
    expect(Buffer.byteLength(JSON.stringify(first.content))).toBeLessThanOrEqual(64000);
    const count = dataOf(first).returnedCount as number;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(20);
    expect(dataOf(first)).toMatchObject({
      truncated: true,
      nextOffset: count,
      words: words.slice(0, count),
    });
    expect(fences(first)).toContainEqual({ words: words.slice(0, count) });
    const pending = runToolContract(findRhymesTool, { word: 'day', limit: 20, offset: count });
    await vi.runAllTimersAsync();
    const second = await pending;
    expect(dataOf(second).words).toEqual(
      words.slice(count, count + (dataOf(second).returnedCount as number)),
    );
    expect(new URL(String(fetch.mock.calls[1]?.[0])).searchParams.get('max')).toBe(
      String(count + 20),
    );
  });

  it.each(tools)(
    'clamps limits and forwards resolved metadata in $tool.name',
    async ({ tool, input }) => {
      const fetch = fakeJson([]);
      const result = await runToolContract(tool, {
        ...input,
        limit: Number.MAX_SAFE_INTEGER,
        offset: 999,
        include_ipa: true,
      });
      expect(result.isError).not.toBe(true);
      expect(dataOf(result).effectiveQuery).toMatchObject({
        limit: 1000,
        requestedLimit: Number.MAX_SAFE_INTEGER,
        offset: 999,
        include_pronunciation: true,
        include_ipa: true,
        metadata: 'psfr',
        ipa: 1,
      });
      expect(
        Object.fromEntries(new URL(String(fetch.mock.calls[0]?.[0])).searchParams),
      ).toMatchObject({ max: '1000', md: 'psfr', ipa: '1' });
      expect(fences(result)).toContainEqual(dataOf(result).effectiveQuery);
    },
  );
  it('preserves accepted nonempty phrase relations without rewriting targets', async () => {
    const words = [{ word: 'phrase match', tags: ['unknown'], future: { nested: [1, null] } }];
    const fetch = fakeJson(words);
    const result = await runToolContract(findRhymesTool, { word: ' ice cream ' });
    expect(dataOf(result).words).toEqual(words);
    expect(dataOf(result).effectiveQuery).toMatchObject({ word: 'ice cream' });
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get('rel_rhy')).toBe('ice cream');
    expect(dataOf(result).notice).toBeUndefined();
    expect(fences(result)).toContainEqual({ words });
  });
  it.each([
    ['exact_rhyme', 'rhy'],
    ['near_rhyme', 'nry'],
    ['synonyms', 'syn'],
    ['antonyms', 'ant'],
    ['broader', 'spc'],
    ['narrower', 'gen'],
    ['parts', 'com'],
    ['wholes', 'par'],
    ['nouns_modified_by', 'jja'],
    ['adjectives_describing', 'jjb'],
    ['followers', 'bga'],
    ['predecessors', 'bgb'],
    ['associated', 'trg'],
    ['homophones', 'hom'],
    ['consonant_match', 'cns'],
  ] as const)('maps the named %s relation to rel_%s', async (relation, code) => {
    const fetch = fakeJson([]);
    const result = await runToolContract(findWordsTool, {
      relations: [{ relation, word: ' Target ' }],
    });
    expect(result.isError).not.toBe(true);
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get(`rel_${code}`)).toBe(
      'Target',
    );
    expect(dataOf(result).effectiveQuery).toMatchObject({
      relations: [{ relation, word: 'Target' }],
    });
  });

  it('roundtrips adversarial query echo without turning it into Markdown', async () => {
    fakeJson([]);
    const means_like = '```\n<img src=x>\r\n[link](https://example.test)';
    const result = await runToolContract(findWordsTool, { means_like });
    expect(fences(result)).toContainEqual(dataOf(result).effectiveQuery);
    expect(dataOf(result).effectiveQuery).toMatchObject({ means_like });
    expect(textOf(result)).not.toContain('<img');
  });

  it('omits blank rhyme constraints and gives near rhymes a distinct empty route', async () => {
    const fetch = fakeJson([]);
    const result = await runToolContract(findRhymesTool, {
      word: 'tea',
      rhyme_type: 'near',
      means_like: ' ',
      spelled_like: '',
    });
    const params = new URL(String(fetch.mock.calls[0]?.[0])).searchParams;
    expect(params.has('ml')).toBe(false);
    expect(params.has('sp')).toBe(false);
    expect(dataOf(result).notice).not.toEqual(expect.stringContaining('fewer means_like'));
    expect(dataOf(result).notice).not.toEqual(expect.stringContaining("rhyme_type='near'"));
    expect(dataOf(result).notice).toEqual(expect.stringContaining('sounds_like'));
  });

  it.each([findRhymesTool, findSynonymsTool])(
    'enforces nonblank word and 200-character bounds for $name',
    async (tool) => {
      const fetch = fakeJson([]);
      for (const word of ['', ' ', 'x'.repeat(201)])
        assertFailure(await runToolContract(tool, { word }), JsonRpcErrorCode.InvalidParams);
      expect(fetch).not.toHaveBeenCalled();
      expect((await runToolContract(tool, { word: 'x'.repeat(200) })).isError).not.toBe(true);
    },
  );

  it('enforces lexical string limits at the wire before network I/O', async () => {
    const fetch = fakeJson([]);
    for (const input of [
      { means_like: 'x'.repeat(501) },
      { spelled_like: 'x'.repeat(201) },
      { sounds_like: 'x'.repeat(201) },
    ])
      assertFailure(await runToolContract(findWordsTool, input), JsonRpcErrorCode.InvalidParams);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (
        await runToolContract(findWordsTool, {
          means_like: 'x'.repeat(500),
          spelled_like: 'x'.repeat(200),
          sounds_like: 'x'.repeat(200),
        })
      ).isError,
    ).not.toBe(true);
  });

  it('accepts 14 relation constraints and rejects 15 without dropping repeats', async () => {
    const fetch = fakeJson([]);
    const relations = Array.from({ length: 14 }, (_, index) => ({
      relation: 'associated' as const,
      word: String(index),
    }));
    expect((await runToolContract(findWordsTool, { relations })).isError).not.toBe(true);
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.getAll('rel_trg')).toHaveLength(
      14,
    );
    assertFailure(
      await runToolContract(findWordsTool, {
        relations: [...relations, { relation: 'associated', word: 'extra' }],
      }),
      JsonRpcErrorCode.InvalidParams,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['exact', 'near'] as const)(
    'maps %s rhymes with combined trimmed constraints',
    async (rhyme_type) => {
      const fetch = fakeJson([]);
      const result = await runToolContract(findRhymesTool, {
        word: ' Thé ',
        rhyme_type,
        means_like: ' deep blue ',
        spelled_like: ' t?* ',
      });
      const url = new URL(String(fetch.mock.calls[0]?.[0]));
      expect(url.origin + url.pathname).toBe('https://api.datamuse.com/words');
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        [rhyme_type === 'exact' ? 'rel_rhy' : 'rel_nry']: 'Thé',
        ml: 'deep blue',
        sp: 't?*',
        md: 'psf',
        max: '20',
      });
      expect(dataOf(result).notice).toEqual(
        expect.stringContaining('fewer means_like or spelled_like'),
      );
      expect(String(dataOf(result).notice).includes("rhyme_type='near'")).toBe(
        rhyme_type === 'exact',
      );
    },
  );

  it.each([
    ['synonyms', 'syn'],
    ['antonyms', 'ant'],
    ['broader', 'spc'],
    ['narrower', 'gen'],
  ] as const)('maps %s in the documented direction', async (relation, suffix) => {
    const fetch = fakeJson([]);
    await runToolContract(findSynonymsTool, { word: ' Tree ', relation });
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get(`rel_${suffix}`)).toBe(
      'Tree',
    );
  });

  it('preserves repeated relations and all constraints without rewriting punctuation or accents', async () => {
    const fetch = fakeJson([]);
    const result = await runToolContract(findWordsTool, {
      means_like: ' sea & sky ',
      sounds_like: ' Jiráf ',
      spelled_like: ' w?* ',
      relations: [
        { relation: 'parts', word: ' tree ' },
        { relation: 'parts', word: ' machine ' },
        { relation: 'wholes', word: ' leaf ' },
      ],
      left_context: ' drink ',
      right_context: ' now ',
      topics: [' ', ' ocean ', '', ' blue '],
    });
    const params = new URL(String(fetch.mock.calls[0]?.[0])).searchParams;
    expect(params.getAll('rel_com')).toEqual(['tree', 'machine']);
    expect(params.get('rel_par')).toBe('leaf');
    expect(Object.fromEntries(params)).toMatchObject({
      ml: 'sea & sky',
      sl: 'Jiráf',
      sp: 'w?*',
      lc: 'drink',
      rc: 'now',
      topics: 'ocean,blue',
    });
    expect(fences(result)).toContainEqual(dataOf(result).effectiveQuery);
  });

  it('omits all blank optional fields and empty arrays while retaining the hard constraint', async () => {
    const fetch = fakeJson([]);
    const result = await runToolContract(findWordsTool, {
      means_like: ' word ',
      sounds_like: ' ',
      spelled_like: '\t',
      relations: [],
      topics: ['', ' '],
      left_context: '',
      right_context: ' ',
    });
    expect([...new URL(String(fetch.mock.calls[0]?.[0])).searchParams.keys()]).toEqual([
      'ml',
      'max',
      'md',
    ]);
    expect(dataOf(result).effectiveQuery).toEqual({
      means_like: 'word',
      limit: 20,
      offset: 0,
      include_definitions: false,
      include_pronunciation: false,
      include_ipa: false,
      vocabulary: 'en',
      metadata: 'psf',
    });
  });

  it('counts topic bounds after dropping blank entries and supports Spanish searches', async () => {
    const fetch = fakeJson([]);
    const result = await runToolContract(findWordsTool, {
      means_like: ' mar ',
      vocabulary: 'es',
      topics: ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', ' '],
    });
    expect(result.isError).not.toBe(true);
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get('v')).toBe('es');
  });

  it.each([
    { input: { topics: ['one'] }, reason: 'missing_constraint' },
    {
      input: { means_like: ' ', relations: [], sounds_like: '', spelled_like: '\t' },
      reason: 'missing_constraint',
    },
    {
      input: {
        means_like: 'sea',
        vocabulary: 'es',
        relations: [{ relation: 'synonyms', word: 'mar' }],
      },
      reason: 'unsupported_vocabulary_relation',
    },
    { input: { means_like: 'sea', topics: ['two words'] }, reason: 'invalid_context_hint' },
    { input: { means_like: 'sea', left_context: 'a,b' }, reason: 'invalid_context_hint' },
    { input: { means_like: 'sea', right_context: 'two\twords' }, reason: 'invalid_context_hint' },
  ])('rejects $reason before I/O', async ({ input, reason }) => {
    const fetch = fakeJson([]);
    const contract = findWordsTool.errors!.find((entry) => entry.reason === reason)!;
    const result = await runToolContract(
      findWordsTool,
      input as Parameters<typeof findWordsTool.input.parse>[0] & { means_like: string },
    );
    assertFailure(result, contract.code, reason, contract.recovery);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects six nonblank topics and unknown keys', async () => {
    const fetch = fakeJson([]);
    for (const input of [
      { means_like: 'sea', topics: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { means_like: 'sea', unknown: 2 },
    ]) {
      assertFailure(await runToolContract(findWordsTool, input), JsonRpcErrorCode.InvalidParams);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
