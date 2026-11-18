import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Chunk sizes. The game data snapshots (weapons, prices, quests per language,
// loot) are big by nature, and each loads only when a panel needs it: Vite's
// own warning is set past them. Code is what must stay small, so this check
// keeps the 500 kB limit for any chunk with code in it.
const CODE_LIMIT_KB = 500
const DATA_LIMIT_KB = 4000
const isData = (id: string) => /[\\/]data[\\/]snapshot[\\/][^\\/]+\.json$/.test(id)

function codeChunkSize(): Plugin {
  return {
    name: 'moa:code-chunk-size',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || chunk.moduleIds.every(isData)) continue
        const kb = Buffer.byteLength(chunk.code) / 1000
        if (kb > CODE_LIMIT_KB) {
          this.warn(`${chunk.fileName} has ${Math.round(kb)} kB of code (limit ${CODE_LIMIT_KB} kB): load part of it with a dynamic import()`)
        }
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), codeChunkSize()],
  build: { chunkSizeWarningLimit: DATA_LIMIT_KB },
})
