export const METRIC_FIELDS = [
  "mean_hourly_gap", "median_hourly_gap", "mean_bonus_gap", "median_bonus_gap", "mean_hourly_gap_part_time",
  "median_hourly_gap_part_time", "mean_hourly_gap_part_temp", "median_hourly_gap_part_temp", "percentage_bonus_paid_female",
  "percentage_bonus_paid_male", "percentage_bik_paid_female", "percentage_bik_paid_male", "q1_female", "q1_male",
  "q2_female", "q2_male", "q3_female", "q3_male", "q4_female", "q4_male", "percentage_employees_female",
  "percentage_employees_male", "board_exec_female", "board_exec_male", "board_non_exec_female", "board_non_exec_male"
] as const;

export const ANNOTATION_FIELDS = ["late_filing", "report_removed", "govt_employer_removed", "data_missing", "incomplete", "quartile_error", "no_narrative", "notes"] as const;
type Metric = number | string | null;
export type PayGapReport = {
  source_row: number;
  company_name: string;
  nace_section: string;
  nace_letter: string;
  nace_division: string;
  company_site: string | null;
  report_link: string | null;
  report_year: number;
  metrics: Record<(typeof METRIC_FIELDS)[number], Metric>;
  /** Published strings preserve source flags; null means the selected export has no annotations. */
  annotations: Record<(typeof ANNOTATION_FIELDS)[number], string | null>;
};

export const metricValue = (raw: string): Metric => {
  if (raw.trim() === "") return null;
  const value = raw.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return raw;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : raw;
};
