# Nook

Nook is a Chromium browser extension that adds small quality-of-life features powered by AI that runs entirely on your own machine, through WebGPU. Page content never leaves the device; the only network use is downloading model files.

Planned features:

- **Page translation:** translate a selection or a whole page in place, keeping links and layout, into many more languages than today's offline translators support.
- **Tab grouping:** sort open tabs into named, coloured native tab groups, on request only.
- **Duplicate tabs:** find and close duplicate tabs, with undo.

Nook targets [Helium](https://helium.computer/) first and aims to work in other Chromium browsers. It is built to be ready for the Chrome Web Store.

## Status

Discovery is done. The first code is [Nook Bench](bench/README.md), a test harness that measures on-device model hosting, speed and translation quality on real hardware before the extension itself is built. See [CLAUDE.md](CLAUDE.md) for the rules that apply to all work in this repo, [docs/architecture.md](docs/architecture.md) for the current design, and [docs/discovery-brief.md](docs/discovery-brief.md) for the starting context and open questions.

## License

[MIT](LICENSE)
