import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: {
      '@lobechat/database': resolve(__dirname, '../database/src'),
    },
    environment: 'node',
    globals: false,
  },
});
