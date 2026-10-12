# CCYod CMS Docker — brand

The container hexagon holds a light bulb whose glass is a **C** and whose filament is an **S**,
the idea-spark in MWIT yellow. Blue + yellow nod to MWIT; the S carries "CMS"; the hexagon is the
Docker node. Wordmarks are outlined from Chakra Petch, so nothing here needs a font installed.

| File | Use |
|------|-----|
| `icon.svg` | The mark. Single source for every raster icon. |
| `icon-maskable.svg` | Full-bleed square for maskable PWA and Apple touch icons. |
| `logo-horizontal.svg` | Mark + wordmark, for headers and documents. |
| `logo-stacked.svg` | Mark above wordmark, for square spaces. |
| `logo-mono-dark.svg` | One-ink lockup for light backgrounds. |
| `logo-mono-light.svg` | One-ink lockup for dark backgrounds. |

Brand colours: indigo `#6366F1`, ink `#18181B`, muted `#71717A`, MWIT yellow `#FACC15`.

## Regenerate the icons

```bash
cd admin-panel
bun run icons
```

`scripts/generate-icons.mts` reads `icon.svg` and `logo-horizontal.svg`, then writes PNG, WebP,
ICO and Apple touch assets into `admin-panel/src/app`, `admin-panel/public/brand`, the Rust
`ranking-web` board, and the Python `cms`/`cmsranking` static dirs. Edit the SVGs, rerun, done —
never hand-edit a generated file.
