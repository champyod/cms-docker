# Countdown character art

Three expressions of one character, drawn by **Pablo Stanley** for
[Open Peeps](https://www.openpeeps.com/) and released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) — public domain, so no
attribution is required and commercial use is unrestricted.

Generated with [DiceBear](https://www.dicebear.com/styles/open-peeps/) (MIT code),
`open-peeps` at 10.x, so the files are reproducible from these requests:

| File | Query |
| --- | --- |
| `waiting.svg` | `?seed=Countdown&size=512&expressionVariant=calm` |
| `hurry.svg` | `?seed=Countdown&size=512&expressionVariant=awe` |
| `ended.svg` | `?seed=Countdown&size=512&expressionVariant=eyesClosed` |

Base URL: `https://api.dicebear.com/10.x/open-peeps/svg`

They are referenced from `src/app/globals.css` per countdown stage. To swap the
character, keep the same three file names, or change the `url()` rules there.
