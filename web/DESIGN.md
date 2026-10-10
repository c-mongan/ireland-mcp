# Ireland MCP web design

## Purpose and voice

Make the product understandable in ten seconds: connect an AI assistant to Irish
public data, ask a question, and inspect the source. The voice is civic, practical
and curious. This is a community-built read-only connector, not an official
government service or an AI answer engine.

The visual reference is a public-data observatory: a green, cinematic opening
followed by clear, inspectable documentation. The original city-timelapse video
stays in the hero; it is explicitly described in the footer as AI-generated and
not a real Irish location. No new remote imagery or font dependencies are needed.

## Layout and hierarchy

- The hero pairs the product promise with a question and an honest connection
  diagram. Its server summary remains live, but counts are compact information
  rows rather than oversized marketing metrics.
- The live playground follows the hero, so visitors can inspect data before
  installation. Static VS Code and Cursor links still provide quick entry in
  the installation section; the app-generated tabs retain all setup options.
- A three-step ordered diagram explains the discovery/call/citation flow.
  Retrieval time is explicitly distinguished from publication time.
- Machine-readable documentation keeps all existing URLs and its section anchor.
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
  distinction. The frontend must not contain a fixed rent value.
- Sources use a scannable directory. Subject navigation comes from the returned
  catalogue and links to the existing domain heading IDs. Do not add fixed links
  that assume every subject is present in the live catalogue.
- Status exposes upstream failures and freshness rather than promising uptime.

## Design tokens

Dark is the stylesheet fallback. Light styles are scoped to
`html[data-theme="light"]`. JavaScript owns the saved theme choice and initial
preference. The cinematic hero keeps its own fixed dark palette in both themes to
preserve contrast over moving imagery.

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
- The video has an explicit pause/play control. JavaScript respects reduced
  motion and pauses in hidden tabs; CSS disables entrance motion and smooth
  scrolling when requested. Content is visible without entrance animation.
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
