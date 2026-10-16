# Shared adapter components

Formatting, link, and widget-text handling that several sites share lives here. A site's private classes, selectors, and layout fixes stay in `../adaptors/<site ID>/`; shared components never branch on the site name.

## Reusing them on a new site

A site declares the components it reuses through the `components` array in `rules.json`. Component presets are already merged into this repository's `site-config/` runtime configuration; the development generator scripts are not part of this public copy. Existing components share collection, rendering, and click handling.

GitHub's actual registration:

```json
"components": ["markdown", "hyperlinks", "rendered-text"]
```

| Component           | What it handles                                                                                                                   | Configurable fields                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `markdown`          | Markdown body text, centered/right-aligned blocks, inline formatting, and plain links; heading anchor icons are left untranslated | `bodySelector`, `contentExcludedSelector`, `inlineFormatSelector`, `inlineLinkSelector` |
| `hyperlinks`        | Translated link labels, image/SVG icons, URLs, sizes, colors, and the original click behaviour for HTTP(S) links                  | `inlineLinkSelector`, `translateInlineLinks`                                            |
| `inline-formatting` | Bold, italics, strikethrough, highlights, and nested formatting; inline code and keyboard text are kept verbatim                  | `inlineFormatSelector`                                                                  |
| `inline-widgets`    | Composite citation links that carry an icon and a source name; text and presentation are preserved as-is                          | `inlinePreserveSelector`                                                                |
| `rendered-text`     | Text actually displayed inside the Shadow DOM that registered components open, skipping fallback dates and text                   | `renderedTextSelector`                                                                  |

Body and exclusion selectors are merged with the component presets; link, formatting, citation, and Shadow DOM selectors let an explicit site value override the preset. `translateInlineLinks: false` keeps link text as it is, `true` translates the label and keeps the click. Google uses `inlinePreserveSelector: ".notranslate:has(a[href])"` to preserve citation pills that carry a source icon, and that selector belongs to the Google adapter only.

A label that is just a URL stays untranslated regardless of the link switch, so translated pages never show a duplicated URL line. A change in a citation's text, target, or icon invalidates its snapshot and re-renders that citation.

## Data and presentation boundary

Collection records formatting and links as local markers. Markers, URLs, icons, code, and source names are never sent to the translation service; natural-language fragments keep taking part in batched requests, and results are written back in the original order. Translations are rebuilt from text nodes and allowed DOM elements only — the HTML a service returns is never parsed, and site scripts or event attributes are never copied.

Translations inherit the alignment and font size of the original paragraph, and local formatting inherits the font style of the matching original element; link icons keep their size and baseline. Plain clicks delegate to the original link, and modifier-key clicks use the original address. Bilingual mode stacks the two versions; translation-only mode hides the original nodes, and restoring brings back the original structure and events.

Shared component JS/CSS is registered in `manifest.json` at the repository root. Raw site rules live in `../adaptors/`, and the generated rules that actually load live in `../site-config/`. When you change a rule or add a component, update the matching runtime configuration, script list, and style references, then reload the extension and check the behaviour on the page.
