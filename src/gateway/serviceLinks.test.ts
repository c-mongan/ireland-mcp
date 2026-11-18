import { expect, it } from "vitest";
import { fetchServiceLink, serviceLinksFor, serviceRecords } from "./serviceLinks.js";

it("withholds a failed review from both discovery and previously saved result ids", () => {
  const pending = serviceRecords.map(record => ({ ...record, reviewed: false }));
  expect(() => serviceLinksFor("water outage", pending)).toThrow(/pending review/);
  expect(() => fetchServiceLink("official-service:water-supply", pending)).toThrow(/No reviewed official service link/);
  expect(serviceLinksFor("water quality statistics", pending)).toEqual([]);
});
