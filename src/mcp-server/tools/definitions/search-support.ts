/**
 * @fileoverview Shared search enrichment and normalization.
 * @module mcp-server/tools/definitions/search-support
 */
import { z } from '@cyanheads/mcp-ts-core';
import { renderJson } from '../../../services/datamuse/serialization.js';
import type { DatamuseQuery, SearchToolName } from '../../../services/datamuse/types.js';

/** Treat blank optional lexical values as absent without changing interior text. */
export function optionalText(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

/** Shared success context, populated for every successful search. */
export const searchEnrichment = {
  effectiveQuery: z
    .object({
      limit: z.number().describe('Resolved result cap.'),
      include_definitions: z.boolean().describe('Whether definitions were requested.'),
      vocabulary: z.enum(['en', 'es']).describe('Resolved vocabulary.'),
      metadata: z.string().describe('Requested upstream metadata flags.'),
    })
    .catchall(z.json())
    .describe('Normalized search inputs, relations, defaults, and metadata flags.'),
  returnedCount: z
    .number()
    .int()
    .nonnegative()
    .describe('Number of returned words, not a total-match estimate.'),
  limitReached: z
    .boolean()
    .describe('Whether the returned count equals the requested cap; more matches may exist.'),
  notice: z.string().optional().describe('Server-authored empty-result or result-cap guidance.'),
};

/** Lossless structured-query rendering on the text surface. */
export const searchEnrichmentTrailer = {
  effectiveQuery: { render: (value: unknown) => renderJson(value, 'Datamuse effective query') },
};

/** Construct complete context with honest cap and empty-result guidance. */
export function searchContext(
  query: DatamuseQuery,
  count: number,
  tool: SearchToolName,
  emptyNotice: string,
  selected: Record<string, string> = {},
) {
  const effectiveQuery = {
    ...query,
    ...selected,
    metadata: query.include_definitions ? 'psfd' : 'psf',
  };
  const limitReached = count === query.limit;
  const notice =
    count === 0
      ? emptyNotice
      : limitReached
        ? query.limit === 1000
          ? 'The API result ceiling of 1000 was reached; more matches may exist, but no continuation is available. Refine meaning, spelling, or relation constraints with datamuse_find_words to explore a narrower set.'
          : `The requested result limit was reached; more matches may exist. Re-run ${tool} with a larger limit, up to 1000, or refine constraints with datamuse_find_words.`
        : undefined;
  return { effectiveQuery, returnedCount: count, limitReached, ...(notice ? { notice } : {}) };
}
