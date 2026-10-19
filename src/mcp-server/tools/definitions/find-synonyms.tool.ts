/**
 * @fileoverview Find English synonyms, antonyms, broader categories, or narrower kinds of a word.
 * @module mcp-server/tools/definitions/find-synonyms.tool
 */
import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getDatamuseService } from '../../../services/datamuse/datamuse-service.js';
import { renderJson } from '../../../services/datamuse/serialization.js';
import {
  type DatamuseQuery,
  searchInputFields,
  searchOutputSchema,
  wordSchema,
} from '../../../services/datamuse/types.js';
import { searchContext, searchEnrichment, searchEnrichmentTrailer } from './search-support.js';

/** Find English synonyms, antonyms, broader categories, or narrower kinds of a word. */
export const findSynonymsTool = tool('datamuse_find_synonyms', {
  description:
    'Find English synonyms, antonyms, broader categories, or narrower kinds of a word. Broader returns direct hypernyms and narrower returns direct hyponyms. Preserve Datamuse ranking; frequency metadata does not determine ordering. Empty results succeed; limits have no continuation.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z
    .object({
      ...searchInputFields,
      word: wordSchema,
      relation: z
        .enum(['synonyms', 'antonyms', 'broader', 'narrower'])
        .default('synonyms')
        .describe('Lexical relation; broader returns hypernyms and narrower returns hyponyms.'),
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
        "Call datamuse_list_reference with topic='combinations', then re-run datamuse_find_synonyms with supported constraints; if the same supported query fails, report the request ID.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_validation',
      code: JsonRpcErrorCode.ValidationError,
      when: 'HTTP 422',
      recovery:
        "Call datamuse_list_reference with topic='combinations', then re-run datamuse_find_synonyms with supported constraints; if the same supported query fails, report the request ID.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_unauthorized',
      code: JsonRpcErrorCode.Unauthorized,
      when: 'HTTP 401',
      recovery:
        "Call datamuse_list_reference with topic='limitations' for the access transition; retry datamuse_find_synonyms only after the operator confirms Datamuse access is available.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_forbidden',
      code: JsonRpcErrorCode.Forbidden,
      when: 'HTTP 403',
      recovery:
        "Call datamuse_list_reference with topic='limitations' for the access transition; retry datamuse_find_synonyms only after the operator confirms Datamuse access is available.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'HTTP 404 on the fixed endpoint',
      recovery:
        "Call datamuse_list_reference with topic='limitations' and report the request ID; retry datamuse_find_synonyms after the service endpoint is restored.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_conflict',
      code: JsonRpcErrorCode.Conflict,
      when: 'HTTP 409',
      recovery:
        "Call datamuse_list_reference with topic='limitations' and report the request ID; retry datamuse_find_synonyms after the upstream conflict is resolved.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_rate_limited',
      code: JsonRpcErrorCode.RateLimited,
      when: 'HTTP 429',
      recovery:
        "Wait for retryAfter when supplied, then re-run datamuse_find_synonyms; call datamuse_list_reference with topic='limitations' for quota guidance.",
      retryable: true,
      thrownBy: 'service',
    },
    {
      reason: 'pacer_shed',
      code: JsonRpcErrorCode.RateLimited,
      when: 'Shared queue full or wait budget exhausted',
      recovery:
        "Wait for retryAfter, then re-run datamuse_find_synonyms; use datamuse_list_reference with topic='limitations' for the shared request budget.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'invalid_upstream_response',
      code: JsonRpcErrorCode.SerializationError,
      when: 'Invalid JSON or malformed response shape',
      recovery:
        "Retry datamuse_find_synonyms once later; if the same failure persists, report the request ID and use datamuse_list_reference with topic='limitations'.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_unexpected_status',
      code: JsonRpcErrorCode.InvalidRequest,
      when: 'Unexpected redirect or other non-success status',
      recovery:
        "Call datamuse_list_reference with topic='limitations' and report the request ID; retry datamuse_find_synonyms after the upstream request failure is resolved.",
      retryable: false,
      thrownBy: 'service',
    },
  ],
  async handler(input, ctx) {
    const query: DatamuseQuery = {
      limit: input.limit,
      include_definitions: input.include_definitions,
      vocabulary: 'en',
      relations: [{ relation: input.relation, word: input.word.trim() }],
    };
    const result = await getDatamuseService().search(query, ctx, 'datamuse_find_synonyms');
    ctx.enrich(
      searchContext(
        query,
        result.words.length,
        'datamuse_find_synonyms',
        "No lexical alternatives matched the effective query. Try datamuse_find_words with means_like set to the same word for looser related meanings, or datamuse_list_reference with topic='relations'.",
        { word: input.word.trim(), relation: input.relation },
      ),
    );
    return result;
  },
  format: (result) => [{ type: 'text', text: renderJson(result, 'Datamuse upstream word data') }],
});
