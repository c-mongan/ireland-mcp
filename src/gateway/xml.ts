const ENTITIES: Record<string, string> = { amp: "&", apos: "'", "#39": "'", quot: '"', lt: "<", gt: ">" };

/** Decode XML's predefined entities in a single pass, so "&amp;apos;" stays "&apos;". */
export const decodeXml = (s: string) => s.replace(/&(amp|apos|#39|quot|lt|gt);/g, (_, e: string) => ENTITIES[e] ?? _);
