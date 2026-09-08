# Branding Implementation

- [x] Inspect existing work and preserve cursor/color-theme fixes.
- [x] Verify official site, upstream assets, licenses, and installed Next.js docs.
- [x] Finish branded navigation and responsive dashboard controls.
- [x] Document asset provenance and refresh desktop/mobile screenshots.
- [x] Run lint, production build, unit tests, and browser journeys.

## Verification

- `nix develop -c npm run lint`: passed.
- `nix develop -c npm run build`: passed; also rebuilt by the final E2E run.
- `nix develop -c npm test`: 14 tests passed.
- `nix develop -c env CI=1 UPDATE_SCREENSHOTS=1 npm run test:e2e`: 14 tests passed.
- `git diff --check`: passed.
- Inspected light/dark desktop, theme menu, and desktop/mobile drawer screenshots.
- Browser coverage: Chromium with fixture CLI data, desktop 1440px and responsive
  widths 360px, 390px, and 768px. Includes local font/image loading, no external
  asset requests, theme persistence, keyboard opening/focus restoration, mobile
  search/project switching, and drawer overflow checks.
- Not verified on physical devices, Firefox/WebKit, or a live `bd` installation.
- An intermediate parallel lint run raced Playwright's `test-results` cleanup;
  the final lint run was performed after Playwright and passed.
- Existing Vite configuration warning remains unrelated to branding.
