/**
 * @fileoverview Lossless fenced rendering and Datamuse query serialization tests.
 * @module tests/services/serialization.test
 */
import { describe, expect, it } from 'vitest';
import { buildSearchUrl } from '@/services/datamuse/datamuse-service.js';
import { renderJson } from '@/services/datamuse/serialization.js';
import type { DatamuseQuery } from '@/services/datamuse/types.js';

describe('Datamuse serialization', () => {
  it('round-trips nested unknown values and hostile Markdown without opening HTML or extra fences', () => {
    const value = {
      words: [
        {
          word: '```\n</script><img src=x> & [click](https://example.com)',
          defs: ['n\tline\r\nnext  '],
          extra: { list: [null, true, 0, { accented: 'café 😀' }] },
        },
      ],
    };
    const rendered = renderJson(value);
    expect(rendered.match(/```/g)).toHaveLength(2);
    expect(rendered).not.toContain('<');
    expect(JSON.parse(rendered.split('```json\n')[1]!.split('\n```')[0]!)).toEqual(value);
    expect(rendered).toContain('\\u0060');
    expect(rendered).toContain('\\u003c');
  });

  it('serializes every relation direction independently and keeps repeated targets', () => {
    const relations: [NonNullable<DatamuseQuery['relations']>[number]['relation'], string][] = [
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
    ];
    for (const [relation, code] of relations) {
      const url = buildSearchUrl({
        vocabulary: 'en',
        limit: 20,
        include_definitions: false,
        relations: [
          { relation, word: 'one' },
          { relation, word: 'two' },
        ],
      });
      expect(url.searchParams.getAll(`rel_${code}`)).toEqual(['one', 'two']);
      expect([...url.searchParams.keys()]).toEqual([`rel_${code}`, `rel_${code}`, 'max', 'md']);
    }
  });

  it('encodes values without turning punctuation into query parameters', () => {
    const value = 'Café & v=evil + #?/* 😀';
    const url = buildSearchUrl({
      vocabulary: 'es',
      limit: 1000,
      include_definitions: true,
      means_like: value,
      sounds_like: 'jirraf',
      spelled_like: 'g*?',
      left_context: 'drink',
      right_context: 'now',
      topics: ['food', 'drink'],
    });
    expect(url.origin).toBe('https://api.datamuse.com');
    expect(url.pathname).toBe('/words');
    expect(url.hash).toBe('');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ml: value,
      sp: 'g*?',
      sl: 'jirraf',
      lc: 'drink',
      rc: 'now',
      topics: 'food,drink',
      v: 'es',
      max: '1000',
      md: 'psfd',
    });
  });

  it('omits English vocabulary and empty arrays without inventing constraints', () => {
    expect([
      ...buildSearchUrl({
        vocabulary: 'en',
        limit: 1,
        include_definitions: false,
        topics: [],
        relations: [],
      }).searchParams,
    ]).toEqual([
      ['max', '1'],
      ['md', 'psf'],
    ]);
  });
});
