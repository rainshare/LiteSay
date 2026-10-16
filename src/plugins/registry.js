(() => {
  const app = (globalThis.LiteSay ||= {});
  if (app.plugins) return;
  const factories = new Map();
  /** Feature factory registry; the host injects capabilities and broadcasts lifecycle events. */
  app.plugins = {
    has: (id) => factories.has(id),
    register({ id, create }) {
      if (!/^[a-z][a-z0-9-]*$/.test(id) || typeof create !== 'function' || factories.has(id))
        throw new Error('Feature plugins need a unique id and a create function.');
      factories.set(id, create);
    },
    instantiate(context) {
      const instances = [...factories.values()].map((create) => create(context));
      return {
        configure: (settings) => instances.forEach((instance) => instance.configure?.(settings)),
        settingsChanged: () => instances.forEach((instance) => instance.onSettingsChanged?.()),
        pageRestore: () => instances.forEach((instance) => instance.onPageRestore?.()),
      };
    },
  };
})();
