import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const packageDirs = [
  ".",
  "platforms/darwin-arm64",
  "platforms/darwin-x64",
  "platforms/linux-arm64",
  "platforms/linux-x64",
  "platforms/win32-arm64",
  "platforms/win32-x64",
]

for (const packageDir of packageDirs) {
  const cwd = path.join(root, packageDir)
  const result = spawnSync("npm", ["pack", "--dry-run"], { cwd, stdio: "inherit" })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log("pack dry-run: PASS")

