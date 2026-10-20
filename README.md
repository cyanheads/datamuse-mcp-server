<div align="center">
  <h1>@cyanheads/datamuse-mcp-server</h1>
  <p><b>Find rhymes, synonyms, sound-alikes, spelling matches, and word associations with Datamuse via MCP. STDIO or Streamable HTTP.</b>
  <div>5 Tools</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.2.0-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/datamuse-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.3.1-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/datamuse-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/datamuse-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.3-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/datamuse-mcp-server/releases/latest/download/datamuse-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=datamuse-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvZGF0YW11c2UtbWNwLXNlcnZlciJdfQ==) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22datamuse-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fdatamuse-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

---

## Overview

Word finding for writing, editing, puzzles, and naming, powered by the [Datamuse API](https://www.datamuse.com/api/). Find a rhyme with a particular meaning, explore lexical alternatives, or combine meaning, sound, spelling, and relation constraints.

### Tools

| Tool | Description |
|:---|:---|
| `datamuse_find_rhymes` | Find exact or near rhymes, optionally constrained by meaning and spelling |
| `datamuse_find_synonyms` | Find synonyms, antonyms, broader categories, or narrower kinds |
| `datamuse_find_words` | Combine meaning, sound, spelling, and named lexical relations, with context and topic hints |
| `datamuse_list_reference` | Read offline guidance on relations, metadata, combinations, and service limitations |
| `datamuse_get_word_info` | Look up raw metadata for supplied spellings, with indexed partial outcomes |

## Capability reference

### `datamuse_find_rhymes` <sub>tool</sub>

- Required `word`; `rhyme_type` is `exact` (default) or `near`, never blended; optional `means_like` and `spelled_like` narrow the same search. English only
- Shared search controls: `limit` (default 20), `offset` (default 0), `include_definitions`, `include_pronunciation`, and `include_ipa` (metadata options default `false`). Rows carry whatever metadata Datamuse supplies

---

### `datamuse_find_synonyms` <sub>tool</sub>

- Required `word`; `relation` is `synonyms` (default), `antonyms`, `broader` (direct hypernyms), or `narrower` (direct hyponyms). English only
- Same shared search controls as rhymes; statistical associations are the `associated` relation of `datamuse_find_words`

---

### `datamuse_find_words` <sub>tool</sub>

- At least one of `means_like`, `sounds_like`, `spelled_like` (upstream spelling patterns), or up to 14 `relations: [{ relation, word }]`, all conjoined; repeated relations are kept. `left_context`, `right_context`, and up to five `topics`, each a single word, affect ordering only
- Relations: `exact_rhyme`, `near_rhyme`, `synonyms`, `antonyms`, `broader`, `narrower`, `parts`, `wholes`, `nouns_modified_by`, `adjectives_describing`, `followers`, `predecessors`, `associated`, `homophones`, `consonant_match`; `datamuse_list_reference` gives their directions
- `vocabulary` is `en` (default) or `es`; Spanish takes meaning, sound, and spelling constraints, not relations. Rejections are typed: `missing_constraint`, `unsupported_vocabulary_relation`, `invalid_context_hint`

Spelling patterns are interpreted by Datamuse using supported [OneLook syntax](https://onelook.com/thesaurus/#patterns):

| Pattern | Meaning |
|:--|:--|
| `*`, `?` | Any length, or one character |
| `//listen` | Anagrams, including phrases such as `lets in` |
| `c@t`, `s#@p` | `@` matches one English vowel including y; `#` one consonant |
| `*+abc` | Restrict letters to a, b, c; repetitions and spaces can occur |
| `b????-e` | Five-character pattern excluding e |
| `hipopatamus` | Similar spellings without wildcard syntax |

For anagrams, call `datamuse_find_words` with `{"spelled_like":"//listen"}`. `+letters` restricts allowed letters and `-letters` excludes them; neither requires every listed letter.

---

### `datamuse_get_word_info` <sub>tool</sub>

Supply 1–100 nonblank `words`, each at most 200 characters. The first ten are processed sequentially through the shared request budget; later entries return `processing_cap`. One 20-second deadline includes all requests, retries and pacing. Completed results survive item failures; pending entries return `deadline_exceeded`. Caller cancellation stops the call.

The same `include_definitions`, `include_pronunciation`, and `include_ipa` options apply. Each indexed outcome contains trimmed caller `input` and either a complete raw `row`, a failure reason with recovery, or an unprocessed reason. Only a `query`-tagged echo matching the supplied spelling under Unicode lowercase is accepted: `Ice Cream` can return raw `row.word='ice cream'`, while corrections are never substituted. Missing metadata stays absent, and duplicates keep their indices. Lookup output is complete on both MCP surfaces and has no search byte slicing.

### `datamuse_list_reference` <sub>tool</sub>

- `topic` is `all` (default), `relations`, `metadata`, `combinations`, or `limitations`
- Returns static `sections: [{ topic, text }]` without a network request

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

Datamuse-specific:

- Live queries to Datamuse's fixed HTTPS `/words` endpoint, with no local mirror or stored queries
- One request budget shared by every tool and tenant: one start per second, one request in flight, a bounded queue, and one retry. It is process-local, so it does not account for other processes or other users of the same egress address
- Results are corpus-derived suggestions with sense-dependent, sometimes guessed metadata (parts of speech, syllables, `f:` frequency per million words). They do not establish dictionary completeness or poetic suitability

Agent-friendly output:

- Effective-query echo and honest caps: every search returns `effectiveQuery`, `returnedCount`, `limitReached`, and `truncated`, plus relevant notices and `nextOffset`. Positive safe-integer limits above 1000 are clamped with `requestedLimit` and effective `limit` echoed. Invalid integers reject before I/O
- Whole-row navigation: `offset` accepts 0–999. Searches fetch `max=min(1000, offset+limit)` and select complete rows under 64,000 bytes per serialized MCP surface, including escaping and enrichment. A local byte cut sets `truncated=true`; re-run with `offset=nextOffset` when supplied. One oversized row is returned intact with a soft-budget notice and offset progress. API-cap notices are separate from byte cuts. Rankings can change between calls, so offsets are best-effort navigation with possible duplicates or gaps, never snapshots, stable pagination, totals, or proof of exhaustion. No continuation beyond index 999
- Phrase relation recovery: phrase targets stay accepted and unchanged. When a relation query returns empty, guidance explains limited phrase coverage and suggests `means_like` or `sounds_like`; rhyme guidance also suggests explicitly trying the final word
- Optional pronunciation: `include_pronunciation` appends `r` to `md`; `include_ipa` implies pronunciation and adds `ipa=1`. Raw `pron:` and `ipa_pron:` tags may both occur. ARPAbet stress digits mean 0 unstressed, 1 primary, 2 secondary; pronunciations may be guessed, sense-dependent, or absent
- Lossless rows: `word` plus whatever `score`, `numSyllables`, `tags`, `defs`, `defHeadword`, and other fields Datamuse sent, unchanged and in upstream order, identical in `structuredContent` and the fenced JSON text. `score` ranks results within one query only
- Typed failures: declared reasons for access errors, rate limits (`upstream_rate_limited` and `pacer_shed`, with `retryAfter`), malformed upstream data, and invalid input, each with a recovery hint

### Access, privacy, and attribution

Datamuse currently documents keyless access up to **100,000 requests per day** and asks customer-facing applications to contact it. It has announced manually issued API keys for early 2027, with conflicting dates: **January 1** in its usage section and **February 1** in its banner. No key format is documented yet, so this server uses the keyless API, and access may be interrupted at the switch.

Queries are sent to Datamuse, which keeps a temporary log of them until the end of the following day. Server payload logging and telemetry are optional; review their settings before sending sensitive text.

Word results and lexical metadata come from [Datamuse](https://www.datamuse.com/api/); see its documentation for data sources and attribution requirements. The Apache-2.0 license covers this server's code, not the upstream data.

## Getting started

Add the following to your MCP client configuration file.

```json
{
  "mcpServers": {
    "datamuse-mcp-server": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/datamuse-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "datamuse-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/datamuse-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with Docker:

```json
{
  "mcpServers": {
    "datamuse-mcp-server": {
      "type": "stdio",
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "MCP_TRANSPORT_TYPE=stdio", "ghcr.io/cyanheads/datamuse-mcp-server:latest"]
    }
  }
}
```

For Streamable HTTP, set the transport and start the server:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Prerequisites

- [Bun v1.4.0](https://bun.sh/) or higher (or Node.js v24+).
- No Datamuse credentials are currently required; see [Access, privacy, and attribution](#access-privacy-and-attribution) for the announced key transition.

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/datamuse-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd datamuse-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

4. **Configure environment:**

```sh
cp .env.example .env
# edit .env for transport, authentication, logging, or telemetry overrides
```

## Configuration

| Variable | Description | Default |
|:---|:---|:---|
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_HOST` | HTTP bind address. | `127.0.0.1` |
| `MCP_HTTP_PORT` | HTTP server port. | `3010` |
| `MCP_SESSION_MODE` | HTTP session mode: `stateless`, `stateful`, or `auto`. | `stateless` |
| `MCP_AUTH_MODE` | Authentication: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (`debug`, `info`, `warning`, `error`, etc.). | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<app-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1`. | `in-memory` |
| `OTEL_ENABLED` | Enable [OpenTelemetry](https://github.com/cyanheads/mcp-ts-core/tree/main/docs/telemetry). | `false` |

See [`.env.example`](./.env.example) for every server setting and the common framework overrides.

## Running the server

### Local development

- **Build and run the production version**:

  ```sh
  # One-time build
  bun run rebuild

  # Run the built server
  bun run start:http
  # or
  bun run start:stdio
  ```

- **Run checks and tests**:
  ```sh
  bun run devcheck  # Lints, formats, type-checks, and more
  bun run test      # Runs the test suite
  ```

## Project structure

| Directory | Purpose |
|:---|:---|
| `src/mcp-server/tools/definitions` | Five tool definitions and shared search enrichment. |
| `src/services/datamuse` | Fixed-endpoint client, shared pacing, upstream schemas, and JSON rendering. |
| `tests/` | Service, tool, and serialization tests. |
| `docs/` | Surface design and generated directory tree. |

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for logging, `ctx.state` for storage
- Register new tools and resources in the `createApp()` arrays in `src/index.ts`
- Wrap external API calls: validate raw → normalize to domain type → return output schema; never fabricate missing fields

## Contributing

Issues are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

This project is licensed under the Apache 2.0 License. See the [LICENSE](./LICENSE) file for details.
