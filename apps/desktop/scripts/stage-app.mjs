// Stage the desktop app for electron-builder: deploy the dependency tree to a
// temp directory outside the pnpm workspace (so electron-builder never treats
// it as a workspace member and never re-runs `pnpm install`), flatten the
// workspace junctions that point back into the repository (pnpm deploy keeps
// `link:` overrides like cosmokit/schemastery as junctions), rewrite
// `workspace:^` ranges to concrete versions, and copy the built lib/.
//
// Prints the staging path; `pnpm package` then runs electron-builder against
// it. On Windows, packaging without signing requires an elevated shell for
// winCodeSign's symlink extraction, so the package script passes
// `--config.win.signAndEditExecutable=false` in the common non-admin case.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const staging = mkdtempSync(join(tmpdir(), 'dsh-desktop-staging-'))

run('pnpm.cmd', ['--filter', '@deepseek-ai/dsh-desktop', 'deploy', '--legacy', '--ignore-scripts', staging])
run('node', [join(packageRoot, 'scripts', 'flatten-junctions.mjs'), staging])
run('node', [join(packageRoot, 'scripts', 'rewrite-workspace-ranges.mjs'), staging])
cpSync(join(packageRoot, 'lib'), join(staging, 'lib'), { recursive: true })
console.log(staging)

function run(command, args) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, CI: 'true' },
  })
}
