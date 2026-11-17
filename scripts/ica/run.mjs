// Runs a TypeScript script with the app's "@/" import alias (jiti). Used by `npm run ica:check`.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } })
const [script, ...rest] = process.argv.slice(2)
process.argv = [process.argv[0], script, ...rest]
await jiti.import(path.resolve(root, script))
