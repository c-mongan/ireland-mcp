# Ireland cube accent

This local design adapts Conor Mongan's independent Signal cube study. It uses the study's cube-corner geometry and rotation, with green, white and orange bands. No Abnormal logos, proprietary models, fonts or scripts are used. The figure is decorative; it does not represent live source status or data traffic.

The hero remains focused on a live query. The accent sits beside the headline without a card frame. Live status and source counts sit in a separate strip. On narrow screens, the art becomes a compact row. The server endpoint is visible in the installation section. It does not add a full-screen background, glyph wall, simulated security signals or dependencies.

`web/ireland-cube-geometry.js` supplies deterministic faces. `web/ireland-cube.svg` is the static fallback generated from those faces. `web/ireland-cube.js` renders the canvas only when available. The SVG remains visible without JavaScript or canvas support. Storybook embeds the same SVG as a data URL under its existing content security policy.

Motion is on at a calm speed by default and can be paused or resumed via a compact icon button with an accessible name and tooltip. Users can also interact directly with pointer drag or touch drag at any time. Touch scrolling vertically (`touch-action: pan-y`) remains unimpeded. With reduced motion, the cube starts static and allows deliberate interaction or discrete rotation per button press. Animation automatically stops while offscreen or when the document tab is hidden. These controls are keyboard-accessible, and the figure has a descriptive accessible name. No telemetry is added.

Run the existing website and Storybook suites plus `tests/e2e/cube.spec.ts`. The normal live-preview CORS boundary still applies: arbitrary localhost origins cannot call the hosted MCP. This change does not modify that policy.
