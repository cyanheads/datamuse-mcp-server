/**
 * @fileoverview Shared Datamuse schemas, relation mappings, and query types.
 * @module services/datamuse/types
 */
import { z } from '@cyanheads/mcp-ts-core';

/** Named relations and their upstream parameter suffixes. */
export const RELATION_CODES = {
  exact_rhyme: 'rhy',
  near_rhyme: 'nry',
  synonyms: 'syn',
  antonyms: 'ant',
  broader: 'spc',
  narrower: 'gen',
  parts: 'com',
  wholes: 'par',
  nouns_modified_by: 'jja',
  adjectives_describing: 'jjb',
  followers: 'bga',
  predecessors: 'bgb',
  associated: 'trg',
  homophones: 'hom',
  consonant_match: 'cns',
} as const;

/** Supported named relation. */
export const relationSchema = z.enum(
  Object.keys(RELATION_CODES) as [keyof typeof RELATION_CODES, ...(keyof typeof RELATION_CODES)[]],
);
/** Shared input fields; handlers trim lexical inputs after schema validation. */
export const searchInputFields = {
  limit: z
    .number()
    .int()
    .min(1)
    .default(20)
    .describe(
      'Positive safe-integer row limit, default 20; values above 1000 are clamped and disclosed. Whole rows may be cut by the response byte budget.',
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .max(999)
    .default(0)
    .describe(
      'Best-effort row offset, 0–999; re-runs the query, so rankings may change. No snapshot or total count.',
    ),
  include_definitions: z
    .boolean()
    .default(false)
    .describe('Include upstream definitions; senses may make the response substantially larger.'),
  include_pronunciation: z
    .boolean()
    .default(false)
    .describe(
      'Request raw pronunciation tags; ARPAbet stress digits are 0 unstressed, 1 primary, 2 secondary. May be guessed or omitted.',
    ),
  include_ipa: z
    .boolean()
    .default(false)
    .describe(
      'Request IPA tags and imply pronunciation; raw ARPAbet and IPA tags may both be returned.',
    ),
};
/** Optional related meaning constraint. */
export const meansLikeSchema = z
  .string()
  .max(500)
  .optional()
  .describe('Related meaning, at most 500 characters; blank means unset.');
/** Optional spelling constraint, interpreted upstream. */
export const spelledLikeSchema = z
  .string()
  .max(200)
  .optional()
  .describe(
    'Upstream spelling pattern, at most 200 characters: * any length, ? one character, //listen anagrams (including phrases), @ English vowel including y, # consonant, +letters restricts allowed letters (repeats/spaces possible), -letters excludes letters. Without syntax, similar spellings. Blank means unset.',
  );
/** Required lexical target. */
export const wordSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/\S/)
  .describe(
    'Nonblank target word or phrase, at most 200 characters; surrounding whitespace is trimmed.',
  );

/** Upstream row preserving absent and additional JSON properties. */
export const wordResultSchema = z
  .object({
    word: z.string().describe('Upstream word or phrase, preserved exactly.'),
    score: z
      .number()
      .finite()
      .optional()
      .describe('Optional upstream ranking score; not confidence or frequency.'),
    numSyllables: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Optional upstream syllable count, which may be guessed.'),
    tags: z
      .array(z.string())
      .optional()
      .describe('Optional raw metadata tags, including unknown tags.'),
    defs: z
      .array(z.string())
      .optional()
      .describe('Optional raw definitions; tabs and whitespace are preserved.'),
    defHeadword: z
      .string()
      .optional()
      .describe('Optional upstream headword associated with definitions.'),
  })
  .catchall(z.json());
/** Shared network-tool output. */
export const searchOutputSchema = z.object({
  words: z
    .array(wordResultSchema.describe('One complete upstream word result.'))
    .describe('Matching upstream rows in original order; empty is a successful result.'),
});
/** One complete upstream row. */
export type WordResult = z.infer<typeof wordResultSchema>;
/** Normalized domain query; arbitrary URL and parameter keys are unavailable. */
export interface DatamuseQuery {
  include_definitions: boolean;
  include_ipa?: boolean;
  include_pronunciation?: boolean;
  left_context?: string;
  limit: number;
  means_like?: string;
  offset?: number;
  relations?: { relation: keyof typeof RELATION_CODES; word: string }[];
  requestedLimit?: number;
  right_context?: string;
  sounds_like?: string;
  spelled_like?: string;
  topics?: string[];
  vocabulary: 'en' | 'es';
}
/** Resolve metadata once for URL construction and the effective query echo. */
export function metadataOptions(
  query: Pick<DatamuseQuery, 'include_definitions' | 'include_pronunciation' | 'include_ipa'>,
) {
  return {
    include_pronunciation: Boolean(query.include_pronunciation || query.include_ipa),
    include_ipa: Boolean(query.include_ipa),
    metadata: `psf${query.include_definitions ? 'd' : ''}${query.include_pronunciation || query.include_ipa ? 'r' : ''}`,
    ...(query.include_ipa ? { ipa: 1 as const } : {}),
  };
}
/** Calling tool used only in authored recovery text. */
export type SearchToolName =
  | 'datamuse_get_word_info'
  | 'datamuse_find_rhymes'
  | 'datamuse_find_synonyms'
  | 'datamuse_find_words';
