import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const hostTarget = `${process.platform}-${process.arch === "x64" ? "x64" : process.arch}`
const targets = [
  {
    name: "darwin-arm64",
    packageDir: "platforms/darwin-arm64",
    binaryName: "bilink",
    archive: "tar.gz",
    sources: [
      "bilink-cli/rust/target/aarch64-apple-darwin/release/bilink",
      "cli/rust/target/aarch64-apple-darwin/release/bilink",
      "cli/rust/target/release/bilink",
      "cli/platforms/darwin-arm64/bin/bilink",
    ],
  },
  {
    name: "darwin-x64",
    packageDir: "platforms/darwin-x64",
    binaryName: "bilink",
    archive: "tar.gz",
    sources: [
      "bilink-cli/rust/target/x86_64-apple-darwin/release/bilink",
      "cli/rust/target/x86_64-apple-darwin/release/bilink",
    ],
  },
  {
    name: "linux-arm64",
    packageDir: "platforms/linux-arm64",
    binaryName: "bilink",
    archive: "tar.gz",
    sources: [
      "bilink-cli/rust/target/aarch64-unknown-linux-musl/release/bilink",
      "cli/rust/target/aarch64-unknown-linux-musl/release/bilink",
    ],
  },
  {
    name: "linux-x64",
    packageDir: "platforms/linux-x64",
    binaryName: "bilink",
    archive: "tar.gz",
    sources: [
      "bilink-cli/rust/target/x86_64-unknown-linux-musl/release/bilink",
      "cli/rust/target/x86_64-unknown-linux-musl/release/bilink",
    ],
  },
  {
    name: "win32-arm64",
    packageDir: "platforms/win32-arm64",
    binaryName: "bilink.exe",
    archive: "zip",
    sources: [
      "bilink-cli/rust/target/aarch64-pc-windows-gnullvm/release/bilink.exe",
      "cli/rust/target/aarch64-pc-windows-gnullvm/release/bilink.exe",
    ],
  },
  {
    name: "win32-x64",
    packageDir: "platforms/win32-x64",
    binaryName: "bilink.exe",
    archive: "zip",
    sources: [
      "bilink-cli/rust/target/x86_64-pc-windows-gnu/release/bilink.exe",
      "cli/rust/target/x86_64-pc-windows-gnu/release/bilink.exe",
    ],
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
  if (!args.version || !/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(args.version)) {
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

function copyRequired(sourceRoot, sourceRel, targetRel = sourceRel) {
  const sourcePath = path.join(sourceRoot, sourceRel)
  if (!existsSync(sourcePath)) {
    throw new Error(`missing source file: ${sourcePath}`)
  }
  copyFileSync(sourcePath, path.join(root, targetRel))
}

function packageMetadata(sourcePkg, targetPkg, fields) {
  for (const field of fields) {
    if (Object.hasOwn(sourcePkg, field)) {
      targetPkg[field] = sourcePkg[field]
    } else {
      delete targetPkg[field]
    }
  }
}

function syncSourceMetadata(sourceRoot) {
  const sourceCliRoot = firstExisting(sourceRoot, ["bilink-cli/package.json", "cli/package.json"])
  if (!sourceCliRoot) {
    throw new Error(`missing private source CLI package under: ${sourceRoot}`)
  }
  const sourceCliDir = path.dirname(sourceCliRoot)

  copyRequired(sourceCliDir, "LICENSE")

  const rootSourcePkg = JSON.parse(readFileSync(sourceCliRoot, "utf8"))
  const rootPkg = readJson("package.json")
  packageMetadata(rootSourcePkg, rootPkg, [
    "name",
    "license",
    "type",
    "bin",
    "files",
  ])
  delete rootPkg.private
  rootPkg.publishConfig = {
    access: "public",
    registry: "https://registry.npmjs.org/",
  }
  rootPkg.scripts = {
    "release:prepare": "node scripts/prepare-release.mjs",
    "release:verify": "node scripts/verify-release.mjs",
    "pack:dry-run": "node scripts/pack-dry-run.mjs",
    "publish:npm": "node scripts/publish-npm.mjs",
    test: "node scripts/verify-distribution.mjs",
    prepack: "node scripts/verify-distribution.mjs",
    prepublishOnly: "node scripts/verify-distribution.mjs && node scripts/verify-release.mjs",
  }
  writeJson("package.json", rootPkg)

  for (const target of targets) {
    const sourcePackageRel = path.join(target.packageDir, "package.json")
    const sourcePackagePath = path.join(sourceCliDir, sourcePackageRel.replace(/^platforms\//, "platforms/"))
    if (!existsSync(sourcePackagePath)) {
      throw new Error(`missing source package metadata: ${sourcePackagePath}`)
    }

    copyRequired(sourceCliDir, path.join(target.packageDir, "LICENSE"))

    const sourcePkg = JSON.parse(readFileSync(sourcePackagePath, "utf8"))
    const pkg = readJson(path.join(target.packageDir, "package.json"))
    packageMetadata(sourcePkg, pkg, [
      "name",
      "description",
      "license",
      "type",
      "bin",
      "os",
      "cpu",
      "files",
    ])
    delete pkg.private
    pkg.publishConfig = {
      access: "public",
      registry: "https://registry.npmjs.org/",
    }
    pkg.scripts = {
      prepack: "node ../../scripts/verify-platform-package.mjs .",
      prepublishOnly: "node ../../scripts/verify-platform-package.mjs .",
    }
    writeJson(path.join(target.packageDir, "package.json"), pkg)
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function replaceRequired(rel, pattern, replacement) {
  const filePath = path.join(root, rel)
  const before = readFileSync(filePath, "utf8")
  if (!pattern.test(before)) {
    throw new Error(`expected release version pattern was not found in ${rel}`)
  }
  const after = before.replace(pattern, replacement)
  if (after !== before) writeFileSync(filePath, after)
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

function updateLockfileVersions(version) {
  const lockfile = "pnpm-lock.yaml"
  let text = readFileSync(path.join(root, lockfile), "utf8")
  for (const target of targets) {
    const packageName = `@bilink-ai/cli-${target.name}`
    const pattern = new RegExp(
      `('${escapeRegExp(packageName)}':\\n[ \\t]+specifier: )[^\\n]+(\\n[ \\t]+version: )[^\\n]+`,
      "m",
    )
    if (!pattern.test(text)) {
      throw new Error(`expected lockfile entry for ${packageName} was not found`)
    }
    text = text.replace(
      pattern,
      (_match, specifierPrefix, versionPrefix) =>
        `${specifierPrefix}${version}${versionPrefix}${version}`,
    )
  }
  writeFileSync(path.join(root, lockfile), text)
}

function firstExisting(sourceRoot, rels) {
  for (const rel of rels) {
    const candidate = path.join(sourceRoot, rel)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

function verifyHostSourceBinaryVersion(filePath, expectedVersion) {
  const result = spawnSync(filePath, ["version"], { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`failed to run source binary ${filePath}: ${result.stderr || result.stdout}`)
  }
  let version
  try {
    version = JSON.parse(result.stdout).version
  } catch (_error) {
    throw new Error(`source binary version output is not JSON: ${result.stdout.trim()}`)
  }
  if (version !== expectedVersion) {
    throw new Error(`source binary ${filePath} reports ${version}, expected ${expectedVersion}`)
  }
}

function tarOctal(value, length) {
  const text = value.toString(8)
  if (text.length > length - 1) {
    throw new Error(`tar value ${value} does not fit in ${length} bytes`)
  }
  return `${text.padStart(length - 1, "0")}\0`
}

function writeTarString(header, offset, length, value) {
  const text = Buffer.from(value)
  if (text.length > length) {
    throw new Error(`tar field value is too long: ${value}`)
  }
  text.copy(header, offset)
}

function createSingleFileTarGz(filePath, archivePath) {
  const file = readFileSync(filePath)
  const header = Buffer.alloc(512)
  writeTarString(header, 0, 100, "bilink")
  writeTarString(header, 100, 8, tarOctal(0o755, 8))
  writeTarString(header, 108, 8, tarOctal(0, 8))
  writeTarString(header, 116, 8, tarOctal(0, 8))
  writeTarString(header, 124, 12, tarOctal(file.length, 12))
  writeTarString(header, 136, 12, tarOctal(0, 12))
  header.fill(0x20, 148, 156)
  writeTarString(header, 156, 1, "0")
  writeTarString(header, 257, 6, "ustar\0")
  writeTarString(header, 263, 2, "00")

  const checksum = [...header].reduce((sum, value) => sum + value, 0)
  writeTarString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `)

  const padding = Buffer.alloc((512 - (file.length % 512)) % 512)
  const end = Buffer.alloc(1024)
  const tar = Buffer.concat([header, file, padding, end])
  writeFileSync(archivePath, gzipSync(tar, { mtime: 0 }))
}

const crcTable = Array.from({ length: 256 }, (_value, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return crc >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function createSingleFileZip(filePath, archivePath) {
  const file = readFileSync(filePath)
  const name = Buffer.from("bilink.exe")
  const digest = crc32(file)
  const localHeader = Buffer.alloc(30)
  localHeader.writeUInt32LE(0x04034b50, 0)
  localHeader.writeUInt16LE(20, 4)
  localHeader.writeUInt16LE(0, 6)
  localHeader.writeUInt16LE(0, 8)
  localHeader.writeUInt16LE(0, 10)
  localHeader.writeUInt16LE(0x0021, 12)
  localHeader.writeUInt32LE(digest, 14)
  localHeader.writeUInt32LE(file.length, 18)
  localHeader.writeUInt32LE(file.length, 22)
  localHeader.writeUInt16LE(name.length, 26)
  localHeader.writeUInt16LE(0, 28)

  const centralDirectory = Buffer.alloc(46)
  centralDirectory.writeUInt32LE(0x02014b50, 0)
  centralDirectory.writeUInt16LE(20, 4)
  centralDirectory.writeUInt16LE(20, 6)
  centralDirectory.writeUInt16LE(0, 8)
  centralDirectory.writeUInt16LE(0, 10)
  centralDirectory.writeUInt16LE(0, 12)
  centralDirectory.writeUInt16LE(0x0021, 14)
  centralDirectory.writeUInt32LE(digest, 16)
  centralDirectory.writeUInt32LE(file.length, 20)
  centralDirectory.writeUInt32LE(file.length, 24)
  centralDirectory.writeUInt16LE(name.length, 28)
  centralDirectory.writeUInt16LE(0, 30)
  centralDirectory.writeUInt16LE(0, 32)
  centralDirectory.writeUInt16LE(0, 34)
  centralDirectory.writeUInt16LE(0, 36)
  centralDirectory.writeUInt32LE(0, 38)
  centralDirectory.writeUInt32LE(0, 42)

  const centralDirectoryOffset = localHeader.length + name.length + file.length
  const centralDirectorySize = centralDirectory.length + name.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(centralDirectorySize, 12)
  end.writeUInt32LE(centralDirectoryOffset, 16)
  end.writeUInt16LE(0, 20)

  writeFileSync(
    archivePath,
    Buffer.concat([localHeader, name, file, centralDirectory, name, end]),
  )
}

const args = parseArgs(process.argv.slice(2))
const version = packageVersion(args.version)
const releaseDir = path.join(root, "dist", "releases", args.version)

syncSourceMetadata(args.source)
updatePackageVersions(version)
updateLockfileVersions(version)
replaceRequired(
  "README.md",
  /BILINK_VERSION=v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)? curl -fsSL https:\/\/bilink\.ai\/cli\/install\.sh \| sh/,
  `BILINK_VERSION=${args.version} curl -fsSL https://bilink.ai/cli/install.sh | sh`,
)

if (args.syncInstallScript) {
  const installScript = firstExisting(args.source, ["bilink-cli/install.sh", "cli/install.sh"])
  if (!installScript) {
    throw new Error(`missing private source installer under: ${args.source}`)
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
  if (target.name === hostTarget) {
    verifyHostSourceBinaryVersion(sourceBinary, version)
  }
  const outputDir = path.join(root, target.packageDir, "bin")
  const outputBinary = path.join(outputDir, target.binaryName)
  mkdirSync(outputDir, { recursive: true })
  copyFileSync(sourceBinary, outputBinary)
  if (!target.binaryName.endsWith(".exe")) {
    chmodSync(outputBinary, 0o755)
  }

  if (target.archive === "tar.gz") {
    createSingleFileTarGz(outputBinary, path.join(releaseDir, `bilink-${target.name}.tar.gz`))
  } else if (target.archive === "zip") {
    createSingleFileZip(outputBinary, path.join(releaseDir, `bilink-${target.name}.zip`))
  }
}

const archives = targets
  .filter((target) => target.archive)
  .map((target) => `bilink-${target.name}.${target.archive}`)
  .sort()
const lines = []
const artifacts = []
for (const archive of archives) {
  const archivePath = path.join(releaseDir, archive)
  const digest = sha256(archivePath)
  lines.push(`${digest}  ${archive}`)
  artifacts.push({
    platform: archive.replace(/^bilink-/, "").replace(/\.(tar\.gz|zip)$/, ""),
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
