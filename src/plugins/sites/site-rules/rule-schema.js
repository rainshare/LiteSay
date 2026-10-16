/**
 * Site rule data contract, independent of UI, chrome.storage, and the page DOM.
 * Build synchronization, settings drafts, and Worker saves share validation so domain, type, and default handling agree.
 * Accept declarative fields only; configurations cannot carry scripts, event handlers, or extra executable logic.
 */
const FIELDS = new Set([
  'id',
  'label',
  'description',
  'domains',
  'defaultEnabled',
  'bodySelector',
  'excludedSelector',
  'contentExcludedSelector',
  'inlineLinkSelector',
  'renderedTextSelector',
  'inlineFormatSelector',
  'inlinePreserveSelector',
  'translateInlineLinks',
  'preserveMentions',
  'preserveEmojiImages',
  'sections',
  'components',
]);

function textField(rule, field, limit, required = false) {
  const value = rule[field] === undefined && !required ? '' : rule[field];
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim()))
    throw new Error(
      `Rule ${rule.id || 'Unnamed region'}: ${field} must be${required ? ' non-empty' : ''} text (max ${limit} characters).`,
    );
  return value.trim();
}

function domainName(value, id) {
  if (typeof value !== 'string' || value.length > 253)
    throw new Error(`Domains in rule ${id} must be hostnames such as x.com.`);
  const domain = value.trim().toLowerCase();
  // Matching already includes subdomains, so *.x.com is unnecessary; store hostnames, not full URLs.
  // Restrict characters before URL normalization to prevent credentials, paths, ports, or numeric hosts
  // from silently changing the user's matching scope. Internationalized domains use ASCII punycode.
  if (!/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) || domain.includes('..'))
    throw new Error(`Invalid domain in rule ${id}: ${value}. Use a hostname such as x.com.`);
  let url;
  try {
    url = new URL(`https://${domain}`);
  } catch {
    throw new Error(`Invalid domain in rule ${id}: ${value}.`);
  }
  if (
    url.hostname !== domain ||
    domain.split('.').some((part) => part.length > 63 || /^-|-$/.test(part))
  )
    throw new Error(`Invalid domain in rule ${id}: ${value}.`);
  return domain;
}

/**
 * Strictly validate the complete rule table and return new normalized objects without changing the caller's draft.
 * Require id/label/domains/defaultEnabled/bodySelector; descriptions and exclusions may be empty.
 * Both protection switches default to false. An empty array explicitly removes all site rules.
 *
 * @param {unknown} value Complete rule array from config or browser customization.
 * @param {(selector: string) => unknown} [validateSelector] Optional syntax checker; settings pass document.querySelector.
 *   No DOM binding here, so Workers and build scripts can reuse it.
 * @returns {Array<object>} Safe-to-store rules with trimmed strings and normalized domain case.
 * @throws {Error} Chinese messages identify the invalid site/field; save handlers must not silently correct input.
 */
export function validateSiteRuleDefinitions(value, validateSelector) {
  if (!Array.isArray(value) || value.length > 50)
    throw new Error('Site rules must be an array with at most 50 sites.');
  // IDs identify stored switches and editor DOM nodes; unique domains avoid policies determined by array order for the same host.
  // Parent domains and specific subdomains may be registered separately; runtime prefers the more specific match.
  const ids = new Set();
  const domains = new Set();
  return value.map((rule) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule))
      throw new Error('Each site rule must be an object.');
    if (Object.keys(rule).some((field) => !FIELDS.has(field)))
      throw new Error(`Rule ${rule.id || 'Unnamed region'} contains unsupported fields.`);
    if (typeof rule.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(rule.id) || ids.has(rule.id))
      throw new Error(
        'Site IDs must be unique and use lowercase letters, digits, or hyphens, starting with a letter (max 64 characters).',
      );
    ids.add(rule.id);
    if (!Array.isArray(rule.domains) || !rule.domains.length || rule.domains.length > 50)
      throw new Error(`Rule ${rule.id} needs 1 to 50 domains.`);
    const hosts = rule.domains.map((domain) => domainName(domain, rule.id));
    for (const host of hosts) {
      if (domains.has(host))
        throw new Error(`The domain ${host} is duplicated. Configure it only once.`);
      domains.add(host);
    }
    if (typeof rule.defaultEnabled !== 'boolean')
      throw new Error(`Rule ${rule.id}: defaultEnabled must be a switch (on or off).`);
    const normalized = {
      id: rule.id,
      label: textField(rule, 'label', 100, true),
      description: textField(rule, 'description', 1000),
      domains: hosts,
      defaultEnabled: rule.defaultEnabled,
    };
    if (rule.components !== undefined) {
      if (
        !Array.isArray(rule.components) ||
        rule.components.length > 10 ||
        new Set(rule.components).size !== rule.components.length ||
        rule.components.some((id) => typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(id))
      )
        throw new Error(
          `Rule ${rule.id}: shared adaptor components must be an array of unique valid IDs.`,
        );
      normalized.components = [...rule.components];
    }
    for (const field of [
      'bodySelector',
      'excludedSelector',
      'contentExcludedSelector',
      'inlineLinkSelector',
      'renderedTextSelector',
      'inlineFormatSelector',
      'inlinePreserveSelector',
    ]) {
      if (
        [
          'inlineLinkSelector',
          'renderedTextSelector',
          'inlineFormatSelector',
          'inlinePreserveSelector',
        ].includes(field) &&
        rule[field] === undefined
      )
        continue;
      const selector = textField(rule, field, 8000, field === 'bodySelector');
      if (selector && validateSelector) {
        try {
          validateSelector(selector);
        } catch {
          throw new Error(`Rule ${rule.id}: ${field} is not a valid CSS selector.`);
        }
      }
      normalized[field] = selector;
    }
    for (const field of ['preserveMentions', 'preserveEmojiImages']) {
      if (rule[field] !== undefined && typeof rule[field] !== 'boolean')
        throw new Error(`Rule ${rule.id}: ${field} must be a switch (on or off).`);
      normalized[field] = rule[field] ?? false;
    }
    if (rule.translateInlineLinks !== undefined) {
      if (typeof rule.translateInlineLinks !== 'boolean')
        throw new Error(`Rule ${rule.id}: translateInlineLinks must be a switch (on or off).`);
      normalized.translateInlineLinks = rule.translateInlineLinks;
    }
    if (rule.sections !== undefined) {
      if (!Array.isArray(rule.sections) || rule.sections.length > 10)
        throw new Error(`Rule ${rule.id}: optional regions must be an array (max 10).`);
      const sectionIds = new Set();
      const sectionFields = new Set([
        'id',
        'label',
        'description',
        'defaultEnabled',
        'bodySelector',
        'excludedSelector',
      ]);
      normalized.sections = rule.sections.map((section) => {
        if (
          !section ||
          typeof section !== 'object' ||
          Array.isArray(section) ||
          Object.keys(section).some((field) => !sectionFields.has(field)) ||
          typeof section.id !== 'string' ||
          !/^[a-z][a-z0-9-]{0,63}$/.test(section.id) ||
          sectionIds.has(section.id)
        )
          throw new Error(`Rule ${rule.id}: optional region IDs must be unique and valid.`);
        sectionIds.add(section.id);
        if (typeof section.defaultEnabled !== 'boolean')
          throw new Error(`Rule ${rule.id}: optional region default switches must be on or off.`);
        const result = {
          id: section.id,
          label: textField(section, 'label', 100, true),
          description: textField(section, 'description', 1000),
          defaultEnabled: section.defaultEnabled,
        };
        for (const field of ['bodySelector', 'excludedSelector']) {
          result[field] = textField(section, field, 8000, field === 'bodySelector');
          if (result[field] && validateSelector) {
            try {
              validateSelector(result[field]);
            } catch {
              throw new Error(
                `Rule ${rule.id}, region ${section.id}: ${field} is not a valid CSS selector.`,
              );
            }
          }
        }
        return result;
      });
    }
    return normalized;
  });
}

/**
 * Tolerant storage reader: null/missing or invalid values restore config inheritance.
 * Retain [] as [] instead of treating disabled site adaptation as a falsy request for defaults.
 * This handles read recovery only; saving drafts requires strict validation and user-visible errors.
 */
export function normalizeSiteRuleOverrides(value) {
  if (value === undefined || value === null) return null;
  try {
    return validateSiteRuleDefinitions(value);
  } catch {
    return null;
  }
}
