---
name: datamuse-guide
description: Use datamuse_* tools to solve a word puzzle, find a rhyme under meaning or spelling constraints, or verify a shortlist. Recover from an empty search or partial lookup while preserving the user's requirements.
license: Apache-2.0
metadata:
  author: "cyanheads"
  version: "1.0"
---

## Scope

Use Datamuse for English rhyme and lexical discovery, English or Spanish meaning, sound, and spelling searches, and metadata for candidate spellings. It uses keyless access. For an authoritative definition or pronunciation, check a dictionary for the intended sense or dialect.

## Gates

- Separate required clues from preferences before searching. After an empty search, relax one preference at a time and keep the required clues. Present looser suggestions separately if the task allows them.
- Check the effective query and page notice before reporting that the search found no matches. A short page, a missing continuation, or a failed lookup cannot establish that the word or relation is absent from the language.
- Compare scores only within the response that returned them. If you need more candidates, use the supplied continuation with the same query and expect possible repeats or gaps.

## Core chain

Search for candidates, then use `datamuse_get_word_info` only on the shortlist when a definition, syllable count, or pronunciation matters. A matching query echo ties metadata to the submitted spelling, which can still have guessed or sense-dependent metadata. To consider a spelling suggestion, look it up separately as a new candidate. Use the metadata topic in `datamuse_list_reference` to interpret tags or missing values.

## Workflows

- **Constrained word or phrase.** In `datamuse_find_words`, combine required meaning, sound, spelling, or relation clues in the same query. For puzzle patterns, check the combinations topic in `datamuse_list_reference` before encoding the clue. Plain spelling text can produce similar spellings. For a word that precedes or follows another, check the relations topic and use the corresponding English relation. Context and topics can help rank candidates by fit. Read the resulting pair in context before treating it as suitable prose.
- **Rhyme for a line.** Start with the requested rhyme type in `datamuse_find_rhymes`. If the phrase returns no results and the rhyme is meant to land on its final word, rerun explicitly with that word and preserve the other required clues. Try near rhymes if the task allows them. If sound similarity alone is welcome, explore it with `datamuse_find_words` and label the results as sound-alikes. Check the intended stress or pronunciation before choosing a result for the line.
- **Partial shortlist lookup.** Preserve successful rows, even when another input fails. Resubmit the `unprocessed` inputs in groups of at most ten, keeping the original vocabulary and requested metadata. Map each new batch's zero-based indices to the original positions so repeated spellings stay distinct. Follow the individual recovery guidance for a failed input if you still need it.
