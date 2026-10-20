/**
 * @fileoverview Offline reference wire contract and complete rendering tests.
 * @module tests/tools/list-reference.tool.test
 */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listReferenceTool } from '@/mcp-server/tools/definitions/list-reference.tool.js';

afterEach(() => vi.unstubAllGlobals());

describe('datamuse_list_reference', () => {
  it.each(['all', 'relations', 'metadata', 'combinations', 'limitations'] as const)(
    'returns the complete %s reference on both surfaces without network I/O',
    async (topic) => {
      const fetch = vi.fn(() => {
        throw new Error('Offline reference must not fetch');
      });
      vi.stubGlobal('fetch', fetch);
      const result = await runToolContract(listReferenceTool, { topic });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(expect.schemaMatching(listReferenceTool.output));
      const data = listReferenceTool.output.parse(result.structuredContent);
      expect(data?.topic).toBe(topic);
      expect(data?.sections).toHaveLength(topic === 'all' ? 4 : 1);
      const text = result.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      expect(JSON.parse(text.split('```json\n')[1]!.split('\n```')[0]!)).toEqual(data);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('defaults to all sections in documented order and retains substantive guidance', async () => {
    const result = await runToolContract(listReferenceTool, {});
    const data = listReferenceTool.output.parse(result.structuredContent);
    expect(data.sections.map((section) => section.topic)).toEqual([
      'relations',
      'metadata',
      'combinations',
      'limitations',
    ]);
    expect(data.sections[0]?.text).toContain('broader (rel_spc): broader category');
    expect(data.sections[0]?.text).toContain('parts (rel_com): part of the target');
    expect(data.sections[1]?.text).toContain('per million words');
    expect(data.sections[1]?.text).toContain('ipa=1');
    expect(data.sections[2]?.text).toContain('conjunction, not a union');
    expect(data.sections[3]?.text).toContain('January 1 and February 1');
    expect(data.sections[3]?.text).toContain('no continuation beyond index 999');
    expect(data.sections[0]?.text).toContain('Phrase relations may have limited coverage');
    expect(data.sections[1]?.text).toContain(
      '0 unstressed, 1 primary stress, and 2 secondary stress',
    );
    expect(data.sections[1]?.text).toContain('include_ipa implies pronunciation');
    for (const pattern of ['//listen', 'c@t', 's#@p', '*+abc', 'b????-e', 'hipopatamus'])
      expect(data.sections[2]?.text).toContain(pattern);
    expect(data.sections[2]?.text).toContain('including y');
    expect(data.sections[2]?.text).toContain('neither requires every listed letter');
    expect(data.sections[3]?.text).toContain('64,000-byte budget');
  });

  it.each([{ topic: 'unknown' }, { topic: 'ALL' }, { extra: true }])(
    'rejects invalid reference arguments %j on both surfaces',
    async (input) => {
      const result = await runToolContract(listReferenceTool, input as { topic: 'all' });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.InvalidParams },
      });
      expect(
        result.content.some((block) => block.type === 'text' && block.text.includes('error')),
      ).toBe(true);
    },
  );
});
