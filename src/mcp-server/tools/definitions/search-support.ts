/**
 * @fileoverview Shared search enrichment and normalization.
 * @module mcp-server/tools/definitions/search-support
 */
import { z } from '@cyanheads/mcp-ts-core';
import { renderJson } from '../../../services/datamuse/serialization.js';
import {
  type DatamuseQuery,
  metadataOptions,
  type SearchToolName,
  type WordResult,
} from '../../../services/datamuse/types.js';

/** Treat blank optional lexical values as absent without changing interior text. */
export function optionalText(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

/** Shared success context, populated for every successful search. */
export const searchEnrichment = {
  effectiveQuery: z
    .object({
      limit: z.number().describe('Resolved result cap.'),
      requestedLimit: z
        .number()
        .int()
        .optional()
        .describe('Original positive safe-integer limit when clamped above 1000.'),
      offset: z.number().int().min(0).max(999).describe('Best-effort starting row index.'),
      include_definitions: z.boolean().describe('Whether definitions were requested.'),
      include_pronunciation: z
        .boolean()
        .describe('Whether pronunciation was requested, including when implied by IPA.'),
      include_ipa: z.boolean().describe('Whether IPA notation was requested.'),
      ipa: z.literal(1).optional().describe('Resolved upstream IPA selector when enabled.'),
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
  truncated: z
    .boolean()
    .describe(
      'Whether complete rows were omitted locally by the byte budget; not upstream exhaustion.',
    ),
  nextOffset: z
    .number()
    .int()
    .min(0)
    .max(999)
    .optional()
    .describe(
      'Best-effort next row index within the API ceiling, when a byte cut or reached fetch cap permits navigation; not a stable cursor.',
    ),
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
    offset: query.offset ?? 0,
    ...selected,
    ...metadataOptions(query),
  };
  const limitReached = count === query.limit;
  let notice =
    count === 0
      ? emptyNotice
      : limitReached
        ? query.limit === 1000
          ? 'The API result ceiling of 1000 was reached; more matches may exist, but no continuation beyond index 999 is available. Refine constraints with datamuse_find_words.'
          : `The requested result limit was reached; more matches may exist. Re-run ${tool} with a larger limit, up to 1000, or refine constraints with datamuse_find_words.`
        : undefined;
  if (count === 0 && query.relations?.some(({ word }) => word.trim().split(/\s/u).length > 1)) {
    notice = `No words matched the effective query. Phrase relations may have limited coverage. Try datamuse_find_words with means_like or sounds_like set to the phrase.${tool === 'datamuse_find_rhymes' ? ' For rhymes, explicitly try the final word as the target.' : ''} Inputs are not split or rewritten automatically.`;
  }
  return { effectiveQuery, returnedCount: count, limitReached, ...(notice ? { notice } : {}) };
}

/** Normalize bounded search controls before arithmetic or network construction. */
export function searchControls(input: {
  limit: number;
  offset: number;
  include_definitions: boolean;
  include_pronunciation: boolean;
  include_ipa: boolean;
}) {
  return {
    limit: Math.min(1000, input.limit),
    ...(input.limit > 1000 ? { requestedLimit: input.limit } : {}),
    offset: input.offset,
    include_definitions: input.include_definitions,
    include_pronunciation: input.include_pronunciation || input.include_ipa,
    include_ipa: input.include_ipa,
  };
}

/** Render the domain block identically for formatting and byte accounting. */
export function searchContent(result: { words: WordResult[] }) {
  return [{ type: 'text' as const, text: renderJson(result, 'Datamuse upstream word data') }];
}

/** Select one complete prefix against both final serialized surfaces, including enrichment. */
export function selectSearchPage(
  query: DatamuseQuery,
  upstream: WordResult[],
  tool: SearchToolName,
  emptyNotice: string,
  selected: Record<string, string> = {},
) {
  const offset = query.offset ?? 0;
  const limit = Math.min(1000, query.limit);
  const fetchedCap = Math.min(1000, offset + limit);
  const available = upstream.slice(offset, fetchedCap);
  const context = (count: number, oversized = false) => {
    const truncated = count < available.length;
    const next = offset + count;
    const base = searchContext(query, count, tool, emptyNotice, selected);
    const notices: string[] = [];
    if (count === 0 && offset > 0)
      notices.push(
        'No rows were returned at this offset. Re-run with offset=0 or refine constraints; a short page does not establish exhaustion.',
      );
    else if (count === 0 && base.notice) notices.push(base.notice);
    else if (upstream.length >= 1000)
      notices.push(
        'The API result ceiling of 1000 was reached; more matches may exist, but no continuation beyond index 999 is available. Refine constraints with datamuse_find_words.',
      );
    else if (count === limit && base.notice) notices.push(base.notice);
    if (query.requestedLimit !== undefined)
      notices.push('The requested limit was clamped to an effective limit of 1000.');
    if (truncated)
      notices.push('The 64,000-byte budget per serialized surface cut complete rows locally.');
    if (oversized)
      notices.push(
        'One oversized row is returned intact; the 64,000-byte budget is a soft bound for this row.',
      );
    const nextOffset =
      count > 0 && next < 1000 && (truncated || oversized || upstream.length >= fetchedCap)
        ? next
        : undefined;
    if (nextOffset !== undefined)
      notices.push(
        'Re-run with nextOffset as offset for best-effort navigation. Rankings may change; this is not a snapshot and a short page does not establish exhaustion.',
      );
    const { notice: _notice, ...rest } = base;
    return {
      ...rest,
      truncated,
      ...(nextOffset === undefined ? {} : { nextOffset }),
      ...(notices.length ? { notice: notices.join(' ') } : {}),
    };
  };
  const fits = (count: number) => {
    const domain = { words: available.slice(0, count) };
    const enrichment = context(count);
    const trailer = Object.entries(enrichment)
      .map(([key, value]) =>
        key === 'effectiveQuery'
          ? renderJson(value, 'Datamuse effective query')
          : `**${key}:** ${String(value)}`,
      )
      .join('\n');
    const content = [...searchContent(domain), { type: 'text', text: `\n\n${trailer}` }];
    return (
      Buffer.byteLength(JSON.stringify({ ...domain, ...enrichment })) <= 64000 &&
      Buffer.byteLength(JSON.stringify(content)) <= 64000
    );
  };
  let count = available.length;
  let oversized = false;
  if (count > 0 && !fits(count)) {
    // Partial prefixes include a longer disclosure than the uncut result.
    let low = 1;
    let high = count - 1;
    let best = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (fits(mid)) {
        best = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
    count = Math.max(1, best);
    oversized = best === 0;
  }
  return { result: { words: available.slice(0, count) }, enrichment: context(count, oversized) };
}
