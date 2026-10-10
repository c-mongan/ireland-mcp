# Product demonstration videos

The public `web/media/rent-demo.mp4` is a 35-second edit of actual browser still captures from 10 October 2026. It is not a continuous screen recording. Its edit duration does not measure query latency. It has no audio, generated interface, synthetic result, or generative-model footage.

The clip shows a real hosted request for CSO table [RIQ02 — RTB Average Monthly Rent Report](https://data.cso.ie/table/RIQ02). The selected row is Galway City, two bedrooms, apartment, 2025Q4. It reports **€1,672.57 per month**. These are historical registered-tenancy statistics. They are not current asking rents or a measure of every rental property.

Attribution: Central Statistics Office, Ireland (`www.cso.ie`), licensed under **CC BY 4.0**, as stated in the returned evidence. The underlying table is the RTB Average Monthly Rent Report. The official table showed an update date of **14 May 2026**. The site displayed retrieval at **10 October 2026, 18:19 UTC** and a cached response. Publication, statistical period, retrieval and capture dates have different meanings.

## Public edit

| Time | Actual capture or editorial card | Meaning |
| --- | --- | --- |
| 0–4 seconds | Website opening | Try a read-only request in the browser |
| 4–10 seconds | Selected request, cropped | Galway City, two-bed apartment, 2025Q4 |
| 10–15 seconds | Returned response, cropped | A real cached result; edit timing is not latency |
| 15–25 seconds | Published row and evidence, cropped | Recorded figure, source, licence and retrieval |
| 25–31 seconds | Official CSO table, cropped | RIQ02 title and published update date |
| 31–35 seconds | Clearly editorial end card | Try the request live |

The selected-request and returned-response views use two crops of the same completed-request capture. The edit does not pretend that it recorded every click. The result and source shots are crops of actual images; their pixels are not replaced with a new interface.

The public clip keeps its step titles and source/date labels in the image. Its full captions are separate in `web/media/rent-demo.vtt`, so native player captions do not duplicate burned text. `web/media/rent-demo-poster.jpg` uses a frame from the rendered result sequence. The website supplies default English captions, playback controls and a text transcript. It must not auto-play or preload the full video on page load. A direct MP4 download retains the titles and factual source imagery; use the VTT or transcript for the full narration.

The rent figure is fixed only in this dated demonstration. The live frontend derives its figures from each returned payload and must not use the video's figure as a fallback.

## Engineering edit

A separate 75-second `engineering-demo.mp4` is kept in the external artifact directory. It is not part of the website payload. It combines the same real product captures with a cropped actual Chromatic build summary and clearly labelled text summaries of verified telemetry evidence. It burns its captions for standalone viewing; a separate VTT is also retained.

The Chromatic proof is **build 15**, source release **174f07716c3e2a3fab25d93a44f72b73d268b82e**. The captured page shows **36 stories**, **40 visual tests** and **26 accepted changes**, with no unreviewed changes. These are recorded review facts. They do not describe a future build of the video feature. Deterministic Storybook fixtures do not prove upstream availability.

The PostHog evidence is a native exact-release readback for that same release. It confirmed five acceptance events: one query start, one successful completion, and three result actions (`inspect_raw`, `open_source`, `connect`). The connection event measures a control click after a displayed result. It does not prove installation. The dashboard had eight charts and labelled its test traffic. These records do not prove adoption, activation, retention or conversion.

The telemetry views are editorial text summaries of the checked receipt and safe property contract. They do not imitate a PostHog dashboard or claim to be dashboard screenshots. They contain no account sidebar, personal email, token, private query, result payload, IP address or browser identifier. Safe property sets exclude query text, arguments, results and URL payloads. Browser collection requires explicit opt-in and uses a page-only identity. The verified events disable person-profile processing and geolocation.

## Reproduce without new dependencies

`scripts/render-site-demo.py` uses Python, the already installed Pillow library, installed FFmpeg/FFprobe and an installed system font. It does not drive a browser, download media, install a font, call a provider, or fabricate screenshots. Pillow fits the actual captures inside the frame and adds editorial text bands; FFmpeg encodes them. The renderer requires a manifest and the actual capture files. Capture them through the authorized browser tool before rendering.

A manifest has `duration`, `captured_at`, `poster_at`, `provenance`, and an ordered `steps` array. Set the boolean `burned_captions` to `false` for the public clip and `true` for the standalone engineering clip. Each step has positive `seconds`, a `label`, and a `caption`. A capture step names an actual image path and may specify a crop as `[x, y, width, height]` in source pixels. A step without a capture is an editorial card. Its optional `body` is explicit editorial text. The declared duration must equal the sum of the step durations. At least one real capture is required.

Before a render, check `agent-storage status`. Use verified external storage for the manifest, captures and a new empty scratch directory. The renderer refuses existing output paths and nonempty scratch directories so it preserves earlier work. Do not put private screenshots or receipts in the public repository.

```bash
agent-storage run -- /absolute/path/to/python3 scripts/render-site-demo.py \
  --manifest /verified/external/path/rent-demo.json \
  --output /verified/external/path/rent-demo.mp4 \
  --captions /verified/external/path/rent-demo.vtt \
  --poster /verified/external/path/rent-demo-poster.jpg \
  --scratch /verified/external/path/new-empty-render-directory \
  --ffmpeg /absolute/path/to/ffmpeg \
  --ffprobe /absolute/path/to/ffprobe
```

Only copy reviewed public assets into `web/media/`. The renderer checks 1280×720 H.264, YUV 4:2:0, duration and a 5,000,000-byte budget. It uses 24 frames per second and the `faststart` container flag. It performs a full decode and saves metadata, capture hashes, crop coordinates and an output hash in a private scratch receipt. It also creates a six-frame contact sheet for visual inspection. Browser playback, captions and lazy loading need separate website verification.

Keep raw captures, manifests, receipts, contact sheets and the engineering edit in the checked external artifact directory. The committed video is the dated public demonstration only. A future refresh needs new source checks and browser captures; changing an overlay alone does not refresh the evidence.
