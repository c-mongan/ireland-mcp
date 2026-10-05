export const PPR_DOWNLOADS = "https://www.propertypriceregister.ie/website/npsra/ppr/npsra-ppr.nsf/Downloads";

export const COUNTIES = [
  "Carlow", "Cavan", "Clare", "Cork", "Donegal", "Dublin", "Galway", "Kerry", "Kildare", "Kilkenny", "Laois", "Leitrim", "Limerick",
  "Longford", "Louth", "Mayo", "Meath", "Monaghan", "Offaly", "Roscommon", "Sligo", "Tipperary", "Waterford", "Westmeath", "Wexford", "Wicklow"
] as const;
export type County = (typeof COUNTIES)[number];

export function csvUrl(year: number, county?: County): string {
  const file = county ? `PPR-${year}-${county}.csv` : `PPR-${year}.csv`;
  return `${PPR_DOWNLOADS}/${file}/$FILE/${file}`;
}

/** Compact row: [date ISO, address, county, eircode, price €, flags, description, size]. flags bit0 = not full market price, bit1 = VAT exclusive. */
export type SaleRow = [string, string, string, string, number, number, string, string];

export interface Sale {
  date: string;
  address: string;
  county: string;
  eircode: string | null;
  price_eur: number;
  not_full_market_price: boolean;
  vat_exclusive: boolean;
  description: string;
  size: string | null;
}

export const toSale = (r: SaleRow): Sale => ({
  date: r[0],
  address: r[1],
  county: r[2],
  eircode: r[3] || null,
  price_eur: r[4],
  not_full_market_price: (r[5] & 1) === 1,
  vat_exclusive: (r[5] & 2) === 2,
  description: r[6],
  size: r[7] || null
});

/** Splits one CSV line, honouring double-quoted fields and doubled quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Parses a PPR CSV download. The register publishes Windows-1252 bytes; prices look like "€325,000.00". */
export function parsePprCsv(bytes: Uint8Array): SaleRow[] {
  const text = new TextDecoder("windows-1252").decode(bytes);
  const rows: SaleRow[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const f = splitCsvLine(line);
    const date = clean(f[0]).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const price = Number(clean(f[4]).replace(/[^0-9.]/g, ""));
    if (!date || !Number.isFinite(price) || price <= 0) continue;
    const flags = (clean(f[5]).toLowerCase() === "yes" ? 1 : 0) | (clean(f[6]).toLowerCase() === "yes" ? 2 : 0);
    rows.push([`${date[3]}-${date[2]}-${date[1]}`, clean(f[1]), clean(f[2]), clean(f[3]).toUpperCase(), price, flags, clean(f[7]), clean(f[8])]);
  }
  return rows;
}
