import { z } from "zod";
import { DAY } from "../../gateway/context.js";
import { envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";
import { euLawCard } from "./card.js";

// Licence: the data.europa.eu record for the Cellar SPARQL endpoint (dataset
// "sparql-cellar-of-the-publications-office", checked 26 Oct 2026) lists every distribution under
// http://data.europa.eu/eli/dec/2011/833/oj, the European Commission reuse notice. Not asserted as CC BY 4.0.
export const euLawInfo: SourceInfo = {
  id: "eu-law",
  name: "Publications Office of the EU — Cellar SPARQL",
  licence: "Commission Decision 2011/833/EU reuse notice (per the data.europa.eu record for the Cellar SPARQL endpoint)",
  attribution: "© European Union. Metadata from the Publications Office of the European Union (Cellar), reused under Commission Decision 2011/833/EU.",
  homepage: "https://op.europa.eu/en/web/cellar"
};

export const CELLAR_SPARQL = "https://publications.europa.eu/webapi/rdf/sparql";
export const LICENCE_RECORD = "https://data.europa.eu/data/datasets/sparql-cellar-of-the-publications-office";
const USER_AGENT = "ireland-mcp/1.0 (bounded EU law metadata lookup; https://github.com/c-mongan/ireland-mcp)";
const TTL = 7 * DAY;
const MAX_DOCUMENTS = 5;
const CELEX = /^[0-9CE]\d{4}[A-Z]{1,2}\d{1,5}(?:\(\d{1,3}\))?(?:-\d{8})?$/;
const ELI = /^https?:\/\/data\.europa\.eu\/eli\/[a-z_]{2,20}\/\d{4}\/\d{1,5}\/oj$/;

interface Binding { type: string; value: string }
export interface SparqlJson { head?: { vars?: unknown }; results?: { bindings?: Array<Record<string, Binding>> } }

function assertSparql(value: SparqlJson): void {
  if (!value || !Array.isArray(value.head?.vars) || !Array.isArray(value.results?.bindings)) {
    throw new ToolError("UPSTREAM_DOWN", "The Cellar SPARQL endpoint returned an unexpected response.");
  }
}

/**
 * Bounded metadata query for one work. The identifier is regex-validated before it is placed in a typed
 * literal, so no caller text reaches the query unchecked.
 */
export function cellarQuery(id: { celex: string } | { eli: string }): string {
  const match =
    "celex" in id ? `?work cdm:resource_legal_id_celex "${id.celex}"^^xsd:string .` : `?work cdm:resource_legal_eli "${id.eli}"^^xsd:anyURI .`;
  return `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?work ?celex ?type ?date ?force ?eli ?eif ?eov ?title WHERE {
 ${match}
 OPTIONAL { ?work cdm:resource_legal_id_celex ?celex }
 OPTIONAL { ?work cdm:work_has_resource-type ?type }
 OPTIONAL { ?work cdm:work_date_document ?date }
 OPTIONAL { ?work cdm:resource_legal_in-force ?force }
 OPTIONAL { ?work cdm:resource_legal_eli ?eli }
 OPTIONAL { ?work cdm:resource_legal_date_entry-into-force ?eif }
 OPTIONAL { ?work cdm:resource_legal_date_end-of-validity ?eov }
 OPTIONAL { ?exp cdm:expression_belongs_to_work ?work ; cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ENG> ; cdm:expression_title ?title }
} LIMIT 50`;
}

export interface EuLawDocument {
  cellar_uri: string;
  celex: string[];
  eli: string | null;
  title: string | null;
  type: string | null;
  date_document: string | null;
  in_force: boolean | null;
  entry_into_force: string[];
  end_of_validity: string | null;
  eur_lex: string | null;
}

const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
// Cellar uses placeholder dates: 1001-01-01 for unknown and 9999-12-31 for open-ended validity.
const realDate = (v: string | undefined) => (isDate(v) && v !== "1001-01-01" && v !== "9999-12-31" ? v : null);

/** Merges SPARQL rows (one per combination of multi-valued properties) into one record per work. */
export function summariseCellar(json: SparqlJson): EuLawDocument[] {
  const works = new Map<string, EuLawDocument & { force: Set<string> }>();
  for (const row of json.results?.bindings ?? []) {
    const work = row.work?.value;
    if (!work || !/^http:\/\/publications\.europa\.eu\/resource\/cellar\/[0-9a-f-]{36}$/.test(work)) continue;
    const doc = works.get(work) ?? {
      cellar_uri: work,
      celex: [],
      eli: null,
      title: null,
      type: null,
      date_document: null,
      in_force: null,
      entry_into_force: [],
      end_of_validity: null,
      eur_lex: null,
      force: new Set<string>()
    };
    works.set(work, doc);
    const celex = row.celex?.value;
    if (celex && CELEX.test(celex) && !doc.celex.includes(celex)) doc.celex.push(celex);
    const eli = row.eli?.value;
    if (!doc.eli && eli && ELI.test(eli)) doc.eli = eli;
    if (!doc.title && row.title?.value) doc.title = row.title.value.replace(/\s+/g, " ").trim();
    const type = row.type?.value.match(/\/resource-type\/([A-Z_]+)$/)?.[1];
    if (!doc.type && type) doc.type = type;
    doc.date_document ??= realDate(row.date?.value);
    if (row.force?.value) doc.force.add(row.force.value);
    const eif = realDate(row.eif?.value);
    if (eif && !doc.entry_into_force.includes(eif)) doc.entry_into_force.push(eif);
    doc.end_of_validity ??= realDate(row.eov?.value);
  }
  return [...works.values()].map(({ force, ...doc }) => {
    const flags = [...force].map((v) => v === "1" || v === "true");
    return {
      ...doc,
      entry_into_force: [...doc.entry_into_force].sort(),
      // Conflicting flags are reported as unknown rather than picking one.
      in_force: flags.length > 0 && flags.every((v) => v === flags[0]) ? flags[0]! : null,
      eur_lex: doc.celex[0] ? `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${doc.celex[0]}` : null
    };
  });
}

async function lookup(ctx: ToolContext, id: { celex: string } | { eli: string }) {
  const url = `${CELLAR_SPARQL}?${new URLSearchParams({ query: cellarQuery(id), format: "application/sparql-results+json" }).toString()}`;
  const result = await ctx.cachedJson<SparqlJson>(url, TTL, {
    label: "Publications Office Cellar",
    timeoutMs: 8_000,
    maxBytes: 256_000,
    headers: { accept: "application/sparql-results+json", "user-agent": USER_AGENT },
    validate: assertSparql
  });
  return { url, documents: summariseCellar(result.value), cached: result.cached, stale: result.stale };
}

const lookupTool = defineTool({
  name: "eu_law_lookup",
  title: "EU law metadata by CELEX or ELI",
  description:
    "Metadata for one EU legal act from the Publications Office (Cellar): English title, type (REG, DIR, DEC…), date, in-force flag, entry-into-force and end-of-validity dates, ELI and CELEX, with an EUR-Lex link. Give a CELEX number such as 32016R0679 (GDPR), or an ELI such as one listed in legislation_get_si transposes.",
  inputSchema: {
    celex: z.string().regex(CELEX).optional().describe("CELEX number, e.g. 32016R0679 or 32019L1024."),
    eli: z.string().regex(ELI).optional().describe("EU ELI, e.g. http://data.europa.eu/eli/reg/2014/536/oj.")
  },
  example: { celex: "32016R0679" },
  handler: async ({ celex, eli }, ctx) => {
    if ((celex === undefined) === (eli === undefined)) {
      throw new ToolError("BAD_ARGS", "Give exactly one of celex or eli.", { hint: 'For example { "celex": "32016R0679" }.' });
    }
    const id = celex !== undefined ? { celex } : { eli: eli!.replace(/^https:/, "http:") };
    const r = await lookup(ctx, id);
    if (!r.documents.length) {
      throw new ToolError("NOT_FOUND", `No EU act with ${celex !== undefined ? `CELEX ${celex}` : `ELI ${eli}`} in the Publications Office Cellar.`, {
        hint: "Check the identifier on EUR-Lex. CELEX numbers look like 32016R0679 (sector, year, type, number)."
      });
    }
    return envelope(euLawInfo, {
      data: {
        query: id,
        documents: r.documents.slice(0, MAX_DOCUMENTS),
        total: r.documents.length,
        licence_terms: LICENCE_RECORD,
        warnings: [
          "Not legal advice.",
          "Only the Official Journal of the European Union is authentic. The in-force flag and dates are Cellar metadata, not a legal determination.",
          "The EUR-Lex link is for reading; this server does not fetch EUR-Lex."
        ]
      },
      url: r.url,
      cached: r.cached,
      stale: r.stale,
      truncated: r.documents.length > MAX_DOCUMENTS
    });
  }
});

export const euLawModule: SourceModule = {
  info: euLawInfo,
  summary: "EU law metadata from the Publications Office (Cellar): title, type, dates, in-force flag, ELI and CELEX.",
  domain: "law/politics",
  card: euLawCard,
  coverage: "EU legal acts indexed in the Publications Office Cellar, looked up one at a time by CELEX number or ELI.",
  tools: [lookupTool]
};
