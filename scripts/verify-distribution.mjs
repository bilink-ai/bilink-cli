import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const forbiddenPaths = ["rust", "Cargo.toml", "Cargo.lock"]
for (const rel of forbiddenPaths) {
  if (existsSync(path.join(root, rel))) {
    throw new Error(`forbidden Rust source artifact in public distribution repo: ${rel}`)
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === ".git" || entry === "node_modules") continue
    const abs = path.join(dir, entry)
    const rel = path.relative(root, abs)
    const stats = statSync(abs)
    if (stats.isDirectory()) {
      walk(abs)
      continue
    }
    if (rel.endsWith(".rs")) {
      throw new Error(`forbidden Rust source file in public distribution repo: ${rel}`)
    }
  }
}

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(root, rel), "utf8"))
}

walk(root)

const rootPkg = readJson("package.json")
if (rootPkg.name !== "@bilink-ai/cli") {
  throw new Error("root package must be @bilink-ai/cli")
}
if (rootPkg.private === true) {
  throw new Error("public distribution root package must not be private")
}
if (rootPkg.publishConfig?.registry !== "https://registry.npmjs.org/") {
  throw new Error("root package must publish to npmjs")
}

for (const packageName of Object.keys(rootPkg.optionalDependencies ?? {})) {
  if (!packageName.startsWith("@bilink-ai/cli-")) continue
  const target = packageName.replace("@bilink-ai/cli-", "")
  const platformPkg = readJson(`platforms/${target}/package.json`)
  if (platformPkg.name !== packageName) {
    throw new Error(`platform package name mismatch for ${target}`)
  }
  if (platformPkg.private === true) {
    throw new Error(`${packageName} must not be private in the public distribution repo`)
  }
  if (!platformPkg.files?.includes("bin")) {
    throw new Error(`${packageName} must include bin in package files`)
  }
}

console.log("distribution: PASS")

