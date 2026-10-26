/**
 * Place-name normalisation shared by the crosswalk. Every source spells places differently:
 * "Co. Donegal" (DSP), "Athenry-Oranmore, Galway County" (CSO NDA05), "ATHENRY-ORANMORE LEA-7"
 * (Tailte Éireann), "Galway West (5)" (constituency with seats), "Dún Laoghaire" with or without the fada.
 */

/** Lower case, no diacritics, '&' as 'and', punctuation and hyphens as single spaces. */
export function foldName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’‘`]/g, "")
    .replace(/\bst\.?(?=\s)/g, "saint")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Strips decorations that do not change which place is meant: "Co.", "County", seat counts, "LEA-7", "Council". */
export function stripDecorations(value: string): string {
  return value
    .trim()
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/\s+(LEA|TA)-\d+$/i, "")
    .replace(/\s+(local electoral area|lea|electoral division|ed|constituency)$/i, "")
    .replace(/^(co\.\s*|co\s+|county\s+|contae\s+)/i, "")
    .trim();
}

/** Folded key for name lookups: decorations stripped, then folded. */
export const placeKey = (value: string) => foldName(stripDecorations(value));

/**
 * Splits CSO's "<area>, <council or county>" labels (NDA05 LEAs, RTB RIA02 locations) into parts.
 * Returns null when there is no qualifier.
 */
export function splitQualifier(value: string): { name: string; qualifier: string } | null {
  const i = value.lastIndexOf(",");
  if (i <= 0) return null;
  const name = value.slice(0, i).trim();
  const qualifier = value.slice(i + 1).trim();
  return name && qualifier ? { name, qualifier } : null;
}

/** Short and long council names that mean the same local authority, e.g. "Galway County" and "Galway County Council". */
export function councilAliases(name: string): string[] {
  const out = new Set<string>([name]);
  const short = name.replace(/\s+Council$/, "");
  out.add(short);
  if (/ City and County$/.test(short)) out.add(short.replace(/ City and County$/, ""));
  if (/ County$/.test(short) && !/^(Galway|Cork) County$/.test(short)) out.add(short.replace(/ County$/, ""));
  if (short === "Dún Laoghaire-Rathdown County") out.add("Dún Laoghaire-Rathdown").add("DLR");
  return [...out];
}

/** "Dublin 8", "D8", "D08", "Dublin 6W" → "D08" / "D6W"; null when the text is not a Dublin postal district. */
export function dublinDistrict(value: string): string | null {
  const m = /^(?:dublin|d|baile atha cliath)\s*0?(\d{1,2})\s*(w)?$/i.exec(foldName(value).replace(/\s+/g, " "));
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2]) return n === 6 ? "D6W" : null;
  return DUBLIN_DISTRICTS[`D${String(n).padStart(2, "0")}`] ? `D${String(n).padStart(2, "0")}` : null;
}

/** An Eircode routing key such as "H91" or "D6W" (the first three characters of an Eircode). */
export const routingKey = (value: string) => {
  const m = /^([ac-fhknprtv-y]\d{2}|d6w)(\s*[0-9ac-fhknprtv-y]{4})?$/i.exec(value.trim());
  return m ? m[1]!.toUpperCase() : null;
};

/**
 * Dublin postal districts as CSO electoral-division name stems. Postal districts are delivery areas,
 * not statistical ones, so this is an approximate guide: a stem matches its lettered EDs (Ushers A–F)
 * and hyphenated ones (Tallaght-Jobstown).
 */
export const DUBLIN_DISTRICTS: Record<string, string[]> = {
  D01: ["North City", "Rotunda", "Mountjoy"],
  D02: ["Mansion House", "Royal Exchange", "South Dock"],
  D03: ["Clontarf East", "Clontarf West", "North Dock", "Ballybough"],
  D04: ["Pembroke East", "Pembroke West"],
  D05: ["Raheny", "Harmonstown", "Edenmore", "Kilmore"],
  D06: ["Rathmines East", "Rathmines West"],
  D6W: ["Terenure", "Templeogue"],
  D07: ["Arran Quay", "Cabra East", "Cabra West"],
  D08: ["Ushers", "Merchants Quay", "Wood Quay", "Kilmainham", "Saint Kevin's"],
  D09: ["Drumcondra South", "Botanic", "Whitehall", "Beaumont", "Grace Park", "Ballymun"],
  D10: ["Cherry Orchard", "Kylemore", "Decies", "Drumfinn"],
  D11: ["Finglas North", "Finglas South", "Ballygall"],
  D12: ["Crumlin", "Kimmage", "Walkinstown"],
  D13: ["Baldoyle", "Sutton", "Howth", "Grange", "Ayrfield"],
  D14: ["Rathfarnham", "Churchtown", "Dundrum", "Clonskeagh"],
  D15: ["Blanchardstown", "Castleknock"],
  D16: ["Ballinteer", "Ballyboden", "Firhouse-Knocklyon"],
  D17: ["Priorswood", "Balgriffin"],
  D18: ["Foxrock", "Cabinteely", "Shankill", "Glencullen"],
  D20: ["Palmerston", "Chapelizod"],
  D22: ["Clondalkin"],
  D24: ["Tallaght", "Firhouse Village", "Firhouse-Ballycullen", "Bohernabreena"]
};

/** True when an ED name belongs to a stem: "Ushers B" and "Tallaght-Jobstown" match "Ushers" and "Tallaght". */
export function edMatchesStem(edName: string, stem: string): boolean {
  const ed = foldName(edName).replace(/ [a-h]$/, "");
  const s = foldName(stem);
  return ed === s || ed.startsWith(`${s} `);
}
