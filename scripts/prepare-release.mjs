import { createHash } from "node:crypto"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const targets = [
  {
    name: "darwin-arm64",
    packageDir: "platforms/darwin-arm64",
    binaryName: "bilink",
    archive: true,
    sources: [
      "bilink-cli/rust/target/aarch64-apple-darwin/release/bilink",
      "bilink-cli/rust/target/release/bilink",
      "bilink-cli/platforms/darwin-arm64/bin/bilink",
    ],
  },
  {
    name: "darwin-x64",
    packageDir: "platforms/darwin-x64",
    binaryName: "bilink",
    archive: true,
    sources: ["bilink-cli/rust/target/x86_64-apple-darwin/release/bilink"],
  },
  {
    name: "linux-arm64",
    packageDir: "platforms/linux-arm64",
    binaryName: "bilink",
    archive: true,
    sources: ["bilink-cli/rust/target/aarch64-unknown-linux-musl/release/bilink"],
  },
  {
    name: "linux-x64",
    packageDir: "platforms/linux-x64",
    binaryName: "bilink",
    archive: true,
    sources: ["bilink-cli/rust/target/x86_64-unknown-linux-musl/release/bilink"],
  },
  {
    name: "win32-arm64",
    packageDir: "platforms/win32-arm64",
    binaryName: "bilink.exe",
    archive: false,
    sources: ["bilink-cli/rust/target/aarch64-pc-windows-gnullvm/release/bilink.exe"],
  },
  {
    name: "win32-x64",
    packageDir: "platforms/win32-x64",
    binaryName: "bilink.exe",
    archive: false,
    sources: ["bilink-cli/rust/target/x86_64-pc-windows-gnu/release/bilink.exe"],
  },
]

function parseArgs(argv) {
  const args = {
    source: path.resolve(root, "../bilink"),
    version: null,
    syncInstallScript: true,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--source") {
      args.source = path.resolve(process.cwd(), argv[index + 1] ?? "")
      index += 1
      continue
    }
    if (value === "--version") {
      args.version = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (value === "--no-install-script") {
      args.syncInstallScript = false
      continue
    }
  }
  if (!args.version) {
    throw new Error("usage: pnpm release:prepare -- --version v0.2.0 [--source ../bilink]")
  }
  return args
}

function packageVersion(tag) {
  return tag.replace(/^v/, "")
}

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(root, rel), "utf8"))
}

function writeJson(rel, value) {
  writeFileSync(path.join(root, rel), `${JSON.stringify(value, null, 2)}\n`)
}

function updatePackageVersions(version) {
  const rootPkg = readJson("package.json")
  rootPkg.version = version
  for (const packageName of Object.keys(rootPkg.optionalDependencies ?? {})) {
    if (packageName.startsWith("@bilink-ai/cli-")) {
      rootPkg.optionalDependencies[packageName] = version
    }
  }
  writeJson("package.json", rootPkg)

  for (const target of targets) {
    const rel = path.join(target.packageDir, "package.json")
    const pkg = readJson(rel)
    pkg.version = version
    writeJson(rel, pkg)
  }
}

function firstExisting(sourceRoot, rels) {
  for (const rel of rels) {
    const candidate = path.join(sourceRoot, rel)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`)
  }
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

const args = parseArgs(process.argv.slice(2))
const version = packageVersion(args.version)
const releaseDir = path.join(root, "dist", "releases", args.version)

updatePackageVersions(version)

if (args.syncInstallScript) {
  const installScript = path.join(args.source, "bilink-cli", "install.sh")
  if (!existsSync(installScript)) {
    throw new Error(`missing private source installer: ${installScript}`)
  }
  copyFileSync(installScript, path.join(root, "install.sh"))
  chmodSync(path.join(root, "install.sh"), 0o755)
}

mkdirSync(releaseDir, { recursive: true })

for (const target of targets) {
  const sourceBinary = firstExisting(args.source, target.sources)
  if (!sourceBinary) {
    throw new Error(`missing built binary for ${target.name}; checked ${target.sources.join(", ")}`)
  }
  const outputDir = path.join(root, target.packageDir, "bin")
  const outputBinary = path.join(outputDir, target.binaryName)
  mkdirSync(outputDir, { recursive: true })
  copyFileSync(sourceBinary, outputBinary)
  if (!target.binaryName.endsWith(".exe")) {
    chmodSync(outputBinary, 0o755)
  }

  if (target.archive) {
    const staging = mkdtempSync(path.join(tmpdir(), "bilink-release-"))
    try {
      const stagedBinary = path.join(staging, "bilink")
      copyFileSync(outputBinary, stagedBinary)
      chmodSync(stagedBinary, 0o755)
      run("tar", ["-czf", path.join(releaseDir, `bilink-${target.name}.tar.gz`), "-C", staging, "bilink"])
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  }
}

const archives = targets
  .filter((target) => target.archive)
  .map((target) => `bilink-${target.name}.tar.gz`)
  .sort()
const lines = []
const artifacts = []
for (const archive of archives) {
  const archivePath = path.join(releaseDir, archive)
  const digest = sha256(archivePath)
  lines.push(`${digest}  ${archive}`)
  artifacts.push({
    platform: archive.replace(/^bilink-/, "").replace(/\.tar\.gz$/, ""),
    archive,
    sha256: digest,
    size_bytes: statSync(archivePath).size,
  })
}

writeFileSync(path.join(releaseDir, "checksums.txt"), `${lines.join("\n")}\n`)
writeFileSync(
  path.join(releaseDir, "bilink-release-manifest.json"),
  `${JSON.stringify({ version: args.version, artifacts }, null, 2)}\n`,
)

console.log(`prepared Bilink CLI distribution ${args.version}`)
