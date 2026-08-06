import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const files = []

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await walk(path)
    else files.push(path)
  }
}

try {
  await walk(dist)
} catch (error) {
  console.error(`Production dist is missing or unreadable: ${error.message}`)
  process.exit(1)
}

const maps = files.filter((file) => extname(file) === '.map')
const bundles = files.filter((file) => ['.js', '.css'].includes(extname(file)))
const references = []

for (const file of bundles) {
  if ((await readFile(file, 'utf8')).includes('sourceMappingURL')) {
    references.push(relative(dist, file))
  }
}

if (bundles.length === 0 || maps.length > 0 || references.length > 0) {
  if (bundles.length === 0) console.error('Production dist contains no JS or CSS bundles')
  if (maps.length > 0) console.error(`Production dist contains source maps:\n${maps.join('\n')}`)
  if (references.length > 0) console.error(`Production bundles expose sourceMappingURL:\n${references.join('\n')}`)
  process.exit(1)
}

console.log(`Verified ${bundles.length} production JS/CSS bundles: no source maps or sourceMappingURL references`)
