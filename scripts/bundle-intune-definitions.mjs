// Collapses the sharded Intune setting definitions in the build output into one bundle per
// two-character prefix directory.
//
// Upstream ships ~18,200 definitions as individual files under public/intune-definitions/<xx>/,
// which is a good trade for the browser: a settings-catalog policy references about 2% of the
// catalog, so per-definition fetches move far fewer bytes than the 17MB whole-catalog download
// they replaced, and each definition caches on its own.
//
// Azure Static Web Apps, though, rejects any deployment over 15,000 files on both the Free and
// Standard plans, and public/ ships verbatim in the static export. Bundling each prefix directory
// into a single <xx>.json keyed by definition hash takes those 18,200 files down to 256 and keeps
// the per-policy transfer roughly where upstream put it: a policy's settings scatter across many
// prefixes, but each bundle is ~70KB and caches for the life of the tab.
//
// This runs against out/ rather than public/ so the tracked shards are never disturbed - the
// working tree stays identical to upstream, which keeps merges clean.
//
// The read side is src/hooks/use-intune-collection.js. The two must agree on the layout.

import { readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = join(process.cwd(), 'out', 'intune-definitions')

const isPrefixDir = (name) => /^[0-9a-f]{2}$/.test(name)

const main = async () => {
  let entries
  try {
    entries = await readdir(ROOT, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') {
      // No definitions in the export (upstream may have moved them). Nothing to do, and this
      // must not fail the build.
      console.log('bundle-intune-definitions: no out/intune-definitions, skipping')
      return
    }
    throw error
  }

  const prefixes = entries.filter((e) => e.isDirectory() && isPrefixDir(e.name))
  if (prefixes.length === 0) {
    console.log('bundle-intune-definitions: no prefix directories, skipping')
    return
  }

  let definitions = 0

  for (const prefix of prefixes) {
    const dir = join(ROOT, prefix.name)
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))

    const bundle = {}
    for (const file of files) {
      // The filename is the definition's hash; the hook looks the definition up by that same
      // hash, so it is the key here.
      bundle[file.slice(0, -'.json'.length)] = JSON.parse(
        await readFile(join(dir, file), 'utf8')
      )
    }

    await writeFile(join(ROOT, `${prefix.name}.json`), JSON.stringify(bundle))
    await rm(dir, { recursive: true, force: true })
    definitions += files.length
  }

  console.log(
    `bundle-intune-definitions: ${definitions} definitions into ${prefixes.length} bundles`
  )
}

await main()
