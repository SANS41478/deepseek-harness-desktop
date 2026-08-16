// Rewrite `workspace:^` dependency ranges in a deployed package.json to the
// concrete workspace versions, so electron-builder's dependency-status check
// (which runs `pnpm install --production` against the staging directory)
// sees a self-consistent manifest instead of re-resolving the workspace.
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const staging = process.argv[2]
if (staging === undefined) {
  throw new Error('rewrite-workspace-ranges: pass the staging package.json path')
}

const manifestPath = join(staging, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

/** Resolve one workspace package's version from the repository tree. */
function workspaceVersion(name) {
  // @scope/pkg -> pkg (the last path segment, matching the package directory).
  const bare = name.slice(name.lastIndexOf('/') + 1)
  // Known layout: packages/<group>/<name>, vendor/<name>, apps/<name>,
  // native/<name>, examples/<name>. No recursion — junctions and node_modules
  // make recursive walks unreliable.
  const candidates = [
    join(repositoryRoot, 'packages', bare),
    ...readdirSyncSafe(join(repositoryRoot, 'packages'))
      .filter(entry => entry.isDirectory())
      .flatMap(group =>
        readdirSyncSafe(join(repositoryRoot, 'packages', group.name))
          .filter(entry => entry.isDirectory())
          .map(dir => join(repositoryRoot, 'packages', group.name, dir.name))),
    ...readdirSyncSafe(join(repositoryRoot, 'vendor'))
      .filter(entry => entry.isDirectory())
      .map(dir => join(repositoryRoot, 'vendor', dir.name)),
    ...readdirSyncSafe(join(repositoryRoot, 'apps'))
      .filter(entry => entry.isDirectory())
      .map(dir => join(repositoryRoot, 'apps', dir.name)),
    ...readdirSyncSafe(join(repositoryRoot, 'native'))
      .filter(entry => entry.isDirectory())
      .map(dir => join(repositoryRoot, 'native', dir.name)),
    ...readdirSyncSafe(join(repositoryRoot, 'examples'))
      .filter(entry => entry.isDirectory())
      .map(dir => join(repositoryRoot, 'examples', dir.name)),
  ]
  for (const candidate of candidates) {
    const manifest = join(candidate, 'package.json')
    if (!existsSync(manifest)) continue
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    if (pkg.name === name) return pkg.version
  }
  return undefined
}

/** readdirSync that returns an empty list for unreadable directories. */
function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  const deps = manifest[section]
  if (deps === undefined) continue
  for (const [name, range] of Object.entries(deps)) {
    if (range !== 'workspace:^') continue
    const version = workspaceVersion(name)
    if (version === undefined) throw new Error(`cannot resolve workspace version for ${name}`)
    deps[name] = version
  }
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
console.log(`rewrite-workspace-ranges: ${dirname(manifestPath)}`)
