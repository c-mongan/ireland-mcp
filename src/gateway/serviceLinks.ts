import { ToolError } from "./errors.js";

interface ServiceLink {
  id: string;
  task: string;
  publisher: string;
  url: string;
  coverage: string;
  last_link_check: string;
  access_mode: "link-only";
  guidance: string;
}

// Mark a broken link unreviewed and remove its static anchor until the destination is rechecked.
// These are publisher handoffs, not searchable notices, incidents or third-party directory entries.
export const serviceRecords: ReadonlyArray<{ reviewed: boolean; matches: (query: string) => boolean; link: ServiceLink }> = [
  {
    reviewed: true,
    matches: q => /\b(food|fsai|allergens?|baby formula|infant formula)\b/.test(q) && /\b(recall(?:s|ed)?|alerts?|warnings?)\b/.test(q),
    link: {
      id: "official-service:food-alerts",
      task: "Check FSAI food alerts",
      publisher: "Food Safety Authority of Ireland",
      url: "https://www.fsai.ie/news-and-alerts/food-alerts",
      coverage: "Food alerts published by the FSAI in Ireland",
      last_link_check: "2026-11-18",
      access_mode: "link-only",
      guidance: "Check the product and batch details on the publisher’s page. Ireland MCP does not check recall status or establish that a product is safe."
    }
  },
  {
    reviewed: true,
    matches: q => /\b(water|uisce eireann)\b/.test(q) && /\b(outages?|interruptions?|disruptions?|supply (?:issues?|updates?)|no water|water off|water cut(?:s)?|low pressure)\b/.test(q),
    link: {
      id: "official-service:water-supply",
      task: "Check Uisce Éireann supply updates",
      publisher: "Uisce Éireann",
      url: "https://www.water.ie/help/supply",
      coverage: "Uisce Éireann public water supply in the Republic of Ireland",
      last_link_check: "2026-11-18",
      access_mode: "link-only",
      guidance: "Choose “Check your local supply” and enter your location on the publisher’s site. Ireland MCP does not check local supply status."
    }
  }
];

export function serviceLinksFor(query?: string, records = serviceRecords) {
  const normalised = query?.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const matches = normalised === undefined ? records : records.filter(record => record.matches(normalised));
  const links = matches.filter(record => record.reviewed).map(record => record.link);
  if (query && matches.length && !links.length) throw new ToolError("NOT_FOUND", "The official service link is pending review.", {
    hint: "Check directly with the publisher. No recall or local supply status has been verified."
  });
  return links;
}

export function fetchServiceLink(id: string, records = serviceRecords) {
  const link = records.find(record => record.reviewed && record.link.id === id)?.link;
  if (!link) throw new ToolError("NOT_FOUND", "No reviewed official service link with that id.", {
    hint: "Check directly with the responsible publisher. A missing link is not evidence about a recall or water supply."
  });
  const { task, url, guidance, ...metadata } = link;
  return { id, title: task, url, text: guidance, metadata: { ...metadata, task, licence: null, attribution: link.publisher } };
}
