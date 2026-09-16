interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * EFSA OpenFoodTox — the reference values EFSA has derived for chemical
 * substances in food and feed: acceptable daily intakes, acute reference doses,
 * tolerable intakes and operator exposure levels, with the assessment body that
 * set each one.
 *
 * Source: OpenFoodTox 3.0, Zenodo record 19388272 (DOI 10.5281/zenodo.19388272),
 * published 2026-04-30, CC-BY-4.0. Extracted from the official xlsx export —
 * nothing is scraped, and the data ships with the pack rather than being fetched
 * per call, so answers do not depend on Zenodo being up.
 *
 * Two properties of this data drive the whole design:
 *
 *  1. ONE SUBSTANCE CAN HAVE SEVERAL LEGITIMATE VALUES. Cadmium carries a
 *     tolerable weekly intake of 2.5 µg/kg bw from EFSA and 7 from the older
 *     JECFA assessment. Both are real; collapsing them to one number would
 *     invent a consensus that does not exist. Every value is returned with the
 *     body that set it.
 *  2. ABSENCE IS NOT ZERO. A substance EFSA has not assigned a reference value
 *     is reported as found:false with a reason, never as an empty list that
 *     reads like "no limit applies".
 */

// Plain JSON import, no import attribute: this repo compiles with
// module: ES2022, and `with { type: 'json' }` requires esnext/node18+.
// resolveJsonModule in tsconfig.base is what makes this resolve.
import dataset from './data/openfoodtox.json';

interface ReferenceValue {
  metric: string;
  value: string;
  unit?: string;
  qualifier?: string;
  upper_value?: string;
  assessment_body?: string;
  critical_endpoint?: string;
  justification?: string;
}

interface SubstanceRecord {
  substance: string;
  uuid: string;
  reference_values: ReferenceValue[];
}

interface Dataset {
  source: string;
  doi: string;
  zenodo_record: string;
  published: string;
  licence: string;
  substances: Record<string, SubstanceRecord>;
}

const DATA = dataset as unknown as Dataset;

/** Stamped on every response — a hazard value without a dated source is unusable. */
const PROVENANCE = {
  source: DATA.source,
  doi: DATA.doi,
  published: DATA.published,
  licence: DATA.licence,
  attribution: 'EFSA OpenFoodTox, CC-BY-4.0. Reference values are EFSA/other assessment-body outputs, not a regulatory limit for a specific food.',
};

// Human-readable names for the IUCLID metric keys. An unmapped metric falls
// through as its raw key rather than being dropped — a new metric type in a
// future release must not vanish from the answer.
const METRIC_LABELS: Record<string, string> = {
  AcceptableDailyIntake: 'Acceptable Daily Intake (ADI)',
  AcuteReferenceDose: 'Acute Reference Dose (ARfD)',
  AcceptableOperatorExposureLevel: 'Acceptable Operator Exposure Level (AOEL)',
  AcuteAcceptableOperatorExposureLevel: 'Acute Acceptable Operator Exposure Level (AAOEL)',
  OtherReferenceValues: 'Other reference value (TDI / TWI / BMDL and similar — read the endpoint)',
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const INDEX = new Map<string, string>();
for (const key of Object.keys(DATA.substances)) INDEX.set(norm(key), key);

function formatValue(v: ReferenceValue) {
  return {
    metric: METRIC_LABELS[v.metric] ?? v.metric,
    metric_key: v.metric,
    value: v.qualifier ? `${v.qualifier}${v.value}` : v.value,
    unit: v.unit ?? null,
    upper_value: v.upper_value ?? null,
    assessment_body: v.assessment_body ?? null,
    critical_endpoint: v.critical_endpoint ?? null,
    justification: v.justification ?? null,
  };
}

function resolve(query: string): { key: string; exact: boolean } | null {
  const wanted = norm(query);
  if (!wanted) return null;
  const exact = INDEX.get(wanted);
  if (exact) return { key: exact, exact: true };
  // Substring, longest-name-last so the closest match wins rather than whichever
  // key happens to be first in insertion order.
  const partial = [...INDEX.entries()]
    .filter(([k]) => k.includes(wanted) || wanted.includes(k))
    .sort((a, b) => a[0].length - b[0].length)[0];
  return partial ? { key: partial[1], exact: false } : null;
}

const tools: McpToolExport['tools'] = [
  {
    name: 'openfoodtox_hazard_profile',
    description:
      'Get EFSA\'s derived toxicological reference values for a chemical substance in food or feed — acceptable daily intake (ADI), acute reference dose (ARfD), tolerable intakes, and operator exposure levels — each with the assessment body that set it and the critical endpoint it was based on. Use for questions like "what is the ADI for glyphosate" or "what tolerable intake has EFSA set for cadmium". Covers 3,437 substances that have at least one reference value, from EFSA OpenFoodTox 3.0.',
    inputSchema: {
      type: 'object',
      properties: {
        substance: {
          type: 'string',
          description: 'Chemical or substance name, e.g. "glyphosate", "aspartame", "cadmium", "deoxynivalenol". Matched case-insensitively; a partial name resolves to the closest substance and the response says which.',
        },
      },
      required: ['substance'],
    },
  },
  {
    name: 'openfoodtox_search',
    description:
      'Search EFSA OpenFoodTox for assessed substances by name fragment, returning each match with how many reference values it carries. Use to find the exact substance name before requesting a hazard profile, or to see which related compounds EFSA has assessed.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name fragment, e.g. "aflatoxin" or "phthalate".' },
        limit: { type: 'number', description: 'Maximum matches to return (default 20).' },
      },
      required: ['query'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'openfoodtox_hazard_profile': {
      const substance = typeof args.substance === 'string' ? args.substance : '';
      if (!substance.trim()) {
        throw new Error('Required argument "substance" is missing. Pass a chemical name like "glyphosate".');
      }
      const hit = resolve(substance);
      if (!hit) {
        return {
          found: false,
          reason: 'substance_not_assessed',
          requested_substance: substance,
          // Absence here means EFSA has no derived reference value in this
          // dataset — NOT that the substance is unregulated or safe.
          message: `EFSA OpenFoodTox has no derived reference value for "${substance}". That means this dataset holds no assessment for it, which is not a statement that the substance is safe or unrestricted.`,
          hint: 'Try openfoodtox_search with a shorter fragment of the name — EFSA often lists a specific salt or isomer rather than the common name.',
          ...PROVENANCE,
        };
      }
      const record = DATA.substances[hit.key];
      return {
        found: true,
        substance: record.substance,
        requested_substance: substance,
        ...(hit.exact ? {} : {
          matched_inexactly: true,
          match_note: `No exact match for "${substance}"; returned the closest assessed substance, "${record.substance}". Confirm this is the compound you meant.`,
        }),
        reference_value_count: record.reference_values.length,
        // Several values for one substance is normal and meaningful: different
        // bodies and different endpoints. They are listed, not reconciled.
        reference_values: record.reference_values.map(formatValue),
        interpretation: 'Each entry is a reference value derived by the named assessment body for the named endpoint. Where a substance carries several, they come from different bodies or different assessments and are not interchangeable; use the one matching your regulatory context rather than the lowest or the newest.',
        ...PROVENANCE,
      };
    }

    case 'openfoodtox_search': {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) throw new Error('Required argument "query" is missing. Pass a name fragment like "aflatoxin".');
      const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));
      const wanted = norm(query);
      const matches = [...INDEX.entries()]
        .filter(([k]) => k.includes(wanted))
        .sort((a, b) => a[0].length - b[0].length)
        .slice(0, limit)
        .map(([, key]) => ({
          substance: DATA.substances[key].substance,
          reference_value_count: DATA.substances[key].reference_values.length,
        }));
      return {
        found: matches.length > 0,
        query,
        total_matches: matches.length,
        substances: matches,
        ...(matches.length === 0
          ? { message: `No assessed substance in OpenFoodTox matches "${query}".` }
          : {}),
        ...PROVENANCE,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;

// Exported for tests.
export { resolve, formatValue, DATA };
