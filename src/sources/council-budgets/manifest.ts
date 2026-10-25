export const DATASET_URL = "https://data.gov.ie/dataset/local-authority-and-regional-assembly-annual-budgets";
export const MANIFEST_OBSERVED_AT = "2026-10-25";
export const PUBLISHER_HOST = "opendata.housing.gov.ie";
const PUBLISHER_DATASET_ID = "e55a1d32-c225-48e0-bb6f-43c86071841b";

export interface BudgetResource {
  year: number;
  id: string;
  format: "XLS" | "XLSX";
  file: string;
  resourceModifiedAt: string;
  supported: boolean;
  partial?: boolean;
  reason?: string;
  partialReason?: string;
}

/** Resource ids and dates from the official CKAN package_show response. */
export const BUDGET_RESOURCES: readonly BudgetResource[] = [
  { year: 2013, id: "ef302385-8927-42bd-abd9-a8fc654d3354", format: "XLS", file: "final-2013-budget-publication.xls", resourceModifiedAt: "2026-09-01T15:30:09.187996", supported: false, reason: "The 2013 workbook uses a legacy authority structure that is not mapped to the current council layout." },
  { year: 2014, id: "a11d851b-9653-4d27-a1c6-e2268126976f", format: "XLS", file: "budget-2014-final-budget-publication-v1.1.xls", resourceModifiedAt: "2026-09-01T15:26:44.327211", supported: false, reason: "The 2014 workbook uses a legacy authority structure that is not mapped to the current council layout." },
  { year: 2015, id: "0a5f2ed2-de66-4222-b684-7c368faa845f", format: "XLS", file: "2015-budget-publication-final.xls", resourceModifiedAt: "2026-09-01T15:26:28.387983", supported: true },
  { year: 2016, id: "72e0a82d-5a60-4ee8-9e26-bcb4c9d2f043", format: "XLS", file: "budget-publication-2016.xls", resourceModifiedAt: "2026-09-01T15:29:27.114867", supported: true },
  { year: 2017, id: "d560ff07-976e-4b1c-a7c3-dfef41551c21", format: "XLS", file: "budget-2017-final-budget-publication.xls", resourceModifiedAt: "2026-09-01T15:27:00.506871", supported: true, partial: true, partialReason: "Some division tables omit council rows and two Division B tables have unlabeled values that are omitted. See council-budgets-source.md." },
  { year: 2018, id: "dd0c194a-8435-48b9-83fe-7da5cf80ad48", format: "XLSX", file: "budget-2018-budget-publication-v1.4.xlsx", resourceModifiedAt: "2026-09-01T15:27:23.321281", supported: true },
  { year: 2019, id: "f41a22a6-69b4-4886-8515-3224416a4117", format: "XLSX", file: "budget-publication-doc-2019-v1.1.xlsx", resourceModifiedAt: "2026-09-01T15:29:41.308390", supported: true },
  { year: 2020, id: "2ffc25f5-31ea-46e1-a8b7-4345f2027391", format: "XLSX", file: "budget-2020-budget-publication-v1.2.xlsx", resourceModifiedAt: "2026-09-01T15:27:38.982899", supported: true },
  { year: 2021, id: "9f884823-f2bc-4c73-a43d-440a2ed6cead", format: "XLSX", file: "budget-2021-budget-publication-v1.0.xlsx", resourceModifiedAt: "2026-09-01T15:28:00.599545", supported: true },
  { year: 2022, id: "d05dabee-9f83-4af1-b4dd-346d61a91d2d", format: "XLSX", file: "budget-2022-budget-publication-v1.0.xlsx", resourceModifiedAt: "2026-09-01T15:28:17.321039", supported: true },
  { year: 2023, id: "0f46b08b-888f-47a9-9b8e-6e1303d502cd", format: "XLSX", file: "budget-2023-budget-publication-v1.0.xlsx", resourceModifiedAt: "2026-09-01T15:28:30.306892", supported: true },
  { year: 2024, id: "ebb5c52e-3504-48f7-929a-ec917f381ef9", format: "XLSX", file: "budget-2024-budget-publication-v1.0.xlsx", resourceModifiedAt: "2026-09-01T15:28:55.319281", supported: true },
  { year: 2025, id: "69cb7558-f0d8-45f7-a08f-f1ab3b564d80", format: "XLSX", file: "budget-publication-document-2025.xlsx", resourceModifiedAt: "2026-09-01T15:29:54.513984", supported: true },
  { year: 2026, id: "18d03f3e-43ab-40c9-ad89-bc64a014bc93", format: "XLSX", file: "budget-2026-budget-publication-v1.2.xlsx", resourceModifiedAt: "2026-09-01T15:29:11.263159", supported: true }
];

export function budgetResourceUrl(resource: BudgetResource): string {
  return `https://${PUBLISHER_HOST}/dataset/${PUBLISHER_DATASET_ID}/resource/${resource.id}/download/${resource.file}`;
}

/** Prevent host or path changes from turning the fixed publisher fetch into an open URL fetch. */
export function isAllowedBudgetUrl(value: string, resource: BudgetResource): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === PUBLISHER_HOST
      && url.port === ""
      && url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === ""
      && url.pathname === `/dataset/${PUBLISHER_DATASET_ID}/resource/${resource.id}/download/${resource.file}`;
  } catch {
    return false;
  }
}

export function budgetResourceForYear(year: number): BudgetResource | undefined {
  return BUDGET_RESOURCES.find((resource) => resource.year === year);
}
