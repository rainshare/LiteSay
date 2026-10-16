# LiteSay

English | [中文](README.zh.md)

**Read every page with ease.**

LiteSay is a Manifest V3 browser extension for full-page, selected-text, and paragraph translation on hover. It supports multiple translation services and custom API endpoints while preserving the original page text for comparison.

## Main features

- **Full-page translation**: Translate page content, including dynamically loaded text, and restore the original with one action.
- **Selection and hover translation**: Translate selected text or an individual paragraph.
- **Bilingual reading**: Keep the original text alongside translations, or display translations only.
- **Multiple services**: Use built-in translation services or connect compatible remote and local services through a custom API.
- **Website rules**: Adjust translation scope and display for different websites, with support for custom site rules.

## Installation

Compatible with Chrome, Firefox, and other Chromium browsers.

### Chrome and other Chromium browsers

1. Download and extract the repository source.
2. Open your browser's extensions page: `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the extracted `src/` directory.
5. Refresh any pages that are already open.

### Firefox

Firefox requires its own extension package and cannot load the `src/` directory above directly.

1. Prepare the Firefox extension package (ZIP), or extract it to a local directory.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on** and select the ZIP package, or select `manifest.json` from the extracted extension directory.
4. Refresh any pages that are already open.

Temporary extensions are removed when Firefox restarts and must be loaded again. See [Mozilla's temporary installation guide](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

The source directory and extension packages include the resources needed to run the extension. Installation requires no Node.js or additional build steps. Keep your local extension files in place; after updating them, reload the extension and refresh your webpages.

## Usage

| Translation mode   | Default action                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Full page          | Press **Alt+A**, or click the floating page button or browser toolbar icon. Repeat to restore the original.     |
| Selected text      | Select text and click the small dot that appears to open the translation card.                                  |
| Paragraph on hover | Enable this feature in settings, then hold **Ctrl** and hover over a paragraph. Repeat to restore the original. |

Use the floating panel to choose the source language, target language, translation service, and display mode. Selection and hover triggers can be adjusted in settings. The selection card supports copying translations, retrying failed requests, and closing with Escape or a click outside the card.

The source language defaults to automatic detection, and the target language defaults to Simplified Chinese. Choose a translation service in the panel. When the target language is Chinese, existing Chinese content is skipped.

Full-page translation is off by default. Once enabled, the extension remembers its state and automatically translates newly opened or refreshed supported pages, sending text to the selected service. Toggle full-page translation again to turn it off and restore the original text.

### Translation services

Available services, models, and protocols are listed in the current settings page.

- **Free web translation**: Built-in Google and Microsoft web translation endpoints require no API key.
- **Model services**: Configure the model and API key required by the selected service. Pricing and quotas are determined by the provider.
- **Custom API**: Configure the endpoint, model, and key using a protocol available in settings to connect compatible remote or local services.

After saving a model service configuration, use the service test in settings to check connectivity. Token usage uses provider-reported data when available; otherwise, it is estimated with a local tokenizer and labeled accordingly. Cache hits do not add to the token count.

### Website rules

Available website rules and translation scopes are listed in the settings page.

Enable or disable site rules, adjust available scopes, or add custom rules using domains and CSS selectors. Save the rules to apply your changes.

Saved custom rules take precedence over built-in rules. To use the latest built-in rules after an update, choose **Restore defaults**. Websites without a dedicated rule use general page content detection.

## Privacy and data security

When using free web translation services or third-party LLM APIs, the provider may retain submitted content and translations and use them to improve its services or train AI models in accordance with its policies. The selected provider's privacy policy, terms of service, and account settings apply. Review them before processing sensitive content.

- Settings, service configurations, and usage data are stored in the current browser, with no cloud sync.
- API keys are encrypted locally and used to authenticate API requests.
- Cached translations are stored locally in plain text, are valid for 7 days, and are limited to 1,500 entries. You can clear the cache in settings.

## Known limitations

- Form inputs, code, editors, hidden content, and areas marked as non-translatable are excluded.
- PDF translation, image text recognition, and general iframe translation are not supported.
- Translation is unavailable on restricted pages, such as browser internal pages and extension stores.
- Free web translation endpoints may be rate-limited or temporarily unavailable due to network conditions or changes in service policies.
- Changes to website structure may affect content detection and site rules.

If the floating button does not appear, reload the extension and refresh the page. If a request fails, check your network, service endpoint, protocol, model name, and available quota. Local services must be running.

## Source structure

The extension source is in `src/`. Its entry point is [src/manifest.json](src/manifest.json).

```text
src/
├── _locales/         # Browser-facing extension name and description
├── api/              # Translation protocols and request scheduling
├── app/              # Extension tasks and page control
├── assets/           # Icons
├── components/       # Shared UI components
├── config/           # Public default configuration
├── i18n/             # Interface language resources
├── platform/         # Browser integration
├── plugins/          # Translation features and website rules
├── store/            # Local settings, keys, cache, and usage
├── utils/            # DOM utilities and tokenizer
├── views/            # Settings page and translation overlays
├── LICENSE           # MIT license copy shipped with the extension package
└── manifest.json     # Extension entry point and permissions
```

## Reporting issues

Include your browser and extension versions, steps to reproduce the issue, and the expected behavior.

## License

[MIT](LICENSE)

Third-party resources: [Icon license](src/assets/providers/LICENSE.txt) · [Sources](src/assets/providers/SOURCES.md) · [Tokenizer license](src/utils/tokenizer/vendor/LICENSE.txt).
