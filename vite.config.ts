import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/invoice-app/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'supabase/functions/gmail-sync/**/*.test.ts', 'supabase/functions/gmail-sync-scheduled/**/*.test.ts', 'supabase/functions/_shared/gmail-candidate-filter.test.ts', 'supabase/functions/_shared/gmail-sync-runtime.test.ts'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
