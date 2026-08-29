// Close the staged dependency tree: `pnpm deploy --legacy` installs the
// app's direct dependencies but prunes packages that are only reachable as
// peerDependencies of workspace packages (the repo installs them at dev time
// through every package's devDependencies, which a production deploy drops).
// The harness boot then fails at startup with ERR_MODULE_NOT_FOUND for the
// first pruned import (loader, group, scope, ...). This walk reads every
// package.json in the staged tree, resolves each runtime dependency and
// non-optional peer against the staging layout, and copies the missing ones
// from the repository's node_modules into the staging top level until the
// closure is complete.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const staging = resolve(process.argv[2] ?? '')
// electron-builder runs the hook from the staged copy of this script, whose
// parent directory chain is the temp dir — not the repository — so the real
// repo root must be passed explicitly (stage-app sets it in the environment).
const repoRoot = process.env.DSH_DESKTOP_REPO_ROOT ?? fileURLToPath(new URL('../../..', import.meta.url))
if (!staging || !existsSync(staging)) {
  throw new Error('close-dependencies: pass the staging directory')
}

const stagingNm = join(staging, 'node_modules')
const pnpmDir = join(stagingNm, '.pnpm')

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Every package directory directly under a node_modules-style `root`. */
function listPackageDirs(root) {
  const dirs = []
  for (const entry of readdirSyncSafe(root)) {
    if (!entry.isDirectory() || entry.name === '.bin' || entry.name === '.pnpm') continue
    const full = join(root, entry.name)
    if (entry.name.startsWith('@')) {
      for (const scoped of readdirSyncSafe(full)) {
        if (!scoped.isDirectory()) continue
        const scopedDir = join(full, scoped.name)
        if (existsSync(join(scopedDir, 'package.json'))) dirs.push(scopedDir)
      }
      continue
    }
    if (existsSync(join(full, 'package.json'))) dirs.push(full)
  }
  return dirs
}

function readManifest(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
}

/** True when `spec` is present on the node_modules chain above `fromDir`
 * (static stand-in for Node's resolution, which cannot throw or crash on
 * pathological manifests). */
function resolvable(fromDir, spec) {
  let dir = fromDir
  for (;;) {
    if (existsSync(join(dir, 'node_modules', ...spec.split('/')))) return true
    const parent = join(dir, '..')
    if (parent === dir || !parent.startsWith(staging)) return false
    dir = parent
  }
}

/** Source candidates in the repository for a package name, in resolution order. */
function repoSource(name) {
  return [
    join(repoRoot, 'node_modules', ...name.split('/')),
    join(repoRoot, 'node_modules', '.pnpm', 'node_modules', ...name.split('/')),
  ].find(existsSync)
}

// The scopes to audit: the staging top level, each staged package's own
// nested node_modules, and every .pnpm virtual-store node_modules.
const scopes = new Set([stagingNm, ...readdirSyncSafe(pnpmDir).map(d => join(pnpmDir, d.name, 'node_modules'))])
for (const dir of listPackageDirs(stagingNm)) scopes.add(join(dir, 'node_modules'))

let copied = 0
for (let round = 1; round <= 50; round++) {
  const pending = new Set()
  for (const nm of scopes) {
    for (const dir of listPackageDirs(nm)) {
      const manifest = readManifest(dir)
      if (!manifest) continue
      const peers = Object.entries(manifest.peerDependencies ?? {})
        .filter(([name]) => !manifest.peerDependenciesMeta?.[name]?.optional)
        .map(([name]) => name)
      for (const name of [...Object.keys(manifest.dependencies ?? {}), ...peers]) {
        if (existsSync(join(stagingNm, ...name.split('/')))) continue
        if (resolvable(dir, name)) continue
        if (!repoSource(name)) {
          throw new Error(`close-dependencies: ${name} (needed by ${manifest.name}) not found in the repository node_modules`)
        }
        pending.add(name)
      }
    }
  }
  if (!pending.size) {
    console.log(`close-dependencies: done (${copied} packages copied)`)
    process.exit(0)
  }
  for (const name of pending) {
    copyPackage(repoSource(name), join(stagingNm, ...name.split('/')))
    copied++
    console.log(`close-dependencies: copied ${name}`)
  }
}
throw new Error('close-dependencies: closure did not settle in 50 rounds')

// The repository tree contains junction chains with cycles (vendored packages
// link each other through nested node_modules), so a naive recursive copy
// never terminates. Walk the source manually: each package's own top-level
// node_modules is skipped (the closure loop copies any needed dependency to
// the staging top level itself), every link is dereferenced — Windows cannot
// create symlinks without a privilege — and a visited set of real paths keeps
// link cycles finite.
function copyPackage(source, target) {
  rmSync(target, { recursive: true, force: true })
  copyTree(source, target, new Set())
}

function copyTree(source, target, visited) {
  let real
  try {
    real = realpathSync(source)
  } catch {
    return
  }
  if (visited.has(real)) return
  visited.add(real)
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      let st
      try {
        st = statSync(from)
      } catch {
        continue
      }
      if (st.isDirectory()) copyTree(from, to, visited)
      else cpSync(from, to, { dereference: true })
      continue
    }
    cpSync(from, to, { dereference: true })
  }
}
