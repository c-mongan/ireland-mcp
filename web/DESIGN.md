# Ireland MCP web design

## Purpose and voice

Make the product understandable in ten seconds: connect an AI assistant to Irish
public data, ask a question, and inspect the source. The voice is civic, practical
and curious. Write for someone who has never heard of MCP: short sentences, plain
words, no internal terms such as "operation", "toolset" or "endpoint" in headings.
Explain MCP once, in the FAQ. The hero line is "Ask AI about Ireland. See the
source." Keep it to two short lines so the live playground stays near the fold. This is a community-built read-only connector, not an official
government service or an AI answer engine.

The visual reference is a public-data observatory: a green, cinematic opening
followed by clear, inspectable documentation. An interactive Irish tricolour cube sits beside the headline without a card, rotating continuously through 360 degrees in ~18 seconds, with drag and arrow-key controls for rotation and tilt.
The real ChatGPT demo has a visible, clickable poster preview in a separate proof row beside the live service summary. No remote imagery or font
dependencies are needed.

## Layout and hierarchy

- The hero explains the connection to Irish public data in plain language with an editorial two-line headline.
  The cube is decorative, unboxed, not a signal of live data. Its server summary and
  compact counts sit in a separate strip.
- The live playground follows the hero, so visitors can inspect data before
  installation. Static VS Code and Cursor links still provide quick entry in
  the installation section; the app-generated tabs retain all setup options.
- A three-step ordered diagram explains the discovery/call/citation flow.
  Retrieval time is explicitly distinguished from publication time.
- Machine-readable documentation keeps all existing URLs and its section anchor.
- Agent setup shows a copyable request beside a three-step guide. The request asks
  the coding agent to read the client guide, preserve existing configuration and
  verify with a real catalogue call. Keep it visible without JavaScript. The copy
  action has its own live status and sends no analytics. Codex has a client tab
  with separate add, configuration check and connection check instructions.
  The static installer contains a Codex command before scripts load.
- New source examples use the existing result tables: Galway tourism listings,
  Heuston static stops and a Dublin groundwater point. Keep their publisher dates,
  download dates, source scope and unknown values visible. Static stops must not
  imply current services; groundwater categories must not imply engineering approval.
- The live playground comes before the source directory. Sample buttons load
  real request settings. They do not run the request. Their selected state follows
  the example selector, and keyboard focus moves to that selector after loading.
- Keep the request and response visually separate. The response has an accessible
  name and guidance on source metadata and dates. Raw results stay visible.
- A deterministic result preview uses documented fields for the seven examples.
  It shows publisher, safe HTTP(S) source URL, licence and retrieval time. Cached,
  stale, partial and truncated flags remain visible. Unknown or malformed data
  receives a raw-response fallback. Missing values never become zero.
- The rent example shows historical registered-tenancy statistics, not current
  asking rents. In RIQ02, zero means insufficient published data. Preserve that
  distinction. Live result rendering must not contain a fixed rent value.
- The main 35-second demo shows edited real ChatGPT Work screenshots
  from 10 October 2026, with the Ireland Open Data plugin selected. Its transcript contains the recorded value and period,
  and distinguishes registered tenancies from asking rents. It does not replace
  the live response. A separate link retains the
  earlier website playground demo and its VTT captions.
- Sources use a scannable directory. Subject navigation comes from the returned
  catalogue and links to the existing domain heading IDs. Do not add fixed links
  that assume every subject is present in the live catalogue.
- Status exposes upstream failures and freshness rather than promising uptime.
- Section order: hero, live playground ("What can I ask?" sample questions),
  setup in three numbered steps, how it works, trust ("Built to be checked":
  official sources, read-only, privacy, open source), agent setup, source
  directory, legal beta, FAQ, status. The header links Try it, Set up, Sources
  and FAQ; the footer links status, privacy and feedback.
- Trust copy must stay true to PRIVACY.md: argument values and results are never
  logged, but tool, source, client and timing telemetry is. Do not claim "no
  tracking" or "only counts".
- The legal beta section (`#legal-beta`) states that it is off on the hosted
  server, is not legal advice, covers only annual leave and working time, uses
  Act text as passed in 1997, and that Citizens Information blocks automated
  access. Do not describe it as available until the hosted pilot passes its
  deployment check. See `docs/legal-beta-assessment.md`.
- The FAQ uses native `<details>` with 44px summaries and needs no JavaScript.
  Each new section stays a static block; do not add fixed counts to prose.

## Design tokens

Dark is the stylesheet fallback. Light styles are scoped to
`html[data-theme="light"]`. JavaScript owns the saved theme choice and initial
preference. The cinematic hero keeps its own fixed dark palette in both themes to
preserve contrast around the tricolour artwork.

| Role | Dark | Light |
| --- | --- | --- |
| Page | `#0c1712` | `#f4f8f5` |
| Surface | `#14241b` | `#ffffff` |
| Main text | `#f0f6f2` | `#152d20` |
| Secondary text | `#b6c9bd` | `#45604e` |
| Brand / links | `#a4e8bf` | `#226b3e` |
| Error text | `#ffb9ac` | `#a12e23` |

Keep the existing system sans-serif stack: deliberate large headline weight,
fluid sizing, and tight but legible tracking. Monospace is reserved for actual
code, endpoints and API operations. Section headings describe an outcome rather
than repeating small uppercase category labels.

Content width is capped at 1200px; paragraphs remain under 70 characters per line.
Panels use 12px corners, buttons 6px. Borders define controls and directory rows;
decorative shadows and glass panels are unnecessary.

## Accessibility and responsive behavior

- Preserve a single H1, meaningful section headings, form labels, skip link,
  keyboard tab semantics, status regions and all original IDs.
- Controls have at least 44px targets and visible 3px focus outlines.
- At 760px, the hero and playground become one column; the navigation wraps
  beneath the brand, and the live form appears before the question prompts.
  At 480px, directory entries, forms and question prompts stack.
  At 320px, headline sizing and code wrapping must stay within the viewport.
- Horizontal scrolling is local to the install tabs and code blocks. Tab padding
  leaves space for focus outlines.
- The cube rotates continuously through 360 degrees in approximately 18 seconds (ROTATION_PERIOD_MS = 18000), supports free yaw dragging and bounded pitch adjustment (-1.0 to 0.2 rad), arrow key navigation (left/right yaw, up/down pitch), and stops
  offscreen or in hidden tabs. A compact icon provides pause/resume, with an
  accessible name and tooltip. Reduced motion starts still and permits discrete steps. The video remains
  user-controlled. Content is visible without entrance animation.
- No-JavaScript installation fallback links to the existing agent guide.
- Keep advanced arguments in Query settings. Always show the result and request
  status, with distinct errors.
- Use the same full-width sample buttons for pointer and keyboard input. Do not
  send a live request when a user selects a sample. The explicit submit button is
  the only way to run a playground request.
- Clear the previous response when the selected example or advanced arguments
  change. Disable query fields and sample controls during a pending request.
  Keep the submitted source and operation next to the result. Show loading,
  source errors and invalid JSON as separate states.
- Keep complete raw response text in `#pg-output`, inside the keyboard-accessible
  Raw response disclosure. Array previews show at most five rows per table.
- Keep usage metrics optional. The footer control states whether metrics are on
  and explains what is sent. Do not send query text, arguments or results.

## Integration contracts and verification

`app.js` owns installer rendering, query execution, source discovery, live counts,
status, video playback and the theme-toggle behavior. Retain styles for generated
classes: `install-actions`, `domain-group`, `source-grid`, `source-card`,
`source-meta`, `example`, `status-main`, `status-ok`, `status-bad`, and
`status-sources`. The theme button ID is `theme-toggle`; its action label must
describe the next theme, and `aria-pressed` represents whether dark mode is on.

Do not imply that a healthy service means every source is current. Treat old
status reports as stale; display every source returned by the status feed. Show
provider errors and missing setup separately. A refused provider request remains
a failure. Preserve the exact community-project disclaimer.

Read-only MCP requests allow 30 seconds per attempt for cold starts and retry
once on a timeout or network failure, including interrupted response bodies.
After that, show friendly retry guidance instead of browser transport errors.
Do not retry HTTP, JSON-RPC, tool or malformed-response errors automatically.

Verify with `npm run test:e2e`, desktop and 320px mobile inspection in both themes,
and one live browser query on an allowed origin. Browser tests use mock data and
do not prove upstream availability. Social-preview metadata should reference only
real shipped assets.

## Recorded demo player

The hero control opens a native dialog. The ChatGPT video has native playback
controls, English captions and a plain transcript. It never autoplays. Assign
video and caption URLs only on first open; use `preload="none"`. The small
poster preview can load before playback. Escape
and Close pause playback and restore focus to the opener. Try it live closes the
dialog, loads the rent example and focuses the playground selector without
submitting a request. If a query is pending, leave its settings unchanged.

Without JavaScript or native dialog support, the panel stays inline. Its direct
video link, transcript and source link remain available. The modal scrolls
within the viewport at 320px. Media failure gives a visible message and leaves
the transcript and live-query link available. No demo action sends analytics.

The transcript describes the natural-language question, the visible “Used
integration” status and the historical rent answer. It names CSO RIQ02, CC BY
4.0, the 10 October 2026 retrieval time and cached response. Do not imply that
ChatGPT Work exposes raw JSON, identifies an exact tool function or shows
continuous playback. The video is silent and captioned. The website installer
uses the current Plugins → Add custom MCP server → Install → Work → @plugin
flow and links to the official OpenAI quickstart.

## October 2026 reference study

Reviewed Resend, Vapi, Supabase, Firecrawl and PostHog homepages. Apply their clear product explanation, strong visual hierarchy, direct product trial and distinct identity. Do not copy assets or add unverified social proof. The header and hero share a dark foundation; the tricolour cube is the main visual object. A larger real-video preview and service summary share a proof row. Keep motion details out of product copy; the cube hint only explains the interaction.
