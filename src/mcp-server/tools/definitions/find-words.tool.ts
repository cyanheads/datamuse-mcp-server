/**
 * @fileoverview Find words by combined meaning, sound, spelling, and named lexical relations.
 * @module mcp-server/tools/definitions/find-words.tool
 */
import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getDatamuseService } from '../../../services/datamuse/datamuse-service.js';
import {
  type DatamuseQuery,
  meansLikeSchema,
  relationSchema,
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

/** Find words by combined meaning, sound, spelling, and named lexical relations. */
export const findWordsTool = tool('datamuse_find_words', {
  description:
    'Find words by combined meaning, sound, spelling, and named lexical relations. Supply at least one hard constraint; relations form a conjunction, including repeated entries. Context and topics only affect ordering and require single words. Spanish supports meaning, sound, and spelling; relations require English. Empty results succeed; byte budgets select whole rows and offsets re-run the query without stable rankings or totals.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z
    .object({
      ...searchInputFields,
      means_like: meansLikeSchema,
      spelled_like: spelledLikeSchema,
      sounds_like: z
        .string()
        .max(200)
        .optional()
        .describe(
          'Sound similarity, at most 200 characters; pronunciation may be guessed; blank means unset.',
        ),
      relations: z
        .array(
          z
            .object({
              relation: relationSchema.describe(
                'Named relation; use datamuse_list_reference topic=relations for direction.',
              ),
              word: wordSchema,
            })
            .strict()
            .describe('One relation constraint, conjoined with every other constraint.'),
        )
        .max(14)
        .optional()
        .describe('At most 14 relation entries; repeats preserved; empty means unset.'),
      topics: z
        .array(z.string().max(200).describe('Single topic word; blank entries are omitted.'))
        .refine(
          (entries) => entries.filter((entry) => entry.trim()).length <= 5,
          'Supply at most five nonblank topic words.',
        )
        .optional()
        .describe('At most five nonblank single-word topic biases, without whitespace or commas.'),
      left_context: z
        .string()
        .max(200)
        .optional()
        .describe(
          'Single word preceding a result as an ordering hint, not an adjacency filter; blank means unset.',
        ),
      right_context: z
        .string()
        .max(200)
        .optional()
        .describe(
          'Single word following a result as an ordering hint, not an adjacency filter; blank means unset.',
        ),
      vocabulary: z
        .enum(['en', 'es'])
        .default('en')
        .describe('English or Spanish; all relations require English.'),
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
        "Call datamuse_list_reference with topic='combinations', then re-run datamuse_find_words with supported constraints; if the same supported query fails, report the request ID.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_validation',
      code: JsonRpcErrorCode.ValidationError,
      when: 'HTTP 422',
      recovery:
        "Call datamuse_list_reference with topic='combinations', then re-run datamuse_find_words with supported constraints; if the same supported query fails, report the request ID.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_unauthorized',
      code: JsonRpcErrorCode.Unauthorized,
      when: 'HTTP 401',
      recovery:
        "Call datamuse_list_reference with topic='limitations' for the access transition; retry datamuse_find_words only after the operator confirms Datamuse access is available.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_forbidden',
      code: JsonRpcErrorCode.Forbidden,
      when: 'HTTP 403',
      recovery:
        "Call datamuse_list_reference with topic='limitations' for the access transition; retry datamuse_find_words only after the operator confirms Datamuse access is available.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'HTTP 404 on the fixed endpoint',
      recovery:
        "Call datamuse_list_reference with topic='limitations' and report the request ID; retry datamuse_find_words after the service endpoint is restored.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_conflict',
      code: JsonRpcErrorCode.Conflict,
      when: 'HTTP 409',
      recovery:
        "Call datamuse_list_reference with topic='limitations' and report the request ID; retry datamuse_find_words after the upstream conflict is resolved.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_rate_limited',
      code: JsonRpcErrorCode.RateLimited,
      when: 'HTTP 429',
      recovery:
        "Wait for retryAfter when supplied, then re-run datamuse_find_words; call datamuse_list_reference with topic='limitations' for quota guidance.",
      retryable: true,
      thrownBy: 'service',
    },
    {
      reason: 'pacer_shed',
      code: JsonRpcErrorCode.RateLimited,
      when: 'Shared queue full or wait budget exhausted',
      recovery:
        "Wait for retryAfter, then re-run datamuse_find_words; use datamuse_list_reference with topic='limitations' for the shared request budget.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'invalid_upstream_response',
      code: JsonRpcErrorCode.SerializationError,
      when: 'Invalid JSON or malformed response shape',
      recovery:
        "Retry datamuse_find_words once later; if the same failure persists, report the request ID and use datamuse_list_reference with topic='limitations'.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'upstream_unexpected_status',
      code: JsonRpcErrorCode.InvalidRequest,
      when: 'Unexpected redirect or other non-success status',
      recovery:
        "Call datamuse_list_reference with topic='limitations' and report the request ID; retry datamuse_find_words after the upstream request failure is resolved.",
      retryable: false,
      thrownBy: 'service',
    },
    {
      reason: 'missing_constraint',
      code: JsonRpcErrorCode.ValidationError,
      when: 'No nonblank hard constraint.',
      recovery:
        "Call datamuse_list_reference with topic='combinations', then re-run datamuse_find_words with means_like, sounds_like, spelled_like, or a relation.",
    },
    {
      reason: 'unsupported_vocabulary_relation',
      code: JsonRpcErrorCode.ValidationError,
      when: 'Spanish vocabulary with relations.',
      recovery:
        "Re-run datamuse_find_words with vocabulary='en' for relations, or vocabulary='es' using meaning, sound, and spelling constraints only.",
    },
    {
      reason: 'invalid_context_hint',
      code: JsonRpcErrorCode.ValidationError,
      when: 'A context hint or topic is not a single word.',
      recovery:
        "Call datamuse_list_reference with topic='combinations', then re-run datamuse_find_words with single-word context hints and topic entries.",
    },
  ],
  async handler(input, ctx) {
    const topics = input.topics?.map((entry) => entry.trim()).filter(Boolean) ?? [];
    const means_like = optionalText(input.means_like);
    const sounds_like = optionalText(input.sounds_like);
    const spelled_like = optionalText(input.spelled_like);
    const left_context = optionalText(input.left_context);
    const right_context = optionalText(input.right_context);
    const query: DatamuseQuery = {
      ...searchControls(input),
      vocabulary: input.vocabulary,
      ...(means_like ? { means_like } : {}),
      ...(sounds_like ? { sounds_like } : {}),
      ...(spelled_like ? { spelled_like } : {}),
      ...(left_context ? { left_context } : {}),
      ...(right_context ? { right_context } : {}),
      ...(topics.length ? { topics } : {}),
      ...(input.relations?.length
        ? { relations: input.relations.map((entry) => ({ ...entry, word: entry.word.trim() })) }
        : {}),
    };
    if (
      [query.left_context, query.right_context, ...topics].some(
        (value) => value !== undefined && /[\s,]/u.test(value),
      )
    )
      throw ctx.fail('invalid_context_hint');
    if (!query.means_like && !query.sounds_like && !query.spelled_like && !query.relations?.length)
      throw ctx.fail('missing_constraint');
    if (query.vocabulary === 'es' && query.relations?.length)
      throw ctx.fail('unsupported_vocabulary_relation');
    const result = await getDatamuseService().search(query, ctx, 'datamuse_find_words');
    const page = selectSearchPage(
      query,
      result.words,
      'datamuse_find_words',
      "No words matched the effective query. Re-run datamuse_find_words with fewer hard constraints or a broader spelled_like pattern; datamuse_list_reference with topic='combinations' explains alternatives.",
    );
    ctx.enrich(page.enrichment);
    return page.result;
  },
  format: searchContent,
});
