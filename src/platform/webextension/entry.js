import { getBrowserApi, protectStorage } from './api.js';
import { bindExtensionEvents, broadcast } from './events.js';
import { createExtensionController } from '../../app/extension/controller.js';

const api = getBrowserApi();
bindExtensionEvents(
  api,
  createExtensionController({
    storageReady: protectStorage(api),
    broadcast: (type) => broadcast(api, type),
    openOptions: () => api.runtime.openOptionsPage(),
  }),
);
