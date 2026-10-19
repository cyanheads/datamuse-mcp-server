/**
 * @fileoverview Lossless JSON rendering for untrusted Datamuse values.
 * @module services/datamuse/serialization
 */

/** Fence complete JSON without allowing strings to close the fence or introduce HTML. */
export function renderJson(value: unknown, label = 'Datamuse data'): string {
  const encoded = JSON.stringify(value, null, 2)
    .replaceAll('`', '\\u0060')
    .replaceAll('<', '\\u003c');
  return `${label}\n\n\`\`\`json\n${encoded}\n\`\`\``;
}
