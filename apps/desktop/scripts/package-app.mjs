// Run electron-builder against the staged app directory produced by
// stage-app.mjs. Windows CI without an elevated shell cannot extract
// winCodeSign's symlinks, so `--win` disables signing/editing of the
// executable (the unpacked dir target remains fully functional).
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const staging = readdirSync(tmpdir())
  .filter(name => name.startsWith('dsh-desktop-staging-'))
  .map(name => join(tmpdir(), name))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
if (staging === undefined) {
  throw new Error('package-app: no staging directory found — run pnpm stage first')
}

// Locate the electron-builder CLI in the repository's pnpm store.
const builderDirs = readdirSync(join(repoRoot, 'node_modules', '.pnpm'))
  .filter(name => name.startsWith('electron-builder@'))
const cli = join(repoRoot, 'node_modules', '.pnpm', builderDirs[0], 'node_modules', 'electron-builder', 'cli.js')
if (!builderDirs.length) {
  throw new Error('package-app: electron-builder is not installed in the repository')
}

const win = process.argv.includes('--win')
console.log(`package-app: building ${staging}${win ? ' (win, unsigned)' : ''}`)
// electron-builder uses the cwd as the app directory; passing --projectDir
// triggered its pnpm dependency-status check against the staging tree, which
// re-runs `pnpm install` and fails outside the workspace. Running with
// cwd=staging and no projectDir keeps it self-contained.
execFileSync('node', [cli, ...(win
  ? ['--config.win.signAndEditExecutable=false', '--config.win.target=dir']
  : [])], { cwd: staging, stdio: 'inherit', env: { ...process.env, CI: 'true' } })
console.log('package-app: done')
