import { t, setMessage } from '../../i18n/engine/index.js';

/** Usage views render host-provided summaries only; the background handles storage, trusted messages, and request counts. */
export function createTokenUsageView({ root, load, reset, onError }) {
  const doc = root.ownerDocument;
  let provider,
    revision = 0;
  const totals = root.querySelector('[data-usage-totals]');
  const rows = root.querySelector('tbody');
  const note = root.querySelector('[data-usage-note]');
  async function refresh() {
    const current = ++revision;
    if (root.hidden) return;
    try {
      const summary = await load();
      if (current !== revision) return;
      const entry = summary.providers[provider];
      const numbers = { input: 0, output: 0, total: 0, ...entry };
      for (const field of ['input', 'output', 'total'])
        totals.querySelector(`[data-count="${field}"]`).textContent =
          numbers[field].toLocaleString();
      rows.replaceChildren();
      for (const model of entry?.models || []) {
        const row = doc.createElement('tr');
        for (const value of [
          model.model,
          model.input,
          model.output,
          model.total,
          model.requests,
          t(
            model.estimated
              ? model.reported
                ? 'usage.mixedSource'
                : 'usage.localSource'
              : 'usage.providerSource',
          ),
        ]) {
          const cell = doc.createElement('td');
          cell.textContent = typeof value === 'number' ? value.toLocaleString() : value;
          row.append(cell);
        }
        rows.append(row);
      }
      setMessage(note, entry?.estimated ? 'usage.estimatedNote' : 'usage.fallbackNote', {
        count: entry?.estimated || 0,
      });
      root.querySelector('[data-usage-empty]').hidden = Boolean(entry?.models.length);
    } catch (error) {
      onError(error);
    }
  }
  root.querySelector('[data-usage-refresh]').onclick = () => refresh();
  root.querySelector('[data-usage-reset]').onclick = async () => {
    if (!doc.defaultView.confirm(t('usage.confirmClearProvider'))) return;
    const button = root.querySelector('[data-usage-reset]');
    button.disabled = true;
    try {
      await reset(provider);
      await refresh();
    } catch (error) {
      onError(error);
    } finally {
      button.disabled = false;
    }
  };
  return {
    show(id, visible) {
      provider = id;
      root.hidden = !visible;
      root.setAttribute('aria-label', t('usage.title'));
      refresh();
    },
    refresh,
  };
}
