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
- Installation is the first section. Static VS Code and Cursor links provide
  quick entry; the existing app-generated tabs retain all setup options.
- A three-step ordered diagram explains the discovery/call/citation flow.
  Retrieval time is explicitly distinguished from publication time.
- Machine-readable documentation keeps all existing URLs and its section anchor.
- The live playground comes before the source directory. Example questions are
  prompts, never invented responses or claims about live conditions.
- Sources use a scannable directory, not a grid of interchangeable cards.
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

Verify with `npm run test:e2e`, desktop and 320px mobile inspection in both themes,
and one live browser query on an allowed origin. Browser tests use mock data and
do not prove upstream availability. Social-preview metadata should reference only
real shipped assets.
