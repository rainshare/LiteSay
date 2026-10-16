import { normalizeSiteRuleOverrides } from './rule-schema.js';

/** The site entry point injects the default catalog; shared policy does not depend on adapters or generated resources. */
export function createSiteRulePolicy(siteRules) {
  /**
   * config supplies the default registry; saved browser rules may override it, with independent siteRules[id] switches.
   * The background chooses rules using sender.url; ordinary pages cannot provide rule definitions.
   * Rules contain data only; content scripts traverse the DOM, allowing separate configuration for future websites.
   */
  const SITE_RULES = siteRules;
  /**
   * Inherit synchronized config by default; settings save the complete rule table rather than partial field patches.
   * A complete table makes additions/deletions explicit and avoids introducing unseen fields after config updates.
   * Writing null restores inheritance; a custom empty array intentionally disables all site adapters.
   */
  function resolveSiteRules(settings = {}) {
    return normalizeSiteRuleOverrides(settings.siteRuleOverrides) ?? SITE_RULES;
  }
  /** Domain suffixes require a dot so lookalike external domains cannot impersonate a rule. */
  function ruleFor(url, settings) {
    let hostname;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      hostname = parsed.hostname;
    } catch {
      return null;
    }
    // When both parent and subdomain are configured, the specific subdomain wins; disabling it restores the default flow.
    let match = null;
    let specificity = -1;
    for (const rule of resolveSiteRules(settings))
      for (const domain of rule.domains)
        if (
          (hostname === domain || hostname.endsWith(`.${domain}`)) &&
          domain.length > specificity
        ) {
          match = rule;
          specificity = domain.length;
        }
    return match;
  }

  /**
   * Store enablement preferences separately from rule definitions. Prefer explicit switches for current IDs;
   * use defaultEnabled for unsaved IDs and do not write deleted IDs back.
   * Pass a valid rules catalog so browser-added rules can also have independent switches.
   */
  function normalizeSiteRules(value, rules = SITE_RULES) {
    return Object.fromEntries(
      rules.flatMap((rule) => [
        [rule.id, typeof value?.[rule.id] === 'boolean' ? value[rule.id] : rule.defaultEnabled],
        ...(rule.sections || []).map((section) => {
          const key = `${rule.id}:${section.id}`;
          return [key, typeof value?.[key] === 'boolean' ? value[key] : section.defaultEnabled];
        }),
      ]),
    );
  }
  /**
   * Background requests and page collection must use the same effective rules, or protected page handles could be sent for translation.
   * Handle protection participates in cache keys; changed protection must not reuse older policy results.
   * Unmatched or disabled sites use the general translation flow.
   */
  function siteTranslationPolicy(url, settings = {}) {
    const rule = ruleFor(url, settings);
    const enabled =
      rule && normalizeSiteRules(settings.siteRules, resolveSiteRules(settings))[rule.id];
    return { preserveMentions: Boolean(enabled && rule.preserveMentions === true) };
  }
  function siteFilterConfig(url, settings = {}) {
    const rule = ruleFor(url, settings);
    if (!rule || !normalizeSiteRules(settings.siteRules, resolveSiteRules(settings))[rule.id])
      return { id: null };
    // Return only execution fields for the current page, not all sites' editor catalogs or UI messages.
    // Use sender.url rather than a message-supplied URL so pages cannot impersonate another site's rules.
    return {
      id: rule.id,
      excludedSelector: rule.excludedSelector,
      contentExcludedSelector: rule.contentExcludedSelector,
      bodySelector: rule.bodySelector,
      inlineLinkSelector: rule.inlineLinkSelector || '',
      ...(rule.renderedTextSelector ? { renderedTextSelector: rule.renderedTextSelector } : {}),
      ...(rule.translateInlineLinks ? { translateInlineLinks: true } : {}),
      ...(rule.inlineFormatSelector ? { inlineFormatSelector: rule.inlineFormatSelector } : {}),
      ...(rule.inlinePreserveSelector
        ? { inlinePreserveSelector: rule.inlinePreserveSelector }
        : {}),
      preserveMentions: rule.preserveMentions,
      preserveEmojiImages: rule.preserveEmojiImages,
      linkDomains: rule.domains,
      optionalRegions: (rule.sections || [])
        .filter(
          (section) =>
            normalizeSiteRules(settings.siteRules, resolveSiteRules(settings))[
              `${rule.id}:${section.id}`
            ],
        )
        .map(({ bodySelector, excludedSelector }) => ({ bodySelector, excludedSelector })),
    };
  }

  return { normalizeSiteRules, resolveSiteRules, siteFilterConfig, siteTranslationPolicy };
}
