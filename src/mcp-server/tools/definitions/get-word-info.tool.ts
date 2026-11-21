/**
 * @fileoverview Metadata lookup for supplied spellings using Datamuse query echo.
 * @module mcp-server/tools/definitions/get-word-info.tool
 */
import { tool, z } from '@cyanheads/mcp-ts-core';
import { getDatamuseService } from '../../../services/datamuse/datamuse-service.js';
import { renderJson } from '../../../services/datamuse/serialization.js';
import {
  searchInputFields,
  vocabularySchema,
  wordResultSchema,
  wordSchema,
} from '../../../services/datamuse/types.js';

/** Retrieve raw metadata for supplied words without substituting spelling corrections. */
export const getWordInfoTool = tool('datamuse_get_word_info', {
  description:
    'Look up syllables, frequency, optional definitions and pronunciation for supplied English or Spanish words or phrases. Accepts 1–100 inputs and processes the first ten sequentially within one 20-second deadline. Returns indexed outcomes for every input. The query tag marks the supplied form, which can have guessed metadata. spellcor: tags suggest other spellings that can name unrelated words. f:0.000000 can reflect limited corpus coverage. See datamuse_list_reference topic=metadata.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z
    .object({
      words: z
        .array(wordSchema)
        .min(1)
        .max(100)
        .describe(
          'Words or phrases in caller order; first ten are processed and the rest explicitly unprocessed.',
        ),
      include_definitions: searchInputFields.include_definitions,
      include_pronunciation: searchInputFields.include_pronunciation,
      include_ipa: searchInputFields.include_ipa,
      vocabulary: vocabularySchema.default('en').describe('Vocabulary for the whole lookup batch.'),
    })
    .strict(),
  output: z.object({
    vocabulary: vocabularySchema.describe('Resolved vocabulary for the lookup batch.'),
    outcomes: z
      .array(
        z
          .discriminatedUnion('status', [
            z
              .object({
                index: z.number().int().describe('Zero-based input index.'),
                input: z.string().describe('Trimmed caller spelling.'),
                status: z.literal('success').describe('A matching query echo was returned.'),
                row: wordResultSchema.describe(
                  'Complete raw query-echo row with upstream spelling preserved.',
                ),
              })
              .describe('Successful query-echo lookup.'),
            z
              .object({
                index: z.number().int().describe('Zero-based input index.'),
                input: z.string().describe('Trimmed caller spelling.'),
                status: z
                  .literal('failure')
                  .describe('This input failed; other inputs may succeed.'),
                reason: z
                  .string()
                  .describe(
                    'missing_query_echo, invalid_upstream_response, an upstream or pacer reason, or upstream_failure.',
                  ),
                recovery: z.string().describe('Action to recover this input.'),
              })
              .describe('Failed lookup with a recovery action.'),
            z
              .object({
                index: z.number().int().describe('Zero-based input index.'),
                input: z.string().describe('Trimmed caller spelling.'),
                status: z.literal('unprocessed').describe('This input did not complete.'),
                reason: z
                  .enum(['processing_cap', 'deadline_exceeded'])
                  .describe('Ten-input processing cap or whole-call deadline.'),
                recovery: z.string().describe('Action to retrieve this input.'),
              })
              .describe('Input left unprocessed by a bound.'),
          ])
          .describe('Indexed outcome for one input.'),
      )
      .describe(
        'One complete indexed outcome per supplied input; no rows or values are truncated.',
      ),
  }),
  async handler(input, ctx) {
    const { words, ...options } = input;
    const result = await getDatamuseService().lookup(words, options, ctx);
    return { vocabulary: options.vocabulary, ...result };
  },
  format: (result) => [{ type: 'text', text: renderJson(result, 'Datamuse word information') }],
});
