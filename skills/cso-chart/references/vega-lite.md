# Vega-Lite templates for cso-chart

Fill `data.values` with rows shaped `{ "period": "2022", "series": "Galway", "value": 277737 }`.

## Line (time series)

```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "title": "<Table title> (<code>)",
  "data": { "values": [] },
  "mark": { "type": "line", "point": true },
  "encoding": {
    "x": { "field": "period", "type": "ordinal", "title": "Period" },
    "y": { "field": "value", "type": "quantitative", "title": "<unit>" },
    "color": { "field": "series", "type": "nominal" }
  }
}
```

## Bar (areas or categories)

```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "title": "<Table title> (<code>), <period>",
  "data": { "values": [] },
  "mark": "bar",
  "encoding": {
    "y": { "field": "series", "type": "nominal", "sort": "-x", "title": null },
    "x": { "field": "value", "type": "quantitative", "title": "<unit>" }
  }
}
```

Add a caption under the chart: "Source: CSO, table <code> (CC BY 4.0)".
