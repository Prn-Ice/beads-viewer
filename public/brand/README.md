# Beads Brand Assets

Verified against https://beads.gascity.com/ and upstream on 2026-09-08.
These assets identify Beads; View Beads remains an independent local dashboard.
No endorsement or trademark rights are implied by the source licenses.

## Images

- `beads.svg`: unchanged `docs/images/logo.svg` from [gastownhall/beads](https://github.com/gastownhall/beads/blob/c0d8da42de5fd15c95adac85e342ba4a121da0fb/docs/images/logo.svg).
- `src/app/favicon.ico`: unchanged [site-generated favicon](https://beads.gascity.com/mintlify-assets/_mintlify/favicons/beads/cJ_miYdT2liAG70b/_generated/favicon/favicon.ico), derived from the official mark.
- `src/app/apple-icon.png` (180px), `icon-192.png`, and `icon-512.png`: local PNG derivatives of `beads.svg`, not upscaled favicon copies. Rendered in Chromium at 1024px with the SVG's system sans-serif font, then downsampled with Sharp's Lanczos3 filter. The original teal and white artwork is unchanged; the rounded corners are flattened onto the light background `#f9fbfa` for opaque home-screen images. These are ordinary icons, not maskable safe-area artwork.
- Upstream repository license: MIT, copyright 2025 Beads Contributors. Included in `BEADS-LICENSE.txt`.
- The logo's teal `#25c2a0` is intentional and differs from the site's green UI accent; the SVG is not recolored for themes.

## Typography

The live site's CSS explicitly selects Paper Mono for both body and headings
(`--font-family-body-custom` and `--font-family-headings-custom`). Inter is
also preloaded by Mintlify but is not the configured body/heading font.

Typography keeps the site's 16px body baseline with a smaller dashboard heading
scale: 24px project titles, 18px column headings, and 20px drawer titles.
Headings use weight 600 and -0.025em letter spacing; compact dashboard controls
and issue metadata retain their smaller sizes.
The site's `cv02`, `cv03`, `cv04`, and `cv11` font-feature settings are enabled
for UI text, with default features for code.

`paper-mono.woff2` is an unchanged copy of the [live site's variable font](https://beads.gascity.com/mintlify-assets/_next/static/media/PaperMono_Variable.p.aa32f7a0.woff2),
SHA-256 `ca2fbd40c7f5c39cc00fb8d754ca542079841477d36febd502137ab61a70a1fb`.
It is self-hosted through `next/font/local`; no CDN requests are needed at runtime
or build time. This site build differs from the current upstream font binary.

[Paper Mono](https://github.com/paper-design/paper-mono) is by Paper Design
(Lost Coast Labs), based on Geist Mono. Its SIL Open Font License 1.1 is included
verbatim in `PAPER-MONO-LICENSE.txt`, verified against upstream
[`LICENSE.txt`](https://github.com/paper-design/paper-mono/blob/9fbc4d9877798252494ad517a5db9ee89f4fd972/LICENSE.txt).

## UI Tokens

The official [docs.json](https://github.com/gastownhall/beads/blob/c0d8da42de5fd15c95adac85e342ba4a121da0fb/docs/docs.json)
specifies the Linden theme and green `#2e8555`, light `#3cad6e`, dark `#29784c`.
The live page's inline CSS supplies backgrounds `#f9fbfa` / `#0b0e0e`,
green-tinted gray surfaces, and 4px corners. These inform `src/app/globals.css`.
Subtle selection surfaces are dashboard adaptations, not claimed official tokens.
Neutral uses this Beads palette; Ocean, Forest, and Rose remain user overrides.
