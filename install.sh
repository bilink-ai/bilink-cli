#!/usr/bin/env sh
set -eu

version="${BILINK_VERSION:-latest}"
install_dir="${BILINK_INSTALL_DIR:-$HOME/.bilink/bin}"
release_base="${BILINK_RELEASE_BASE:-https://github.com/bilink-ai/bilink-cli/releases}"
download_base="${BILINK_DOWNLOAD_BASE:-}"
allow_downgrade="${BILINK_ALLOW_DOWNGRADE:-}"
supported_platforms="darwin-arm64, darwin-x64, linux-arm64, linux-x64"
header_printed=0
tmp_dir=""
metadata_tmp_dir=""
tmp_binary=""

if [ -t 1 ]; then
  is_tty=1
else
  is_tty=0
fi

say() {
  printf '%s\n' "$*"
}

err() {
  printf '%s\n' "$*" >&2
}

print_logo() {
  logo_dim=$(printf '\033[90m')
  logo_bright=$(printf '\033[97m')
  logo_reset=$(printf '\033[0m')
  printf '%s%s%s%s%s\n' "$logo_dim" "████        ██  " "$logo_bright" "██        ██                  ██  ██" "$logo_reset"
  printf '%s%s%s%s%s\n' "$logo_dim" "██  ██          " "$logo_bright" "██                            ██ ██ " "$logo_reset"
  printf '%s%s%s%s%s\n' "$logo_dim" "██  ██  ██  ██  " "$logo_bright" "██    ██  ██████    ██  ██    ███  " "$logo_reset"
  printf '%s%s%s%s%s\n' "$logo_dim" "████   ██  ██  " "$logo_bright" "██    ██  ██  ██    ██ ██     ███  " "$logo_reset"
  printf '%s%s%s%s%s\n' "$logo_dim" "██  ██  ██  ██  " "$logo_bright" "██    ██  ██  ██    ████      ██ ██ " "$logo_reset"
  printf '%s%s%s%s%s\n' "$logo_dim" "████   ██  ██  " "$logo_bright" "████  ██  ██  ██    ██ ██     ██  ██" "$logo_reset"
  printf '%s%s%s\n' "$logo_dim" " ░░░░   ░░  ░░  ░░░░  ░░  ░░  ░░    ░░ ░░     ░░  ░░" "$logo_reset"
}

print_header() {
  if [ "$header_printed" -eq 1 ]; then
    return
  fi
  if [ "$is_tty" -eq 1 ]; then
    print_logo
    say ""
  fi
  say "Bilink CLI installer"
  header_printed=1
}

field() {
  if [ "$is_tty" -eq 1 ]; then
    printf '%-14s %s\n' "$1" "$2"
  fi
}

log_step() {
  if [ "$is_tty" -eq 0 ]; then
    say "$1"
  fi
}

fail() {
  print_header
  say "" >&2
  err "Error: $1"
  shift || true
  for detail in "$@"; do
    err "$detail"
  done
  exit 1
}

cleanup() {
  if [ -n "$tmp_dir" ]; then
    rm -rf "$tmp_dir"
  fi
  if [ -n "$metadata_tmp_dir" ]; then
    rm -rf "$metadata_tmp_dir"
  fi
  if [ -n "$tmp_binary" ]; then
    rm -f "$tmp_binary"
  fi
}
trap cleanup EXIT INT TERM

normalize_version() {
  printf '%s' "$1" | sed 's/^v//'
}

parse_version_output() {
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

parse_manifest_version() {
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

read_binary_version() {
  binary_path="$1"
  output="$("$binary_path" version 2>/dev/null || true)"
  parsed="$(printf '%s\n' "$output" | parse_version_output)"
  if [ -n "$parsed" ]; then
    normalize_version "$parsed"
    return
  fi
  printf '%s\n' "$output" | sed -n 's/.*\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | head -n 1
}

version_cmp() {
  awk -v a="$(normalize_version "$1")" -v b="$(normalize_version "$2")" '
    function split_version(value, out) {
      n = split(value, parts, ".")
      for (i = 1; i <= 3; i++) {
        out[i] = i <= n && parts[i] != "" ? parts[i] + 0 : 0
      }
    }
    BEGIN {
      split_version(a, av)
      split_version(b, bv)
      for (i = 1; i <= 3; i++) {
        if (av[i] < bv[i]) { print -1; exit }
        if (av[i] > bv[i]) { print 1; exit }
      }
      print 0
    }'
}

sha256_file() {
  file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    fail "archive verification failed" "Reason: sha256sum or shasum is required"
  fi
}

download_quiet() {
  source_url="$1"
  destination="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$source_url" -o "$destination" >/dev/null 2>&1
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$source_url" -O "$destination" >/dev/null 2>&1
  else
    fail "missing downloader" "curl or wget is required"
  fi
}

download_archive() {
  source_url="$1"
  destination="$2"
  if [ "$is_tty" -eq 1 ]; then
    say "Downloading $archive"
  else
    say "download=$archive"
  fi
  if command -v curl >/dev/null 2>&1; then
    if [ "$is_tty" -eq 1 ]; then
      curl -fL --progress-bar "$source_url" -o "$destination" || fail "download failed" "URL: $source_url"
    else
      curl -fsSL "$source_url" -o "$destination" || fail "download failed" "URL: $source_url"
    fi
  elif command -v wget >/dev/null 2>&1; then
    if [ "$is_tty" -eq 1 ]; then
      wget "$source_url" -O "$destination" || fail "download failed" "URL: $source_url"
    else
      wget -q "$source_url" -O "$destination" || fail "download failed" "URL: $source_url"
    fi
  else
    fail "missing downloader" "curl or wget is required"
  fi
}

verify_archive() {
  archive_path="$1"
  if [ "$is_tty" -eq 1 ]; then
    say ""
    say "Verifying archive..."
  fi

  checksums_path="$tmp_dir/checksums.txt"
  manifest_path="$tmp_dir/bilink-release-manifest.json"
  expected=""

  if download_quiet "$checksums_url" "$checksums_path"; then
    expected="$(awk -v name="$archive" '$0 ~ name {print $1; exit}' "$checksums_path")"
    source_name="checksums.txt"
  elif download_quiet "$manifest_url" "$manifest_path"; then
    expected="$(sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([0-9a-fA-F][0-9a-fA-F]*\)".*/\1/p' "$manifest_path" | head -n 1)"
    source_name="bilink-release-manifest.json"
  else
    fail "archive verification failed" "Archive: $archive" "Checksum: $checksums_url" "Manifest: $manifest_url"
  fi

  if [ -z "$expected" ]; then
    fail "archive verification failed" "Archive: $archive" "Reason: missing checksum in $source_name"
  fi

  actual="$(sha256_file "$archive_path")"
  if [ "$actual" != "$expected" ]; then
    fail "archive verification failed" "Archive: $archive" "Source: $source_name"
  fi
  log_step "verify=ok"
}

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"

case "$arch" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="x64" ;;
esac

detected_platform="${os}-${arch}"

case "$os" in
  darwin|linux) ;;
  *)
    fail "unsupported platform" "Detected: $detected_platform" "Supported: $supported_platforms"
    ;;
esac

case "$arch" in
  arm64|x64) ;;
  *)
    fail "unsupported platform" "Detected: $detected_platform" "Supported: $supported_platforms"
    ;;
esac

platform="${os}-${arch}"
archive="bilink-${platform}.tar.gz"
binary_path="$install_dir/bilink"

if [ -n "$download_base" ]; then
  url="${download_base}/${version}/${archive}"
  metadata_base="${download_base}/${version}"
  source_label="mirror"
elif [ "$version" = "latest" ]; then
  url="${release_base}/latest/download/${archive}"
  metadata_base="${release_base}/latest/download"
  source_label="GitHub Releases"
else
  url="${release_base}/download/${version}/${archive}"
  metadata_base="${release_base}/download/${version}"
  source_label="GitHub Releases"
fi

checksums_url="${metadata_base}/checksums.txt"
manifest_url="${metadata_base}/bilink-release-manifest.json"
target_version="$(normalize_version "$version")"
if [ "$version" = "latest" ]; then
  target_version=""
  target_label="latest"
else
  target_label="$version"
fi

if [ "$version" = "latest" ]; then
  metadata_tmp_dir="$(mktemp -d)" || fail "local io error" "Reason: failed to create temporary directory"
  latest_manifest="$metadata_tmp_dir/bilink-release-manifest.json"
  if download_quiet "$manifest_url" "$latest_manifest"; then
    resolved_version="$(parse_manifest_version < "$latest_manifest")"
    if [ -n "$resolved_version" ]; then
      target_version="$(normalize_version "$resolved_version")"
      target_label="$resolved_version"
    fi
  fi
fi

print_header
say ""
field "Platform" "$platform"
field "Target version" "$target_label"
field "Install dir" "$install_dir"
field "Source" "$source_label"
say ""

if [ "$is_tty" -eq 1 ]; then
  say "Checking current installation..."
else
  log_step "platform=$platform"
  log_step "target_version=$target_label"
  log_step "install_dir=$install_dir"
fi

current_version=""
current_label="not installed"
if [ -e "$binary_path" ]; then
  if [ -x "$binary_path" ]; then
    current_version="$(read_binary_version "$binary_path")"
    if [ -n "$current_version" ]; then
      current_label="$current_version"
    else
      current_label="unreadable"
    fi
  else
    current_label="not executable"
  fi
fi
field "Current" "$current_label"
log_step "current=$current_label"
say ""

if [ -n "$current_version" ] && [ -n "$target_version" ]; then
  comparison="$(version_cmp "$current_version" "$target_version")"
  if [ "$comparison" -eq 0 ]; then
    say "Bilink CLI is already installed and up to date."
    say "Binary: $binary_path"
    exit 0
  fi
  if [ "$comparison" -gt 0 ] && [ "$allow_downgrade" != "1" ]; then
    fail "downgrade blocked" "Current: $current_version" "Target: $target_version" "Set BILINK_ALLOW_DOWNGRADE=1 to allow downgrade."
  fi
  if [ "$comparison" -gt 0 ]; then
    action="downgrade"
  else
    action="upgrade"
  fi
elif [ -e "$binary_path" ]; then
  action="reinstall"
else
  action="install"
fi

case "$action" in
  upgrade) field "Upgrade" "$current_version -> $target_version" ;;
  downgrade) field "Downgrade" "$current_version -> $target_version" ;;
  reinstall) field "Reinstall" "$current_label -> $target_label" ;;
esac
log_step "action=$action from=$current_label to=$target_label"
say ""

mkdir -p "$install_dir" || fail "install dir not writable" "Install dir: $install_dir"
if [ ! -d "$install_dir" ] || [ ! -w "$install_dir" ]; then
  fail "install dir not writable" "Install dir: $install_dir"
fi

tmp_dir="$(mktemp -d)" || fail "local io error" "Reason: failed to create temporary directory"
archive_path="$tmp_dir/$archive"
extract_dir="$tmp_dir/extract"
mkdir -p "$extract_dir"

download_archive "$url" "$archive_path"
verify_archive "$archive_path"

tar -xzf "$archive_path" -C "$extract_dir" || fail "archive extract failed" "Archive: $archive"
extracted_binary="$extract_dir/bilink"
if [ ! -f "$extracted_binary" ]; then
  fail "archive missing binary" "Archive: $archive" "Expected: bilink"
fi
chmod +x "$extracted_binary"

installed_version="$(read_binary_version "$extracted_binary")"
if [ -z "$installed_version" ]; then
  installed_version="$target_version"
fi
if [ -z "$installed_version" ]; then
  fail "archive verification failed" "Archive: $archive" "Reason: installed binary version is unreadable"
fi

if [ "$version" = "latest" ] && [ -n "$current_version" ]; then
  latest_comparison="$(version_cmp "$current_version" "$installed_version")"
  if [ "$latest_comparison" -eq 0 ]; then
    say ""
    say "Bilink CLI is already installed and up to date."
    say "Binary: $binary_path"
    exit 0
  fi
  if [ "$latest_comparison" -gt 0 ] && [ "$allow_downgrade" != "1" ]; then
    fail "downgrade blocked" "Current: $current_version" "Target: $installed_version" "Set BILINK_ALLOW_DOWNGRADE=1 to allow downgrade."
  fi
fi

if [ "$is_tty" -eq 1 ]; then
  if [ "$action" = "install" ] || [ "$action" = "reinstall" ]; then
    say "Installing binary..."
  else
    say "Replacing binary..."
  fi
fi

tmp_binary="$install_dir/.bilink.tmp.$$"
install "$extracted_binary" "$tmp_binary" || fail "install dir not writable" "Install dir: $install_dir"
mv "$tmp_binary" "$binary_path" || fail "install dir not writable" "Install dir: $install_dir"
tmp_binary=""

say ""
case "$action" in
  upgrade) say "Upgraded Bilink CLI to $installed_version" ;;
  downgrade) say "Downgraded Bilink CLI to $installed_version" ;;
  reinstall) say "Reinstalled Bilink CLI $installed_version" ;;
  *) say "Installed Bilink CLI $installed_version" ;;
esac
say "Binary: $binary_path"
log_step "installed=$binary_path version=$installed_version"
say ""
say "Add this to PATH if needed:"
say '  export PATH="$HOME/.bilink/bin:$PATH"'
