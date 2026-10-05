export interface Place {
  name: string;
  county: string;
  lat: number;
  lon: number;
  aliases?: string[];
}

/** Small built-in gazetteer: the 26 counties (at the county town) and the larger towns. Coordinates are WGS84 town centres. */
export const PLACES: Place[] = [
  { name: "Dublin", county: "Dublin", lat: 53.3498, lon: -6.2603, aliases: ["dublin city", "baile átha cliath", "co dublin", "county dublin"] },
  { name: "Cork", county: "Cork", lat: 51.8985, lon: -8.4756, aliases: ["cork city", "corcaigh", "co cork", "county cork"] },
  { name: "Galway", county: "Galway", lat: 53.2707, lon: -9.0568, aliases: ["galway city", "gaillimh", "co galway", "county galway"] },
  { name: "Limerick", county: "Limerick", lat: 52.6638, lon: -8.6267, aliases: ["limerick city", "luimneach", "co limerick", "county limerick"] },
  { name: "Waterford", county: "Waterford", lat: 52.2593, lon: -7.1101, aliases: ["waterford city", "port láirge", "co waterford", "county waterford"] },
  { name: "Carlow", county: "Carlow", lat: 52.8365, lon: -6.9341 },
  { name: "Cavan", county: "Cavan", lat: 53.9908, lon: -7.3606 },
  { name: "Ennis", county: "Clare", lat: 52.8436, lon: -8.9864, aliases: ["clare", "co clare", "county clare"] },
  { name: "Lifford", county: "Donegal", lat: 54.8317, lon: -7.4836 },
  { name: "Letterkenny", county: "Donegal", lat: 54.9558, lon: -7.7342, aliases: ["donegal", "co donegal", "county donegal"] },
  { name: "Tralee", county: "Kerry", lat: 52.2713, lon: -9.6999, aliases: ["kerry", "co kerry", "county kerry"] },
  { name: "Killarney", county: "Kerry", lat: 52.0599, lon: -9.5044 },
  { name: "Naas", county: "Kildare", lat: 53.2159, lon: -6.6669, aliases: ["kildare", "co kildare", "county kildare"] },
  { name: "Kilkenny", county: "Kilkenny", lat: 52.6541, lon: -7.2448 },
  { name: "Portlaoise", county: "Laois", lat: 53.0344, lon: -7.2998, aliases: ["laois", "co laois", "county laois"] },
  { name: "Carrick-on-Shannon", county: "Leitrim", lat: 53.9469, lon: -8.09, aliases: ["leitrim", "co leitrim", "county leitrim"] },
  { name: "Longford", county: "Longford", lat: 53.7276, lon: -7.7983 },
  { name: "Dundalk", county: "Louth", lat: 54.0, lon: -6.4167, aliases: ["louth", "co louth", "county louth"] },
  { name: "Drogheda", county: "Louth", lat: 53.7179, lon: -6.3561 },
  { name: "Castlebar", county: "Mayo", lat: 53.8547, lon: -9.2988, aliases: ["mayo", "co mayo", "county mayo"] },
  { name: "Navan", county: "Meath", lat: 53.6528, lon: -6.6814, aliases: ["meath", "co meath", "county meath"] },
  { name: "Monaghan", county: "Monaghan", lat: 54.2492, lon: -6.9683 },
  { name: "Tullamore", county: "Offaly", lat: 53.2739, lon: -7.4889, aliases: ["offaly", "co offaly", "county offaly"] },
  { name: "Roscommon", county: "Roscommon", lat: 53.6333, lon: -8.1833 },
  { name: "Sligo", county: "Sligo", lat: 54.2766, lon: -8.4761 },
  { name: "Clonmel", county: "Tipperary", lat: 52.355, lon: -7.7039, aliases: ["tipperary", "co tipperary", "county tipperary"] },
  { name: "Mullingar", county: "Westmeath", lat: 53.5259, lon: -7.3381, aliases: ["westmeath", "co westmeath", "county westmeath"] },
  { name: "Athlone", county: "Westmeath", lat: 53.4239, lon: -7.9407 },
  { name: "Wexford", county: "Wexford", lat: 52.3369, lon: -6.4633 },
  { name: "Wicklow", county: "Wicklow", lat: 52.9808, lon: -6.0446 },
  { name: "Bray", county: "Wicklow", lat: 53.2028, lon: -6.0983 },
  { name: "Swords", county: "Dublin", lat: 53.4597, lon: -6.2181 },
  { name: "Dún Laoghaire", county: "Dublin", lat: 53.2944, lon: -6.1339, aliases: ["dun laoghaire"] },
  { name: "Tallaght", county: "Dublin", lat: 53.2859, lon: -6.3733 },
  { name: "Newbridge", county: "Kildare", lat: 53.1819, lon: -6.7967 },
  { name: "Maynooth", county: "Kildare", lat: 53.3813, lon: -6.5918 },
  { name: "Carlow Town", county: "Carlow", lat: 52.8365, lon: -6.9341, aliases: ["co carlow", "county carlow"] },
  { name: "Wexford Town", county: "Wexford", lat: 52.3369, lon: -6.4633, aliases: ["co wexford", "county wexford"] },
  { name: "Westport", county: "Mayo", lat: 53.8, lon: -9.5167 },
  { name: "Ballina", county: "Mayo", lat: 54.1149, lon: -9.1551 },
  { name: "Shannon", county: "Clare", lat: 52.7038, lon: -8.8642 }
];

export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/^(co|county)\s+/, "")
    .replace(/[\s-]+/g, " ")
    .trim();

export function findPlace(query: string): Place | undefined {
  const q = fold(query);
  return PLACES.find((p) => fold(p.name) === q || p.county.toLowerCase() === q || (p.aliases ?? []).some((a) => fold(a) === q));
}
