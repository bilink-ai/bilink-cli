#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const targetPackages = {
  "darwin-arm64": "@bilink-ai/cli-darwin-arm64",
  "darwin-x64": "@bilink-ai/cli-darwin-x64",
  "linux-arm64": "@bilink-ai/cli-linux-arm64",
  "linux-x64": "@bilink-ai/cli-linux-x64",
  "win32-arm64": "@bilink-ai/cli-win32-arm64",
  "win32-x64": "@bilink-ai/cli-win32-x64",
}

function resolveBinary() {
  if (process.env.BILINK_CLI_BINARY) {
    return process.env.BILINK_CLI_BINARY
  }

  const key = `${process.platform}-${process.arch}`
  const packageName = targetPackages[key]
  if (!packageName) {
    throw new Error(`Unsupported platform for Bilink CLI: ${key}`)
  }

  let packageJson
  try {
    packageJson = import.meta.resolve(`${packageName}/package.json`)
  } catch {
    throw new Error(
      `Bilink CLI native package is not installed for ${key}: ${packageName}. Reinstall @bilink-ai/cli with npm or pnpm.`,
    )
  }
  const packageDir = path.dirname(fileURLToPath(packageJson))
  const binaryName = process.platform === "win32" ? "bilink.exe" : "bilink"
  return path.join(packageDir, "bin", binaryName)
}

let binary
try {
  binary = resolveBinary()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

if (!existsSync(binary)) {
  console.error(
    `Bilink CLI binary not found: ${binary}. Reinstall @bilink-ai/cli with npm or pnpm.`,
  )
  process.exit(1)
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" })

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
