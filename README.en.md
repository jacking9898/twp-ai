<p align="center"><img src="src/icons/reading.png" width="96" alt="页渡 · Yedu"></p>

# Yedu (页渡) — Bilingual Translation

**Across languages, one page at a time.**

[简体中文](readme.md) · **English**

Read webpages alongside their original text, compare multiple translation services, and customize your own AI models with experts, writing styles and glossaries.

**页渡 · Yedu is an independent fork of [TWP — Translate Web Pages](https://github.com/FilipePS/Traduzir-paginas-web), maintained by jacking9898.** Thanks to FilipePS and upstream contributors. This project is not affiliated with upstream TWP or Immersive Translate. Their store extensions, accounts and paid services are separate products.

[Releases](https://github.com/jacking9898/twp-ai/releases) · [Issues](https://github.com/jacking9898/twp-ai/issues) · [Privacy policy](PRIVACY.md) · [Build instructions](build-instructions.md)

## Personal project and disclaimer

**This is a personal Vibe Coding project.** The maintainer builds on open-source work and uses AI assistance to write, modify and debug code for personal learning, experimentation and sharing. Features are evolving, and existing tests cannot cover every webpage, document or service combination. Undetected bugs and compatibility issues may remain.

The project is provided as is, without a promise of fully accurate translations, uninterrupted availability or suitability for a particular purpose. Check important translations against the original and back up important files and settings before use. Fees and limits for APIs you configure are determined by their providers. See the [privacy policy](PRIVACY.md) for data sent to translation services and local storage behavior.

Changes in this fork are maintained by this project's maintainer; they do not represent a release, endorsement or guarantee from upstream authors or third-party providers. AI-assisted development does not change the licensing or attribution requirements of existing code and data. This statement does not replace [LICENSE](LICENSE) or the [third-party notices](THIRD_PARTY_NOTICES.md).

## Features

| Feature | Current support |
| --- | --- |
| Webpage translation | Paragraph-level bilingual reading and original-text restoration; preserves links, code, formulas and page interactions where possible |
| Translation services | Google, Microsoft and Yandex, plus your own OpenAI-compatible API providers |
| Text comparison | Paste text and compare services; three services requiring no extension API key are selected by default; add your configured AI models |
| Bilingual results | Original and translation paired by paragraph, translation-only mode, copying, TXT export and per-service retry |
| PDF documents | Original PDF on the left, translated text on the right; current-page or full-document translation; export completed pages as TXT |
| Other documents | UTF-8 TXT and SRT / VTT subtitles, available in the sidebar and standalone workspace |
| AI cache | Successful custom-AI translations stored locally for 7 days by default; configurable retention, clearing, disabling and forced fresh translation |
| Experts and styles | 44 inspectable expert presets and 10 styles; create, edit or delete your own experts, or save a modified copy of a preset |
| Glossaries | 31 built-in glossaries with 3,634 language-specific entries, plus personal glossaries; locale matching, relevant-term filtering and personal overrides |
| Page controls | Floating toolbar, control panel, paragraph hover translation and selected-text translation |

Expert prompts, writing styles and AI glossaries apply to AI models. Traditional services use their own translation logic. Availability and rate limits are controlled by providers; this project does not promise unlimited free access. You pay your own API provider directly.

PDF support currently requires a **text layer**. The original PDF preserves its layout; translations use source text coordinates with automatic vertical growth, optional bilingual text and TXT export, not as a newly typeset PDF. Scanned-document OCR, region recognition, live video subtitles, EPUB and DOCX are not implemented. Extraction order for complex columns, tables and formulas may require comparison with the original. Legacy external PDF tools use separate third-party websites and privacy policies.

## Install on Chrome / Edge

This repository is preparing its first independent release, `0.1.0`. No official browser-store listing is provided for this fork.

1. Download a published `Yedu_<version>_Chromium_MV3.zip` from Releases, or build from source if no release is available.
2. Extract it into a permanent directory.
3. Open `chrome://extensions` or `edge://extensions` and enable Developer mode.
4. Choose **Load unpacked** and select the extracted directory containing `manifest.json`.
5. Refresh a webpage and use the extension icon or floating bilingual icon.

Load the **built output**, not the repository root or `src`. Running multiple page-translation extensions can produce duplicate translations. Browser internal pages and some protected pages do not permit extension injection.

Changing the loaded directory may create a separate extension identity. Keep the old installation and export ordinary settings before migrating; verify the new installation before removing the old one. AI keys are excluded from ordinary settings exports and must be entered again.

Firefox has a separate experimental, unsigned build. It has not received equivalent browser testing. Load its `manifest.json` temporarily through `about:debugging`; permanent installation requires a separately signed release. Its independent ID is `twp-ai@jacking9898`, so it does not replace the upstream extension's update channel.

## Usage

- **Webpages:** click the floating translation icon to translate or restore. The upper toolbar button opens the sidebar; the lower one opens the control panel.
- **Text comparison:** open the text workspace, paste text, choose source and target languages and select services. Source defaults to automatic detection and can be set manually. Failed services can be retried independently.
- **Your AI models:** open model and glossary settings, enter the provider name, Base URL, model ID and API key, then save and test the connection. HTTPS APIs and localhost HTTP model servers are supported.
- **Experts and terms:** choose a built-in preset or create your own. Editing a preset saves a personal copy. Enter glossary items one per line, for example `feature engineering = 特征工程`.
- **PDF:** choose a PDF in the document workspace (up to 50 MB / 2,000 pages) to open a dedicated reader tab. Original pages and translations scroll together by default, following corresponding pages and paragraphs and realigning when translations arrive. Turn off Sync scrolling to scroll each pane independently; the preference is remembered. Click a source text block to locate and highlight its translation; outline and page-number navigation explicitly position both panes. Zoom is supported, and canvases load around your reading position. The unified reader places translated text at source coordinates, retaining headers, page numbers, headings, body columns and marginal notes. Translated regions grow vertically at the selected font size; later regions in the same column move down, and the page expands instead of clipping text. Scrolling aligns corresponding chunks rather than requiring identical vertical coordinates. Click the Show original + translation button to place original text above each translated block. Disable it for translations only. The preference is remembered, toggling makes no translation requests, and formula graphics appear only once. Body paragraphs interrupted by marginal notes are rejoined, and inline superscripts/subscripts remain attached to their text line. Recognized display equations and matrices retain their original PDF graphics and are rendered locally on demand and excluded from translation requests. TXT exports contain a formula notice instead of the graphic. Detection uses text-layer and math-font heuristics. Recognized inline expressions with superscripts/subscripts are protected before translation, restored afterward, and rendered with native superscript/subscript elements. If a service corrupts a marker, only the surrounding prose is translated. This applies to traditional services and custom AI; TXT retains textual notation. Complex inline mathematics, tables, images and original fonts are not fully reconstructed. Scroll translation is enabled by default: it translates the first page on opening and the current page after scrolling or jumping settles for about 0.65 seconds. Rapidly crossed pages are not queued, and completed pages are reused. Turn it off to use the toolbar's current-page / entire-document action or each page's translate button; the toggle is remembered. Cancellation also turns automatic translation off and retains completed pages. Failed pages require a manual retry. The right side can show bilingual text or translations only. Export writes completed pages to TXT; incomplete results include `partial` in the filename. Refreshing or reopening the reader requires selecting the file again; matching AI translations can still be reused from cache. TXT input is limited to 200 KB / 100,000 characters.
- **PDF toolbar:** Text provides source-text selection/copying and text notes. Draw adds freehand annotations, deletion and undo. Notes last for the current reading session; download their JSON and import it into the same PDF to restore them. The original PDF is not rewritten. Style controls font, size, line/paragraph spacing, margins and first-line indentation. Hide top keeps the reading toolbar accessible. Search, first/last page, hand panning, fullscreen and document properties are available. With independent scrolling, use the current-page translation button to locate the result.
- **AI usage and document terms:** open AI usage and terms from the webpage control panel or PDF toolbar to see reported tokens for the current page/file session (including retranslations and term extraction), lifetime totals and recent batches. Model settings also link to all history. Recording starts with this feature; missing usage is unknown and local cache hits add no tokens. These records are not a provider invoice. Explicitly extract candidates, edit them and save before they affect later AI requests; retranslate existing results manually. Terms are isolated by full webpage URL or PDF content fingerprint, plus target language. PDF extraction uses the current page and adds to a file-wide library; renamed identical PDFs reuse it. Extraction sends at most the first 16,000 characters of the snapshot to the selected model and may incur API charges.
- **Caching:** choose a retention preset in the webpage control panel or set 1–8,760 hours in **model and glossary settings → AI translation cache**. Clearing and disabling are available there. Refreshing a recently translated URL in the same tab restores AI translation; restoring the original text cancels that behavior. Other URLs and new tabs do not automatically translate because of this record. Both automatic and manual PDF translation reuse matching AI cache entries. Use **retranslate / skip cache** to request a fresh result.

Cache matching includes source text, context, source/target language, model configuration, expert, style and the glossary terms actually used. Storage is bounded to 1,000 batches and approximately 20 MiB, with expiry and eviction. Disabling caching deletes existing entries. Incognito windows and connection tests do not read or write persistent cache entries. Hits avoid another API request; misses, expiry and forced refreshes send a new request.

Built-in data is versioned in [builtinPresets.js](src/lib/builtinPresets.js) and bundled with the extension. All 41 reference expert categories have independently rewritten prompts, alongside three local base experts. Thirty reference glossaries are retained; access control was expanded to **Computer Science** (125 entries per Chinese locale), and **LLM / AI** adds 136 entries per locale. Six video-game glossaries were removed; gaming experts and personal configurations remain. Counts, empty collections, attribution and unresolved source-data redistribution licensing are documented in [preset sources](docs/public-presets.md).

## Privacy

Translation sends relevant text to the selected service. Enabled automatic rules can also trigger requests. Multi-model comparison sends text to every selected provider.

AI keys are stored in the extension's private IndexedDB, not ordinary settings exports or release packages. This is not an additionally encrypted password vault. AI translation results are cached locally by default; they can contain sensitive translated content. Original PDFs are parsed locally and are not uploaded by the document workspace. See [PRIVACY.md](PRIVACY.md) for data flows, retention controls, third-party PDF tools and permissions.

## Build from source

Requires Node.js **22.18+** and npm. Development validation uses Node.js 24.

```sh
git clone https://github.com/jacking9898/twp-ai.git
cd twp-ai
npm ci
npm run build
npm run test:release
```

The build recreates `build/`, producing Chromium, Firefox and editable-source ZIPs plus `SHA256SUMS.txt`. It bundles PDF.js, its worker and required assets locally. Building does not publish, upload files or use personal API keys.

Common checks:

```sh
npm run test:ai
npm run test:sidebar
npm run test:background
npx playwright install chromium
npm test
npm run test:pdf-cache
npm run test:pdf-auto
npm run test:pdf-tools
npm run test:ai-extension
```

Extension tests use a local mock API and an isolated browser profile. On Windows they use Edge by default; see [build instructions](build-instructions.md) and the [release guide](docs/releasing.md) for browser setup and publishing steps.

## Contributions, licensing and credits

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Do not publish API keys, personal exports or unredacted webpages in issues.

The project preserves upstream's **[MPL-2.0](LICENSE)** license and attribution. Changes to MPL-covered files remain available under MPL-2.0; distribute corresponding editable source alongside installation packages. Other components retain their own licenses, listed in [third-party notices](THIRD_PARTY_NOTICES.md) and [license texts](THIRD_PARTY_LICENSES.txt).

Thanks to the authors and contributors of the following open-source projects for the foundational code and tools on which this project builds:

- [TWP — Translate Web Pages](https://github.com/FilipePS/Traduzir-paginas-web): the direct upstream project, providing webpage translation, service integrations, UI and localization. Special thanks to FilipePS and upstream contributors.
- [Vercel AI SDK](https://github.com/vercel/ai): AI model integration and OpenAI-compatible provider support.
- [Mozilla PDF.js](https://github.com/mozilla/pdf.js): PDF parsing, text extraction and page rendering.
- [core-js](https://github.com/zloirock/core-js): JavaScript compatibility support.
- [htmlparser2](https://github.com/fb55/htmlparser2): HTML parsing infrastructure.
- [normalize.css](https://github.com/necolas/normalize.css): browser style normalization included in inherited styles.
- [CSS.GG](https://github.com/astrit/css.gg/tree/a99539a934b6b53f367ffa6ac1aa6221f879e08e): inherited legacy CSS icons. The link points to the referenced historical version; see the third-party notices for licensing details.

Glossary data also references [Immersive Translate terms](https://github.com/immersive-translate/terms); thanks to its original authors for compiling it. Sources and the unresolved redistribution-license status are documented in [preset sources](docs/public-presets.md) and the [third-party notices](THIRD_PARTY_NOTICES.md). Attribution does not replace permission.

The current brand is **Yedu (页渡)**, with a warm orange folded-page icon. The [generation prompt and source asset](assets/branding/reading-icon-v1.prompt.txt) are retained in the repository. TWP AI is the legacy name; upstream TWP is credited as the source project. Provider names and marks identify services and do not imply endorsement. Generation records do not establish trademark registration or guarantee non-infringement.

Local builds retain `build/TWP_AI_<version>_Chromium_MV3` to preserve the identity of existing unpacked installations; downloadable archives use the `Yedu` prefix. The GitHub URL, extension ID, configuration keys and cache keys remain compatible.
