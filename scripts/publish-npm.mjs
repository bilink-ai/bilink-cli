import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dryRun = process.argv.includes("--dry-run")
const allowExisting = process.argv.includes("--allow-existing")
const registryArgIndex = process.argv.indexOf("--registry")
const registry =
  registryArgIndex === -1
    ? "https://registry.npmjs.org/"
    : (process.argv[registryArgIndex + 1] ?? "")
if (!registry) {
  throw new Error(
    "usage: pnpm publish:npm -- [--dry-run] [--allow-existing] [--registry https://registry.npmjs.org/]",
  )
}
const packageDirs = [
  "platforms/darwin-arm64",
  "platforms/darwin-x64",
  "platforms/linux-arm64",
  "platforms/linux-x64",
  "platforms/win32-arm64",
  "platforms/win32-x64",
  ".",
]

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function runText(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: "utf8" })
}

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(root, rel), "utf8"))
}

function packageInfo(packageDir) {
  const packageJson = readJson(path.join(packageDir, "package.json"))
  return {
    dir: packageDir,
    name: packageJson.name,
    version: packageJson.version,
  }
}

function npmViewStatus(info) {
  const result = runText(
    "npm",
    ["view", `${info.name}@${info.version}`, "version", "--registry", registry],
    root,
  )
  if (result.status === 0 && result.stdout.trim() === info.version) {
    return "published"
  }
  const output = `${result.stdout}\n${result.stderr}`
  if (/E404|404 Not Found|is not in this registry/.test(output)) {
    return "unpublished"
  }
  throw new Error(
    `failed to verify npm ${info.name}@${info.version} availability:\n${output.trim()}`,
  )
}

function packageStatusMap() {
  const statuses = new Map()
  const existing = []
  for (const info of packageDirs.map(packageInfo)) {
    const status = npmViewStatus(info)
    statuses.set(info.dir, status)
    if (status === "published") {
      existing.push(`${info.name}@${info.version}`)
    }
  }
  if (!allowExisting && existing.length > 0) {
    throw new Error(
      `npm versions already exist and cannot be overwritten: ${existing.join(", ")}`,
    )
  }
  return statuses
}

run("node", ["scripts/verify-distribution.mjs"], root)
run("node", ["scripts/verify-release.mjs"], root)
const statuses = packageStatusMap()

for (const packageDir of packageDirs) {
  if (allowExisting && statuses.get(packageDir) === "published") {
    console.log(`npm publish: skip existing ${packageInfo(packageDir).name}`)
    continue
  }
  const cwd = path.join(root, packageDir)
  const args = ["publish", "--access", "public", "--registry", registry]
  if (dryRun) args.push("--dry-run")
  run("npm", args, cwd)
}

console.log(`npm publish${dryRun ? " dry-run" : ""}: PASS`)
