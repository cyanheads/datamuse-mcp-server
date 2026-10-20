<div align="center">
  <h1>@cyanheads/datamuse-mcp-server</h1>
  <p><b>Find rhymes, synonyms, sound-alikes, spelling matches, and word associations with Datamuse via MCP. STDIO or Streamable HTTP.</b>
  <div>4 Tools • 0 Resources • 0 Prompts</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.1.0-blue.svg?style=flat-square)](./package.json) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/datamuse-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.3.1-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/datamuse-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/datamuse-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.3-blueviolet.svg?style=flat-square)](https://bun.sh/)

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

Results are linguistic suggestions, with sense-dependent and sometimes guessed metadata. They do not establish dictionary completeness or poetic suitability.

## Capability reference

### `datamuse_find_rhymes` <sub>tool</sub>

- Required `word`; `rhyme_type` is `exact` (default) or `near`. Optional `means_like` and `spelled_like` constrain the same search.
- English only. Exact searches never silently fall back to near rhymes.

---

### `datamuse_find_synonyms` <sub>tool</sub>

- Required `word`; `relation` is `synonyms` (default), `antonyms`, `broader`, or `narrower`.
- English only. `broader` returns direct hypernyms; `narrower` returns direct hyponyms. Statistical associations are available through `datamuse_find_words`.

---

### `datamuse_find_words` <sub>tool</sub>

- Supply at least one of `means_like`, `sounds_like`, `spelled_like`, or `relations: [{ relation, word }]`. Constraints form a conjunction; repeated relations are preserved, up to 14 entries.
- Relations: `exact_rhyme`, `near_rhyme`, `synonyms`, `antonyms`, `broader`, `narrower`, `parts`, `wholes`, `nouns_modified_by`, `adjectives_describing`, `followers`, `predecessors`, `associated`, `homophones`, `consonant_match`. Call `datamuse_list_reference` for their directions.
- Spelling supports upstream `*` and `?` patterns. `left_context`, `right_context`, and up to five nonblank `topics` affect ordering; each must be a single word without commas. These hints alone cannot start a search.
- `vocabulary` is `en` (default) or `es`. Spanish supports meaning, sound, and spelling; relations require English.

---

### `datamuse_list_reference` <sub>tool</sub>

- `topic` is `all` (default), `relations`, `metadata`, `combinations`, or `limitations`.
- Returns complete static `sections` without a network request.

### Search results

All three search tools accept `limit` from 1–1000 (default 20) and `include_definitions` (default false). They return `words` in upstream order, plus `effectiveQuery`, `returnedCount`, `limitReached`, and any empty-result or cap `notice`.

Each row has `word` and any available `score`, `numSyllables`, `tags`, `defs`, `defHeadword`, and additional upstream JSON properties. Missing metadata stays absent. Tags and definitions remain raw, including unknown tags, tabs, and whitespace. `f:` tags express frequency per million words; scores rank results within one query and cannot be compared across queries.

Empty lists succeed. Reaching a limit means more matches may exist; there is no pagination, total-match count, or continuation token. A short list does not establish exhaustion. Every returned field is preserved in structured output and fenced JSON text.

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

Datamuse-specific:

- Live queries to Datamuse's fixed HTTPS word endpoint, without a local mirror or persistent query store.
- A shared process-local budget of one request per second and one in-flight request, with a bounded queue and retries. This conservative pacing does not guarantee a daily quota across processes or other users of the same egress address.
- Parts of speech, syllables, frequency tags, and optional definitions, preserving sparse responses and upstream ranking.

Agent-friendly output:

- Effective query and resolved defaults on every successful search, with actionable empty-result and cap guidance.
- Typed failures distinguish access, rate limits, malformed data, and upstream request errors. Upstream text is returned as data inside JSON fences.

### Access, privacy, and attribution

Datamuse currently documents keyless access up to **100,000 requests per day** and asks customer-facing applications to contact the provider. Its announced manually issued API-key transition has conflicting dates: the banner says **February 1, 2027**, while the usage section ends keyless access on **January 1, 2027**. Recheck the [Datamuse documentation](https://www.datamuse.com/api/) before either date. This server uses the current keyless API; no future credential format is documented or implemented, and the transition may interrupt access.

Queries leave this server and are sent to Datamuse, which says it temporarily logs them until the end of the following day. Server-level payload logging and telemetry are optional; review their settings before sending sensitive text.

Word results and lexical metadata are provided by [Datamuse](https://www.datamuse.com/api/). See its documentation for contributing data sources and attribution requirements. The Apache-2.0 license covers this server's code; it does not grant additional rights to upstream data.

## Getting started

### Self-Hosted / Local

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
- No Datamuse credentials currently required; see the access transition above.

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
| `src/mcp-server/tools/definitions` | Four tool definitions and shared search enrichment. |
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
