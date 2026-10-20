/**
 * @fileoverview Find exact or near English rhymes, optionally constrained by meaning and spelling.
 * @module mcp-server/tools/definitions/find-rhymes.tool
 */
import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getDatamuseService } from '../../../services/datamuse/datamuse-service.js';
import {
  type DatamuseQuery,
  meansLikeSchema,
  searchInputFields,
  searchOutputSchema,
  spelledLikeSchema,
  wordSchema,
} from '../../../services/datamuse/types.js';
import {
  optionalText,
  searchContent,
  searchControls,
  searchEnrichment,
  searchEnrichmentTrailer,
  selectSearchPage,
} from './search-support.js';

/** Find exact or near English rhymes, optionally constrained by meaning and spelling. */
export const findRhymesTool = tool('datamuse_find_rhymes', {
  description:
    'Find exact or near English rhymes, optionally constrained by meaning and spelling. Exact and near describe Datamuse relations, not poetic suitability. Empty results succeed. Whole-row byte budgets and best-effort offsets preserve upstream order; rankings may change between calls.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z
    .object({
      ...searchInputFields,
      word: wordSchema,
      rhyme_type: z
        .enum(['exact', 'near'])
        .default('exact')
        .describe('Exact rhyme or near rhyme; no automatic fallback.'),
      means_like: meansLikeSchema,
      spelled_like: spelledLikeSchema,
    })
    .strict(),
  output: searchOutputSchema,
  enrichment: searchEnrichment,
  enrichmentTrailer: searchEnrichmentTrailer,
  errors: [
    {
      reason: 'upstream_rejected',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'HTTP 400',
      recovery:
        "Call datamuse_list_reference with topic='combinations', then re-run datamuse_find_rhymes with supported constraints; if the same supported query fails, report the request ID.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_validation',
      code: JsonRpcErrorCode.ValidationError,
      when: 'HTTP 422',
      recovery:
        "Call datamuse_list_reference with topic='combinations', then re-run datamuse_find_rhymes with supported constraints; if the same supported query fails, report the request ID.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_unauthorized',
      code: JsonRpcErrorCode.Unauthorized,
      when: 'HTTP 401',
      recovery:
        "Call datamuse_list_reference with topic='limitations' for the access transition; retry datamuse_find_rhymes only after the operator confirms Datamuse access is available.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_forbidden',
      code: JsonRpcErrorCode.Forbidden,
      when: 'HTTP 403',
      recovery:
        "Call datamuse_list_reference with topic='limitations' for the access transition; retry datamuse_find_rhymes only after the operator confirms Datamuse access is available.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'HTTP 404 on the fixed endpoint',
      recovery:
        "Call datamuse_list_reference with topic='limitations' and report the request ID; retry datamuse_find_rhymes after the service endpoint is restored.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_conflict',
      code: JsonRpcErrorCode.Conflict,
      when: 'HTTP 409',
      recovery:
        "Call datamuse_list_reference with topic='limitations' and report the request ID; retry datamuse_find_rhymes after the upstream conflict is resolved.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_rate_limited',
      code: JsonRpcErrorCode.RateLimited,
      when: 'HTTP 429',
      recovery:
        "Wait for retryAfter when supplied, then re-run datamuse_find_rhymes; call datamuse_list_reference with topic='limitations' for quota guidance.",
      retryable: true,
      thrownBy: 'service',
    },
    {
      reason: 'pacer_shed',
      code: JsonRpcErrorCode.RateLimited,
      when: 'Shared queue full or wait budget exhausted',
      recovery:
        "Wait for retryAfter, then re-run datamuse_find_rhymes; use datamuse_list_reference with topic='limitations' for the shared request budget.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'invalid_upstream_response',
      code: JsonRpcErrorCode.SerializationError,
      when: 'Invalid JSON or malformed response shape',
      recovery:
        "Retry datamuse_find_rhymes once later; if the same failure persists, report the request ID and use datamuse_list_reference with topic='limitations'.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_unexpected_status',
      code: JsonRpcErrorCode.InvalidRequest,
      when: 'Unexpected redirect or other non-success status',
      recovery:
        "Call datamuse_list_reference with topic='limitations' and report the request ID; retry datamuse_find_rhymes after the upstream request failure is resolved.",
      retryable: false,
      thrownBy: 'service',
    },
  ],
  async handler(input, ctx) {
    const means_like = optionalText(input.means_like);
    const spelled_like = optionalText(input.spelled_like);
    const query: DatamuseQuery = {
      ...searchControls(input),
      vocabulary: 'en',
      ...(means_like ? { means_like } : {}),
      ...(spelled_like ? { spelled_like } : {}),
      relations: [
        {
          relation: input.rhyme_type === 'exact' ? 'exact_rhyme' : 'near_rhyme',
          word: input.word.trim(),
        },
      ],
    };
    const emptyNotice = [
      'No rhymes matched the effective query.',
      ...(input.rhyme_type === 'exact'
        ? ["Re-run datamuse_find_rhymes with rhyme_type='near'."]
        : []),
      ...(query.means_like || query.spelled_like
        ? ['Re-run datamuse_find_rhymes with fewer means_like or spelled_like constraints.']
        : []),
      "Call datamuse_list_reference with topic='combinations' for alternatives; datamuse_find_words with sounds_like set to the target explores similar sounds without requiring rhyme.",
    ].join(' ');
    const result = await getDatamuseService().search(query, ctx, 'datamuse_find_rhymes');
    const page = selectSearchPage(query, result.words, 'datamuse_find_rhymes', emptyNotice, {
      word: input.word.trim(),
      rhyme_type: input.rhyme_type,
    });
    ctx.enrich(page.enrichment);
    return page.result;
  },
  format: searchContent,
});
