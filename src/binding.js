// Persists the single bound Discord channel id to binding.json.
// createBindingStore(file) is injectable for tests; `binding` is the default instance.

import { readFileSync, writeFileSync } from 'node:fs';

const DEFAULT_FILE = new URL('../binding.json', import.meta.url);

export function createBindingStore(file = DEFAULT_FILE) {
  return {
    get() {
      try {
        return JSON.parse(readFileSync(file, 'utf8')).channelId || null;
      } catch {
        return null;
      }
    },
    set(channelId) {
      writeFileSync(file, JSON.stringify({ channelId }, null, 2));
      return channelId;
    },
  };
}

export const binding = createBindingStore();
