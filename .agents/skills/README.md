# Repository design and review skills

Installed on 6 October 2026 from the existing local skill installations at the user's request.

- `impeccable` 3.9.1: layout, typography, accessibility and UI refinement. Copied from the installed Impeccable skill without enabling hooks or auto-updates. Local security patches replace shell command construction in `scripts/lib/is-generated.mjs` and `scripts/live.mjs` with argument-based execution. The regression test is `test/skill-safety.test.ts`.
- `open-code-review-delegate` 1.0.0: OCR file selection and rule resolution, followed by a host-performed source review. Copied from the installed Alibaba Open Code Review plugin.

These are development guidance, not application dependencies. Their bundled third-party scripts are excluded from the application's ESLint configuration and Function deployment. Existing application checks remain enabled. Run helper scripts only for an authorised task and inspect their effects first. No hooks were installed.

Licences and notices are preserved alongside each skill. Impeccable and Open Code Review use Apache-2.0. Impeccable's upstream `NOTICE.md` describes platform reference material; its MIT licence is in `LICENSE-platform-design-skills`. The bundled modern-screenshot code uses the MIT licence in `LICENSE-modern-screenshot`.

Licence sources checked on 6 October 2026: [Impeccable](https://github.com/pbakaus/impeccable), [Open Code Review](https://github.com/alibaba/open-code-review), [platform-design-skills](https://github.com/ehmo/platform-design-skills), and [modern-screenshot](https://github.com/qq15725/modern-screenshot). Local modifications are marked in the modified files.
