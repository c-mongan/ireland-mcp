# Ireland MCP web design

This page helps people connect an agent, try a query and understand the data sources. Use the existing green identity with solid dark surfaces and high-contrast text. Typography and spacing must make the form easy to read on a laptop or phone.

- Use the system sans-serif family for interface text and monospace for JSON.
- Keep body text at 16px. Keep section headings smaller than the main heading.
- Put the playground before the dynamic source directory to keep its deep link stable.
- Keep advanced arguments in the Query settings disclosure. Always show the result and request status.
- Use source rows with clear headings. Avoid nested cards. Preserve the original background video and expressive hero typography. Use a dark overlay behind hero text and opaque surfaces behind forms and source rows. Provide a pause control, pause in hidden tabs, and default to paused when reduced motion is requested.
- Keep labels, focus indicators, keyboard tab controls and error states visible.
- Treat old status reports as stale; display every source returned by the status feed. Show provider errors and missing setup separately. A refused provider request must remain a failure.

Verify with `npm run test:e2e`, desktop and mobile inspection, and one live browser query on an allowed origin. Browser tests use mock data and do not prove upstream availability.
