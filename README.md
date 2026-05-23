<p align="center">
  <img src="public/logo.png" alt="Alcaline Codec" width="128" height="128">
</p>

<h1 align="center">Alcaline Codec <code>.alc</code></h1>

<p align="center">
  <strong>Lossless. Tiled. Auditable.</strong><br>
  A modular raster image format built for integrity, privacy, and simplicity.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0-teal" alt="Version">
  <img src="https://img.shields.io/badge/type-lossless-green" alt="Lossless">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <img src="https://img.shields.io/badge/endianness-big__endian-orange" alt="Big Endian">
  <img src="https://img.shields.io/badge/max__dimensions-65535%C3%9765535-purple" alt="Max Dimensions">
</p>

---

## Overview

**Alcaline Codec (.alc)** is a tile-based lossless image format designed around a single principle: **what you encode is exactly what you decode**. Every tile is independently compressed, checksummed, and verifiable — if one tile corrupts, the rest decode flawlessly.

No hidden metadata. No scripts. No tracking. Just pixels.

```
[HEADER 32B] → [TILE TABLE] → [IMAGE DATA] → [GLOBAL CRC32 4B] → [END MARKER "ALCE" 4B]
```

## Features

| Feature | Description |
|---------|-------------|
| **Tile-based** | Independent tiles enable partial corruption recovery |
| **Per-tile CRC32** | Each tile verified individually on decode |
| **Global CRC32** | Full-file integrity check covers everything |
| **BigInt I/O** | Mathematically correct uint64 offsets (no precision loss) |
| **8/16-bit depth** | 8-bit (1 byte/sample) and 16-bit (2 bytes/sample) support |
| **Colorspace** | sRGB, linear light, custom ICC (reserved) |
| **Byte order** | Configurable 16-bit endianness (BE/LE) |
| **Compression** | None, zlib (default), or raw deflate — per-tile |
| **Zero metadata** | No automatic EXIF, GPS, timestamps, or user data |
| **Deterministic** | Same input + same options = identical output, always |

## Binary Format

All multi-byte integers are **big-endian**.

### Header (32 bytes)

```
struct AlcHeader {
    char     magic[4];       // "ALC\x01" (3 magic + 1 version)
    uint32_t width;          // 1–65535
    uint32_t height;         // 1–65535
    uint16_t channels;       // 3=RGB, 4=RGBA
    uint16_t bitdepth;       // 8 or 16
    uint32_t tile_size;      // 8–8192
    uint32_t compression;    // 0=none, 1=zlib, 2=deflate-raw
    uint8_t  colorspace;     // 0=sRGB, 1=linear, 2=custom ICC
    uint8_t  byte_order;     // 0=big-endian, 1=little-endian
    uint16_t flags;          // reserved, must be 0
    uint32_t _reserved;      // reserved, must be 0
};
```

### Tile Table (4 + N×16 bytes)

```
uint32_t tile_count;
AlcTileEntry[tile_count]:
    uint64_t offset;           // byte offset to compressed data
    uint32_t compressed_size;   // size in bytes
    uint32_t checksum;          // CRC32 of uncompressed tile
```

### Trailer (8 bytes)

```
uint32_t global_crc32;    // CRC32 of [HEADER][TILE TABLE][IMAGE DATA]
char     end[4];          // "ALCE"
```

## Quick Start

### Install

```bash
git clone https://github.com/yourusername/alcaline-codec.git
cd alcaline-codec
bun install
bun run dev
```

### Encode

```typescript
import { encodeImage, COMP_ZLIB } from '@/lib/alc';

const canvas = document.querySelector('canvas')!;

const result = await encodeImage(canvas, {
  tileSize: 256,
  compression: COMP_ZLIB,
  channels: 4,
  bitdepth: 8,
  colorspace: 0,
  byteOrder: 0,
  onProgress: (pct) => console.log(`${pct}%`),
});

// Download
const url = URL.createObjectURL(result.blob);
const a = document.createElement('a');
a.href = url;
a.download = 'image.alc';
a.click();
```

### Decode

```typescript
import { decodeAlc } from '@/lib/alc';

const buffer = await file.arrayBuffer();
const result = await decodeAlc(buffer);

console.log('Dimensions:', result.info.width, 'x', result.info.height);
console.log('Integrity:', result.info.integrityValid ? 'VALID' : 'CORRUPTED');
console.log('Corrupted tiles:', result.corruptedTiles);

// result.imageData is a standard ImageData
const canvas = document.createElement('canvas');
canvas.width = result.info.width;
canvas.height = result.info.height;
canvas.getContext('2d')!.putImageData(result.imageData, 0, 0);
```

## Partial Corruption Recovery

Each tile is independently verifiable. If a tile's CRC32 doesn't match, it's skipped — the rest of the image renders intact:

```typescript
import { encodeImage, decodeAlc, corruptTile, COMP_ZLIB } from '@/lib/alc';

const result = await encodeImage(canvas, {
  tileSize: 256, compression: COMP_ZLIB,
  channels: 4, bitdepth: 8,
});
const buffer = await result.blob.arrayBuffer();

const corrupted = corruptTile(buffer, 5, result.info);
const decoded = await decodeAlc(corrupted);

// Global CRC detects corruption
console.log(decoded.info.integrityValid);  // false

// But only tile 5 is affected
console.log(decoded.corruptedTiles);       // [5]

// The decoded image still renders — only tile 5 is transparent
```

## Web Tool

The project includes an interactive browser-based tool with 6 tabs:

| Tab | Description |
|-----|-------------|
| **Encoder** | Drag an image, configure options, download `.alc` |
| **Viewer** | Decode `.alc` files, inspect metadata, export as PNG |
| **Benchmark** | 24 configurations tested against PNG baseline |
| **Integrity** | Simulate tile corruption, see partial recovery in action |
| **Specification** | Full format spec with header layout, decoder rules, invariants |
| **Format** | Design principles and binary structure reference |

## Design Principles

1. **Lossless only** — encode produces a bit-perfect decode (within ±1 LSB for 16-bit scaling)
2. **Tiles are independent** — corruption is isolated, recovery is graceful
3. **Metadata opt-in** — no automatic EXIF, GPS, timestamps, or user data
4. **Zero execution** — no scripts, no macros, no code
5. **Semantically neutral** — the decoder only reconstructs stored pixel data
6. **Never trust the file** — validate all sizes, offsets, limits, and checksums
7. **Deterministic** — same input + same options always produces identical output

## API Reference

### Functions

| Function | Description |
|----------|-------------|
| `encodeImage(canvas, opts)` | Encodes a canvas to `.alc`. Returns `AlcEncodeResult` |
| `decodeAlc(buffer)` | Decodes an `ArrayBuffer` to `ImageData`. Returns `AlcDecodeResult` |
| `corruptTile(buffer, index, info)` | Simulates corruption on tile `index` for testing |
| `hexDump(data, maxBytes?)` | Produces a hex dump of a `Uint8Array` |
| `formatBytes(bytes)` | Formats byte count as human-readable string |
| `crc32(data)` | CRC32 (ISO 3309) of a `Uint8Array` |
| `compressionName(c)` | Human-readable compression mode name |
| `colorspaceName(cs)` | Human-readable colorspace name |

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `COMP_NONE` | `0` | No compression |
| `COMP_ZLIB` | `1` | Zlib wrapper (default) |
| `COMP_DEFLATE_RAW` | `2` | Raw deflate, no wrapper |
| `COLOR_SRGB` | `0` | sRGB colorspace |
| `COLOR_LINEAR` | `1` | Linear light |
| `COLOR_CUSTOM` | `2` | Custom ICC (reserved) |
| `BYTEORDER_BE` | `0` | Big-endian |
| `BYTEORDER_LE` | `1` | Little-endian |
| `HEADER_SIZE` | `32` | Fixed header size |
| `TT_ENTRY_SIZE` | `16` | Per-entry tile table size |
| `TRAILER_SIZE` | `8` | Trailer size |

## Decoder Invariants

A compliant decoder **MUST** enforce:

1. Magic bytes match `ALC` (0x41 0x4C 0x43) and version equals the supported version
2. All header fields within declared ranges
3. `tile_count == ceil(width/tile_size) * ceil(height/tile_size)`
4. `flags == 0` and `_reserved == 0`
5. All tile offsets point within the file data section
6. `offset + compressed_size` does not exceed file boundary for each tile
7. Per-tile CRC32 verified before accepting tile data
8. Global CRC32 verified over `[HEADER][TILE TABLE][IMAGE DATA]`
9. Corrupted tiles skipped gracefully, indices reported
10. End marker `ALCE` (0x41 0x4C 0x43 0x45) present at last 4 bytes

## Tech Stack

- **Runtime**: Bun / Node.js
- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5
- **UI**: React 19, Tailwind CSS 4, shadcn/ui
- **Codec**: Pure TypeScript — no external image libraries, uses Web `CompressionStream` API
- **Integrity**: CRC32 (ISO 3309 / ITU-T V.42)
- **BigInt I/O**: Full uint64 support for file offsets

## File Structure

```
src/
├── lib/
│   └── alc.ts                  # Core codec (608 lines, zero dependencies)
├── components/
│   └── alc-tool/
│       ├── AlcTool.tsx          # Main 6-tab interactive tool
│       ├── BenchmarkTab.tsx     # Benchmark runner (24 configs vs PNG)
│       └── SpecificationTab.tsx # Full format specification viewer
└── app/
    ├── page.tsx                 # Entry point
    └── globals.css              # Theme + custom utilities
```

## License

MIT
