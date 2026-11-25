# giftwrap

Wrap a gift, share a link, unwrap it in 3D. Static web app, no server: the whole gift lives in the link.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # codec and physics tests (Node, no browser)
npm run build    # static site in dist/
```

## How it fits together

| Path | What |
| --- | --- |
| `index.html`, `src/wrap/` | Wrap page: form, paper and ribbon options, Create |
| `open/index.html`, `src/open/` | Unwrap page: reads the link, runs the gift |
| `src/codec/` | Gift to and from the URL fragment (packed bytes, base64url, checksum) |
| `src/sim/` | Physics: paper, ribbon, ornaments, lid. No DOM, no three.js |
| `src/scene/` | three.js rendering, patterns, input, celebrations |

Links look like `/open/#<payload>`. The fragment never reaches the server, but anyone with the link can read the gift, code included.

Design notes and decisions: [docs/proposal.md](docs/proposal.md).

## Deploy

`.github/workflows/pages.yml` tests, builds and publishes `dist/` to GitHub Pages on every push to `main`. In the repository settings, set Pages to deploy from GitHub Actions.
