import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const packageTargets = [
  ["darwin-arm64", "bin/bilink"],
  ["darwin-x64", "bin/bilink"],
  ["linux-arm64", "bin/bilink"],
  ["linux-x64", "bin/bilink"],
  ["win32-arm64", "bin/bilink.exe"],
  ["win32-x64", "bin/bilink.exe"],
]
const archiveTargets = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]
const hostTarget = `${process.platform}-${process.arch === "x64" ? "x64" : process.arch}`

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(root, rel), "utf8"))
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

function verifyExecutable(filePath) {
  const stats = statSync(filePath)
  if (!stats.isFile()) throw new Error(`not a file: ${filePath}`)
  if (!filePath.endsWith(".exe") && (stats.mode & 0o111) === 0) {
    throw new Error(`binary is not executable: ${filePath}`)
  }
}

function verifyHostBinaryVersion(filePath, expectedVersion) {
  const output = run(filePath, ["version"])
  let version
  try {
    version = JSON.parse(output).version
  } catch (_error) {
    throw new Error(`host binary version output is not JSON: ${output.trim()}`)
  }
  if (version !== expectedVersion) {
    throw new Error(`host binary reports ${version}, expected ${expectedVersion}`)
  }
}

const rootPkg = readJson("package.json")
const version = rootPkg.version
const tag = `v${version}`
const releaseDir = path.join(root, "dist", "releases", tag)

if (!existsSync(releaseDir)) {
  throw new Error(`missing release directory: ${path.relative(root, releaseDir)}`)
}

for (const [target, binaryRel] of packageTargets) {
  const packageJson = readJson(`platforms/${target}/package.json`)
  const expectedName = `@bilink-ai/cli-${target}`
  if (packageJson.name !== expectedName) {
    throw new Error(`package name mismatch for ${target}`)
  }
  if (packageJson.version !== version) {
    throw new Error(`${expectedName} version ${packageJson.version} does not match root ${version}`)
  }
  if (rootPkg.optionalDependencies?.[expectedName] !== version) {
    throw new Error(`root optional dependency ${expectedName} does not match ${version}`)
  }
  const binaryPath = path.join(root, "platforms", target, binaryRel)
  verifyExecutable(binaryPath)
  if (target === hostTarget) {
    verifyHostBinaryVersion(binaryPath, version)
  }
}

const manifest = readJson(path.join("dist", "releases", tag, "bilink-release-manifest.json"))
if (manifest.version !== tag) {
  throw new Error(`manifest version ${manifest.version} does not match ${tag}`)
}

const checksumsText = readFileSync(path.join(releaseDir, "checksums.txt"), "utf8")
const checksums = new Map(
  checksumsText
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [digest, archive] = line.trim().split(/\s+/)
      return [archive, digest]
    }),
)

for (const target of archiveTargets) {
  const archive = `bilink-${target}.tar.gz`
  const archivePath = path.join(releaseDir, archive)
  if (!existsSync(archivePath)) throw new Error(`missing archive: ${archive}`)
  const digest = sha256(archivePath)
  if (checksums.get(archive) !== digest) {
    throw new Error(`checksum mismatch for ${archive}`)
  }
  const artifact = manifest.artifacts?.find((item) => item.archive === archive)
  if (!artifact) throw new Error(`manifest missing ${archive}`)
  if (artifact.platform !== target || artifact.sha256 !== digest || artifact.size_bytes !== statSync(archivePath).size) {
    throw new Error(`manifest metadata mismatch for ${archive}`)
  }
  const listing = run("tar", ["-tzf", archivePath]).trim().split("\n")
  if (listing.length !== 1 || listing[0] !== "bilink") {
    throw new Error(`${archive} must contain exactly one root binary named bilink`)
  }
}

const expectedArchives = archiveTargets.map((target) => `bilink-${target}.tar.gz`).sort()
const actualArchives = readdirSync(releaseDir)
  .filter((name) => /^bilink-.*\.tar\.gz$/.test(name))
  .sort()
if (JSON.stringify(actualArchives) !== JSON.stringify(expectedArchives)) {
  throw new Error(`unexpected archives: ${actualArchives.join(", ")}`)
}

console.log(`release ${tag}: PASS`)
