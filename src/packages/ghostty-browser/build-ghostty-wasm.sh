#!/usr/bin/env bash
set -euo pipefail

readonly GHOSTTY_REVISION="2ed382a15566b267c32fae440b065f7844b15bfb"
readonly REQUIRED_ZIG_VERSION="0.15.2"
readonly EXPECTED_SHA256="91a4a82e85320c75f9d9ad81124da347b6bbecfb1866f4884b95b370f4f81bb5"
readonly EXPECTED_BYTES="555074"
readonly GHOSTTY_REPOSITORY="https://github.com/ghostty-org/ghostty.git"

if ! command -v zig >/dev/null 2>&1; then
  echo "zig ${REQUIRED_ZIG_VERSION} is required" >&2
  exit 1
fi

actual_zig_version=$(zig version)
if [[ "${actual_zig_version}" != "${REQUIRED_ZIG_VERSION}" ]]; then
  echo "expected zig ${REQUIRED_ZIG_VERSION}, found ${actual_zig_version}" >&2
  exit 1
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/ghostty-vt-wasm.XXXXXXXX")

cleanup() {
  case "${build_dir}" in
    "${TMPDIR:-/tmp}"/ghostty-vt-wasm.*) rm -rf -- "${build_dir}" ;;
    *) echo "refusing to remove unexpected build directory: ${build_dir}" >&2 ;;
  esac
}
trap cleanup EXIT

git -C "${build_dir}" init --quiet
git -C "${build_dir}" remote add origin "${GHOSTTY_REPOSITORY}"
git -C "${build_dir}" fetch --quiet --depth=1 origin "${GHOSTTY_REVISION}"
git -C "${build_dir}" checkout --quiet --detach FETCH_HEAD

actual_revision=$(git -C "${build_dir}" rev-parse HEAD)
if [[ "${actual_revision}" != "${GHOSTTY_REVISION}" ]]; then
  echo "expected Ghostty ${GHOSTTY_REVISION}, checked out ${actual_revision}" >&2
  exit 1
fi

(
  cd -- "${build_dir}"
  zig build -Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
)

wasm_path="${build_dir}/zig-out/bin/ghostty-vt.wasm"
if command -v sha256sum >/dev/null 2>&1; then
  actual_sha256=$(sha256sum "${wasm_path}" | cut -d ' ' -f 1)
elif command -v shasum >/dev/null 2>&1; then
  actual_sha256=$(shasum -a 256 "${wasm_path}" | cut -d ' ' -f 1)
else
  echo "sha256sum or shasum is required" >&2
  exit 1
fi
actual_bytes=$(wc -c < "${wasm_path}" | tr -d '[:space:]')
if [[ "${actual_sha256}" != "${EXPECTED_SHA256}" ]]; then
  echo "WASM digest mismatch: expected ${EXPECTED_SHA256}, got ${actual_sha256}" >&2
  exit 1
fi
if [[ "${actual_bytes}" != "${EXPECTED_BYTES}" ]]; then
  echo "WASM size mismatch: expected ${EXPECTED_BYTES}, got ${actual_bytes}" >&2
  exit 1
fi

install -m 0644 "${wasm_path}" "${script_dir}/assets/ghostty-vt.wasm"
echo "wrote ${script_dir}/assets/ghostty-vt.wasm (${actual_sha256})"
