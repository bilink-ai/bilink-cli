import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const packageDir = path.resolve(process.argv[2] ?? process.cwd())
const packageJsonPath = path.join(packageDir, "package.json")

if (!existsSync(packageJsonPath)) {
  throw new Error(`missing package.json: ${packageJsonPath}`)
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
const binaryRel = packageJson.bin?.bilink

if (typeof binaryRel !== "string") {
  throw new Error(`${packageJson.name} must expose bin.bilink`)
}

const binaryPath = path.join(packageDir, binaryRel)
if (!existsSync(binaryPath)) {
  throw new Error(`${packageJson.name} is missing native binary: ${binaryRel}`)
}

const stats = statSync(binaryPath)
if (!stats.isFile()) {
  throw new Error(`${packageJson.name} binary path is not a file: ${binaryRel}`)
}

if (!binaryRel.endsWith(".exe") && (stats.mode & 0o111) === 0) {
  throw new Error(`${packageJson.name} native binary is not executable: ${binaryRel}`)
}

console.log(`${packageJson.name}: binary package ready`)

