# Nook

Nook is a Chromium browser extension that adds small quality-of-life features powered by AI that runs entirely on your own machine, through WebGPU. Page content never leaves the device; the only network use is downloading model files.

Planned features:

- **Page translation:** translate a selection or a whole page in place, keeping links and layout, into many more languages than today's offline translators support.
- **Tab grouping:** sort open tabs into named, coloured native tab groups, on request only.
- **Duplicate tabs:** find and close duplicate tabs, with undo.

Nook targets [Helium](https://helium.computer/) first and aims to work in other Chromium browsers. It is built to be ready for the Chrome Web Store.

## Status

Discovery and [Nook Bench](bench/README.md), the harness that measured on-device model hosting, speed and translation quality, are done. The extension is being built in the phases of [docs/plan.md](docs/plan.md). It now has its tab tools, which need no model (group tabs by site, close duplicate tabs, undo the last change), and Translate selection, which downloads a model once from the settings page.

```sh
npm run build      # fetch the packaged model libraries, then build Nook to extension/.output/chrome-mv3 (load it unpacked)
npm run zip        # same, plus a zip for the store
npm test           # unit tests
npm run test:e2e   # build, then load Nook (with a fake model) and the bench in headless Chromium
npm run test:smoke # slow: download the real 0.8B model and translate with it in headless Chromium
npm run check      # Biome and TypeScript
```

See [CLAUDE.md](CLAUDE.md) for the rules that apply to all work in this repo, [docs/architecture.md](docs/architecture.md) for the current design, and [docs/discovery-brief.md](docs/discovery-brief.md) for the starting context and open questions.

## License

[MIT](LICENSE)
