import { createSiteRulePolicy } from './site-rules/policy.js';
import { SITE_RULE_PRESETS } from './site-config/index.js';

// The sync script reads this registry to collect each adapter's rules.json and optional style.css automatically.
export const SITE_ADAPTOR_IDS = ['x', 'reddit', 'youtube', 'github', 'google'];

// The site catalog only injects registered data; new adapters require no shared policy or host import changes.
export const SITE_RULES = SITE_RULE_PRESETS;
export const { normalizeSiteRules, resolveSiteRules, siteFilterConfig, siteTranslationPolicy } =
  createSiteRulePolicy(SITE_RULES);
