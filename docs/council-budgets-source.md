# Local authority budget source

## Source

The source is the Department of Housing, Local Government and Heritage dataset, [Local Authority and Regional Assembly Annual Budgets](https://data.gov.ie/dataset/local-authority-and-regional-assembly-annual-budgets). The downloadable workbooks are on the department's open data site. The dataset is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

The source manifest records the resource IDs, formats, and last-modified dates returned by CKAN on 2026-10-25. The tool does not query the catalogue for new years or changed resource IDs at runtime. The workbooks include XLS and XLSX files. The SheetJS parser reads both formats.

## Coverage

| Budget years | Status | Notes |
| --- | --- | --- |
| 2013–2014 | Listed, unsupported | These workbooks use a different authority structure. The get operation returns an error with the reason. |
| 2015–2016, 2018–2026 | Supported, complete | The workbooks contain service divisions A–H and council expenditure and income rows. |
| 2017 | Supported, partial | Some division tables omit councils. The workbook also has 124 unlabeled numeric values that the tool omits. |

The detailed service division sheets cover city and county councils. The workbooks also include regional assembly figures in national summary tables. This source does not return regional assembly rows.

Some 2017 workbook tables omit council rows. The parser checks each table against its observed row count: Division A 31/31 in all three tables; B 31/31 in all three; C 30/31 in both; D 30/31, 30/31, 31/31; E 30/31, 31/31, 31/31, 31/31; F and G 31/31 in both; H 31/31 in all three. The tool reports this source gap and does not fill missing council rows with zero.

Two 2017 Division B tables contain 124 numeric values without budget line labels. They are in columns K:L of the first table and M:N of the third table, with 62 values in each pair. The tool omits them because it cannot verify what they measure. It does not treat them as totals. The year listing and data response mark 2017 as partial.

The 2015 workbook uses two labels for Dún Laoghaire-Rathdown County Council. Queries by the canonical council name return both sets of detailed rows. Each returned row keeps its original `source_authority` value. The service division total stays excluded, so detail rows do not double count it. The parser also preserves a blank amount as `null` and keeps a published numeric zero as `0`.

These figures are adopted budget estimates. They are not actual expenditure or income. Amounts use EUR. The parser checks the workbook's budget year, EUR unit labels, table headings, and council rows. It rejects malformed files, changed layouts, non-numeric amounts, and other unit scales. It skips workbook total and subtotal rows to prevent double counting.

## Tools

- `council_budgets_list_years` lists all 14 resources. It marks the unsupported years and gives the source resource URL and source last-modified date.
- `council_budgets_get` returns rows for a year and council. It can filter by division A–H. Each row has a division, budget line, measure (`Expenditure` or `Income`), amount, and unit.

The get operation returns up to 30 rows by default and up to 500 per page. Use `offset` and the returned `next_offset` to read the next page. The operation reports the total matching row count and marks the result as truncated when more rows remain. Both the year listing and data response mark incomplete source coverage. Parsed workbooks are cached for one day. A fresh cache entry is shared across requests for the same year.

The workbook fetch uses a fixed publisher host and resource path from the manifest. It has a 5 MiB download limit. The parser accepts only XLS or XLSX file signatures and limits workbook worksheet count and cell dimensions.

## Validation evidence

The checked fixtures are unmodified 2015, 2016, and 2017 XLS and 2026 XLSX workbooks downloaded from the official publisher. The parser reads the sample Carlow Council rows from XLS and XLSX. For 2015, a query by the canonical Dún Laoghaire-Rathdown name returns 11 detailed Division A lines and preserves the two source labels. For 2026, the precise amount sum for the first Division A line is €496,283,851.92; this rounds to the workbook's printed total of €496,283,852. Tests also cover bad file bytes, unit and header changes, malformed amounts, missing values, zero values, unsupported years, URL allowlisting, cache reuse, source gaps, and result paging.
