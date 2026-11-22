# CCYod CMS Docker — brand

The container hexagon holds a light bulb whose glass is a **C** and whose filament is an **S**,
the idea-spark in MWIT yellow. Blue + yellow nod to MWIT; the S carries "CMS"; the hexagon is the
Docker node. Wordmarks are outlined from Chakra Petch, so nothing here needs a font installed.

This directory is the single source of truth. Every favicon and logo the services serve is derived
from it by `admin-panel/scripts/generate-icons.mts`; the derived files stay committed so the images
need no Node at build, and `make icons-check` fails when any of them drifts from this source.

| File | Use |
|------|-----|
| `icon.svg` | The mark. Single source for every raster icon. |
| `icon-maskable.svg` | Full-bleed square for maskable PWA and Apple touch icons. |
| `logo-horizontal.svg` | Mark + wordmark, for headers and documents. |
| `logo-stacked.svg` | Mark above wordmark, for square spaces. |
| `logo-mono-dark.svg` | One-ink lockup for light backgrounds. |
| `logo-mono-light.svg` | One-ink lockup for dark backgrounds. |

Brand colours: maroon `#7A2439`, ink `#1C1B1F`, muted `#5D5F65`, white `#FFFFFF`.

The mark is **two colours only** — a maroon hexagon and a white glyph, with the `S` filament in the
glyph colour so it stays visible (in the old yellow it would read as the `warning` status colour the
admin panel now reserves). On a dark surface the mark inverts to a `#F8ACB7` badge with a `#7A2439`
glyph, because the maroon badge alone measures 1.84:1 against `#171613`.

The glyph is centred on its **ink mass**, not its bounding box: at the old offset the box looked
centred while the mass sat 10.6 units high, which read as floating.

## Derive the icons

```bash
make icons         # rewrite every served favicon and logo
make icons-check   # fail when one no longer matches this source
```

Targets: `admin-panel/src/app` (Next file conventions) and `admin-panel/public/brand` (manifest),
the Rust `ranking-web/static/img`, and the Python `cms/server/static` and `cmsranking` dirs. Edit an
SVG here, run `make icons`, commit — never hand-edit a derived file.
