# openfoodtox

EFSA's derived toxicological reference values for chemicals in food and feed —
acceptable daily intakes, acute reference doses, tolerable intakes and operator
exposure levels — with the assessment body and critical endpoint behind each one.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1856+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

**3,437 substances, 8,620 reference values.**

## Source

OpenFoodTox 3.0, Zenodo record [19388272](https://zenodo.org/records/19388272)
(DOI `10.5281/zenodo.19388272`), published 2026-04-30, CC-BY-4.0.

Extracted from EFSA's official `.xlsx` export — nothing is scraped. The data
ships inside the pack rather than being fetched per call, so answers do not
depend on Zenodo being reachable. Every response carries the DOI, publication
date and licence.

## Tools

**1. Hazard profile.** "What is the ADI for glyphosate?" →
`openfoodtox_hazard_profile({substance: "glyphosate"})` → every reference value
EFSA has derived, each with its unit, assessment body and critical endpoint.

**2. Find the substance.** "Which aflatoxins has EFSA assessed?" →
`openfoodtox_search({query: "aflatoxin"})` → matching substances and how many
reference values each carries.

## Two things that shape the output

**One substance can have several legitimate values.** Cadmium carries a tolerable
weekly intake of 2.5 µg/kg bw from EFSA and 7 from the older JECFA assessment.
Both are real. The pack lists them with their assessment bodies rather than
reconciling them — picking one would invent a consensus that does not exist.

**Absence is not zero.** A substance with no derived reference value returns
`found:false` with an explicit statement that this is not a finding of safety.
An empty list here would read as "no limit applies" to a chemical in food.

## Refreshing

Re-run the extractor against a newer Zenodo record and re-run the tests. The
tests assert specific published values (glyphosate ADI 0.5 mg/kg bw/day,
aspartame 40, cadmium TWI 2.5) precisely so a refresh that breaks the join fails
loudly instead of quietly changing numbers.

Column layout worth knowing if you touch the extractor: reference-value columns
are IUCLID dotted paths with a nested element between the metric and the field
(`HumanHealthHazardCharacteristics.AcceptableDailyIntake.Adi.lowerValue`), and
that element differs per metric. Match on the tail of the path, not the composed
name — matching the composed name parses every row, joins every key, and yields
an empty dataset.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "openfoodtox": {
      "url": "https://gateway.pipeworx.io/openfoodtox/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/openfoodtox/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1856+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/openfoodtox_hazard_profile \
  -H 'Content-Type: application/json' \
  -d '{"substance":"glyphosate"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/openfoodtox_hazard_profile`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Run it from npm

`@pipeworx/mcp-openfoodtox` is a local stdio bridge to the Pipeworx gateway: your MCP client
starts it with `npx`, and it forwards every call to the same
`https://gateway.pipeworx.io/openfoodtox/mcp` endpoint shown above. It needs network access;
there is no offline mode.

```json
{
  "mcpServers": {
    "openfoodtox": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-openfoodtox"]
    }
  }
}
```

Without a key it calls anonymously, capped at 50 calls a day. A free account
raises that to 200 a day: get a key at https://pipeworx.io/signup and add
`"env": { "PIPEWORX_API_KEY": "<your key>" }` to the server entry.
The key is sent as a Bearer token, the same way a hosted connection sends it,
so calls are metered and billed exactly as they are there.

It lists **only** this pack's tools by default. Set `PIPEWORX_META_TOOLS=1` to
also list `ask_pipeworx` and the other gateway-wide tools.

Behind an HTTPS proxy: Node's built-in `fetch` does not read `HTTPS_PROXY` by
default. Newer Node releases honour it when `NODE_USE_ENV_PROXY=1` is set; check
your Node version's documentation.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Openfoodtox data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
