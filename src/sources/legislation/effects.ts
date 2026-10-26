import { htmlText } from "./text.js";

export interface CommencementRow {
  provision: string;
  commencement: string | null;
  information: string;
}

export interface EffectRow {
  affected: string;
  affecting_provision: string;
  commencement: string | null;
  commencement_source: string | null;
}

export interface MadeUnderRow {
  provision: string;
  instrument: string;
}

export interface ActEffects {
  title: string | null;
  /** e.g. "13 October 2026 (Act No. 36 of 2026 and S.I. No. 522 of 2026)". */
  updated_to: string | null;
  /** eISB's statement when every listed effect is reflected in the latest Revised Act; null when not stated. */
  revised_note: string | null;
  commencement: CommencementRow[];
  effects: EffectRow[];
  made_under: MadeUnderRow[];
}

/** Text of the table that follows the `id="<id>"` heading, up to the next h3 heading. */
function sectionTable(html: string, id: string): string {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return "";
  const next = html.indexOf("<h3", start + 1);
  return html.slice(start, next < 0 ? undefined : next);
}

function rows(table: string): string[][] {
  const body = table.slice(Math.max(0, table.indexOf("<tbody")));
  return body
    .split(/<tr[\s>]/)
    .slice(1)
    .map((row) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => htmlText(c[1]!).replace(/\n/g, " ")))
    .filter((cells) => cells.length > 0);
}

const blank = (s: string | undefined) => !s || !s.trim();

/**
 * Parses an eISB Legislation Directory page (/eli/isbc/{year}_{number}.html). A blank first cell continues the
 * provision of the row above, so it is carried forward.
 */
export function parseActEffects(html: string): ActEffects | undefined {
  if (!html.includes('id="effects"') && !html.includes('id="commencement"')) return undefined;
  const span = (re: RegExp) => htmlText(html.match(re)?.[1] ?? "") || null;
  const updated = span(/<span>\s*Updated to ([^<]+)<\/span>/);
  const basis = span(/<span>\s*Updated to [^<]+<\/span>\s*<span>([^<]+)<\/span>/);
  const title = span(/<h2 class="post2006">\s*<b>\s*<a [^>]*>([^<]+)<\/a>/);
  const revised = html.match(/All effects below are reflected in the most recent Revised Act\./)?.[0] ?? null;

  let lastProvision = "";
  const commencement = rows(sectionTable(html, "commencement")).map(([provision, date, info]) => {
    lastProvision = blank(provision) ? lastProvision : provision!;
    return { provision: lastProvision, commencement: blank(date) ? null : date!, information: info ?? "" };
  });
  let lastAffected = "";
  const effects = rows(sectionTable(html, "effects")).map(([affected, by, date, source]) => {
    lastAffected = blank(affected) ? lastAffected : affected!;
    return { affected: lastAffected, affecting_provision: by ?? "", commencement: blank(date) ? null : date!, commencement_source: blank(source) ? null : source! };
  });
  let lastSection = "";
  const madeUnder = rows(sectionTable(html, "associatedsecondary")).map(([provision, instrument]) => {
    lastSection = blank(provision) ? lastSection : provision!;
    return { provision: lastSection, instrument: instrument ?? "" };
  });
  return {
    title,
    updated_to: updated ? `${updated}${basis ? ` ${basis}` : ""}` : null,
    revised_note: revised,
    commencement,
    effects: effects.filter((e) => !(e.affected === "Not affected" && !e.affecting_provision)),
    made_under: madeUnder.filter((r) => r.instrument)
  };
}
