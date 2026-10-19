# GBA Link core — build instructions

The Link mode of the GBA app uses a **custom mGBA WASM core** instead of the
EmulatorJS CDN core, because the CDN core does not expose the GBA serial port
(SIO) to JavaScript. This document describes how the core in
`defaultPackages/gba/core/` is built, so it can be reproduced from scratch.

## Why a custom build

- **SIO hooks**: link-cable emulation needs JS to see every serial transfer.
  Our wrapper installs a custom `GBASIODriver` (MULTI mode) that calls
  `Module.onSioStart(value)` when the master starts a transfer and lets JS
  complete it with `sioCompleteMulti(d0, d1)` once the peer's value arrived
  over the network.
- **Single-threaded**: aruta.sh is served by GitHub Pages, which cannot send
  the COOP/COEP headers required for SharedArrayBuffer. Upstream WASM builds
  of mGBA (including gbajs3's) use pthreads and therefore cannot run there.
  This build disables threading entirely (`DISABLE_THREADING` path of mGBA).

## Sources & licensing

- Base: [thenick775/mgba](https://github.com/thenick775/mgba) branch
  `feature/wasm` (the core behind [gbajs3](https://github.com/thenick775/gbajs3)),
  itself a fork of [mGBA](https://github.com/mgba-emu/mgba) by endrift.
- mGBA is **MPL-2.0**. The files changed/added by us are in `core-src/` and
  stay under MPL-2.0:
  - `core-src/root-cmake-no-pthreads.patch` — root `CMakeLists.txt`: sets
    `USE_PTHREADS OFF` for Emscripten so `threading.h` auto-defines
    `DISABLE_THREADING`.
  - `core-src/CMakeLists.txt` — replaces `src/platform/wasm/CMakeLists.txt`:
    single-threaded link flags (`MODULARIZE`, `EXPORT_NAME=mGBA`, no
    `-pthread`, `--no-entry`, `ALLOW_MEMORY_GROWTH`).
  - `core-src/stmain.c` — new `src/platform/wasm/stmain.c`: minimal
    single-thread wrapper (no SDL, no mCoreThread). JS drives frames via
    `runFrame()`, reads video from the heap, pulls audio with `readAudio()`
    (32768 Hz stereo int16), and bridges SIO through the netDriver.

## Toolchain

Only Docker is required on the host (emcc/cmake come from the emsdk image,
pinned to the same version the fork uses):

```sh
# 1. clone the fork
git clone --depth 1 --branch feature/wasm https://github.com/thenick775/mgba.git mgba-wasm
cd mgba-wasm

# 2. apply our changes
git apply path/to/core-src/root-cmake-no-pthreads.patch
cp path/to/core-src/CMakeLists.txt src/platform/wasm/CMakeLists.txt
cp path/to/core-src/stmain.c      src/platform/wasm/stmain.c

# 3. build (single-threaded, GBA only, no optional deps)
docker run --rm -v "$PWD":/src -w /src emscripten/emsdk:4.0.4 sh -c '
  git config --global --add safe.directory /src
  mkdir -p build-wasm && cd build-wasm
  emcmake cmake .. -DCMAKE_BUILD_TYPE=Release \
    -DM_CORE_GBA=ON -DM_CORE_GB=ON \
    -DUSE_FFMPEG=OFF -DUSE_ZLIB=OFF -DUSE_PNG=OFF -DUSE_MINIZIP=OFF -DUSE_LIBZIP=OFF \
    -DUSE_SQLITE3=OFF -DUSE_ELF=OFF -DUSE_LZMA=OFF -DUSE_EPOXY=OFF -DUSE_DISCORD_RPC=OFF \
    -DENABLE_DEBUGGERS=OFF -DENABLE_SCRIPTING=OFF \
    -DBUILD_QT=OFF -DBUILD_SDL=OFF -DBUILD_TEST=OFF -DBUILD_SUITE=OFF \
  && make -j8 mgba.js'

# 4. artifacts
# build-wasm/wasm/mgba.js   (~78 KB)  → defaultPackages/gba/core/mgba.js
# build-wasm/wasm/mgba.wasm (~640 KB) → defaultPackages/gba/core/mgba.wasm
```

## JS API of the core

`mGBA(opts)` (global factory, MODULARIZE) → `Module` promise. Exposed
(via `Module.cwrap`/`ccall`, all `EMSCRIPTEN_KEEPALIVE`):

| function | signature | notes |
|---|---|---|
| `loadGame` | `(path:string) → bool` | ROM from Emscripten FS; loads `/gba_bios.bin` if present; saves under `/data/saves` |
| `quitGame` | `() → void` | unload + free |
| `runFrame` | `() → void` | run exactly one frame (call from rAF) |
| `setKeys` | `(mask:int) → void` | GBA key bits: A,B,Sel,Start,→,←,↑,↓,R,L |
| `getVideoBufferPtr/Width/Height` | `() → int` | RGBA bytes in heap; force alpha 255 when blitting |
| `readAudio` | `(ptr:int16*, frames:int) → int` | interleaved stereo @ 32768 Hz |
| `sioSetLink` | `(id:int, connected:int)` | id 0 = master, 1 = slave |
| `sioGetSendValue` | `() → int` | current SIOMLT_SEND |
| `sioCompleteMulti` | `(d0:int, d1:int)` | finish transfer on BOTH peers with both values |
| `sioTransferPending` | `() → int` | master waiting for peer |
| `flushSave` | `() → void` | force SRAM → `/data/saves/<rom>.sav` |
| `saveState/loadState` | `(slot:int) → bool` | savestates under `/data/states` |

**SIO contract**: `Module.onSioStart(value)` fires *synchronously inside*
`runFrame` on the master when its game starts a MULTI transfer. Do **not**
re-enter the wasm from that callback — queue the value and call
`sioCompleteMulti` on both instances before the next `runFrame`.

## M0 verification (2026-06-10)

Loopback test page (two core instances in one page, JS bridging the serial
port) with the MIT-licensed homebrew
[gba-link-connection](https://github.com/afska/gba-link-connection)
`LinkCable_full.gba` (v8.0.3):

- both instances connect ("connected (2 players)"), correct player ids
  (P0/2 and P1/2 on screen);
- the protocol magic 999 (0x3E7) and incrementing counters are received in
  both directions at ROM level;
- thousands of transfers sustained with no console errors.

Pokémon ROMs are **never** committed to or downloaded into this repository;
provide them at runtime for trade testing.
