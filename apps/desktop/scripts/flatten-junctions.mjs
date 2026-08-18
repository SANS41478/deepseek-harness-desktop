// Replace node_modules junctions that point outside the staging directory
// (pnpm deploy keeps `link:` workspace overrides — cosmokit, schemastery —
// as junctions to the repository) with real directory copies, so
// electron-builder's asar packaging never resolves a path outside the app.
// Windows junctions are directories to Node but carry a reparse target that
// PowerShell surfaces as LinkType/Target; this script shells out to PowerShell
// for the detection and copies with Node for the content.
import { cpSync, existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const staging = resolve(process.argv[2] ?? '')
if (!staging || !existsSync(staging)) {
  throw new Error('flatten-junctions: pass the staging directory')
}

/** List of junction paths (and their resolved targets) under `root`. */
function listJunctions(root) {
  const script = [
    'param($root)',
    'Get-ChildItem -Path $root -Recurse -Force -ErrorAction SilentlyContinue |',
    '  Where-Object { $_.LinkType } |',
    '  ForEach-Object { "$($_.FullName)`t$($_.Target)" }',
  ].join('\n')
  const scriptPath = join(process.env.TEMP ?? '.', 'list-junctions.ps1')
  writeFileSync(scriptPath, script)
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, root], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    return out.split(/\r?\n/).filter(Boolean).map(line => {
      const tab = line.indexOf('\t')
      return { path: line.slice(0, tab), target: line.slice(tab + 1) }
    })
  } finally {
    rmSync(scriptPath, { force: true })
  }
}

const stagingRoot = resolve(staging)
// The app package itself: lib/ is staged separately, and copying the
// junction target would drag the whole repository checkout into the asar.
const appPackageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
let copied = 0
for (const { path, target } of listJunctions(join(staging, 'node_modules'))) {
  const resolvedTarget = resolve(target)
  if (resolvedTarget.startsWith(stagingRoot)) continue
  if (resolvedTarget === appPackageRoot || resolvedTarget.startsWith(appPackageRoot + '\\')) {
    // The app package's own self-link (pnpm deploy links it into the virtual
    // store): the app is the packaged root, not a dependency. Remove it so
    // packaging never follows it back into the repository checkout.
    console.log(`flatten-junctions: removing self-link ${path}`)
    rmSync(path, { recursive: true, force: true })
    continue
  }
  console.log(`flatten-junctions: copying ${path} <- ${target}`)
  rmSync(path, { recursive: true, force: true })
  cpSync(target, path, { recursive: true, force: true })
  copied += 1
}
console.log(`flatten-junctions: done (${copied} replaced)`)
