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
    .max(1000)
    .default(20)
    .describe('Maximum returned words, 1–1000; no pagination or total count is available.'),
  include_definitions: z
    .boolean()
    .default(false)
    .describe('Include upstream definitions; senses may make the response substantially larger.'),
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
    'Spelling constraint, at most 200 characters; * matches any length and ? one character; blank means unset.',
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
  left_context?: string;
  limit: number;
  means_like?: string;
  relations?: { relation: keyof typeof RELATION_CODES; word: string }[];
  right_context?: string;
  sounds_like?: string;
  spelled_like?: string;
  topics?: string[];
  vocabulary: 'en' | 'es';
}
/** Calling tool used only in authored recovery text. */
export type SearchToolName =
  | 'datamuse_find_rhymes'
  | 'datamuse_find_synonyms'
  | 'datamuse_find_words';
