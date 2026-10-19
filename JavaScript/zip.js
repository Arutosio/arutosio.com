/* ╔══════════════════════════════════════════════════════════╗
 * ║  ZIP — Minimal STORE-only encoder/decoder (shared)        ║
 * ║  Exposed as window.arutaZip = { encode, decode, crc32 }.  ║
 * ║  Host-side only: grimoire iframe keeps its own copy       ║
 * ║  because iframe scope is isolated from window globals.    ║
 * ╚══════════════════════════════════════════════════════════╝ */
(function () {
    // ── CRC32 (precomputed table) ────────────────────
    const _CRC32_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        return t;
    })();
    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = _CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    // Normalize an entry's content to a Uint8Array. Accepts string,
    // Uint8Array, ArrayBuffer, or Blob (handled async via the caller).
    function _toBytes(content) {
        if (content == null) return new Uint8Array(0);
        if (content instanceof Uint8Array) return content;
        if (content instanceof ArrayBuffer) return new Uint8Array(content);
        if (ArrayBuffer.isView(content)) return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
        return new TextEncoder().encode(String(content));
    }

    /** Encode an array of { path, content } into a STORE-method .zip Uint8Array.
     *  `content` may be string, Uint8Array, ArrayBuffer, or any TypedArray. */
    function encode(entries) {
        const te = new TextEncoder();
        const files = entries.map(e => {
            const nameBytes = te.encode(e.path);
            const data = _toBytes(e.content);
            return { nameBytes, data, crc: crc32(data), size: data.length };
        });
        let localSize = 0;
        for (const f of files) localSize += 30 + f.nameBytes.length + f.size;
        let centralSize = 0;
        for (const f of files) centralSize += 46 + f.nameBytes.length;
        const total = localSize + centralSize + 22;

        const out = new Uint8Array(total);
        const dv = new DataView(out.buffer);
        let off = 0;
        const offsets = new Array(files.length);

        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            offsets[i] = off;
            dv.setUint32(off, 0x04034b50, true); off += 4;
            dv.setUint16(off, 20, true);         off += 2;
            dv.setUint16(off, 0x0800, true);     off += 2;
            dv.setUint16(off, 0, true);          off += 2;
            dv.setUint16(off, 0, true);          off += 2;
            dv.setUint16(off, 0x21, true);       off += 2;
            dv.setUint32(off, f.crc, true);      off += 4;
            dv.setUint32(off, f.size, true);     off += 4;
            dv.setUint32(off, f.size, true);     off += 4;
            dv.setUint16(off, f.nameBytes.length, true); off += 2;
            dv.setUint16(off, 0, true);          off += 2;
            out.set(f.nameBytes, off);           off += f.nameBytes.length;
            out.set(f.data, off);                off += f.size;
        }

        const centralStart = off;
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            dv.setUint32(off, 0x02014b50, true); off += 4;
            dv.setUint16(off, 20, true);         off += 2;
            dv.setUint16(off, 20, true);         off += 2;
            dv.setUint16(off, 0x0800, true);     off += 2;
            dv.setUint16(off, 0, true);          off += 2;
            dv.setUint16(off, 0, true);          off += 2;
            dv.setUint16(off, 0x21, true);       off += 2;
            dv.setUint32(off, f.crc, true);      off += 4;
            dv.setUint32(off, f.size, true);     off += 4;
            dv.setUint32(off, f.size, true);     off += 4;
            dv.setUint16(off, f.nameBytes.length, true); off += 2;
            dv.setUint16(off, 0, true);          off += 2;
            dv.setUint16(off, 0, true);          off += 2;
            dv.setUint16(off, 0, true);          off += 2;
            dv.setUint16(off, 0, true);          off += 2;
            dv.setUint32(off, 0, true);          off += 4;
            dv.setUint32(off, offsets[i], true); off += 4;
            out.set(f.nameBytes, off);           off += f.nameBytes.length;
        }

        dv.setUint32(off, 0x06054b50, true); off += 4;
        dv.setUint16(off, 0, true);          off += 2;
        dv.setUint16(off, 0, true);          off += 2;
        dv.setUint16(off, files.length, true); off += 2;
        dv.setUint16(off, files.length, true); off += 2;
        dv.setUint32(off, centralSize, true); off += 4;
        dv.setUint32(off, centralStart, true); off += 4;
        dv.setUint16(off, 0, true);          off += 2;
        return out;
    }

    /** Decode a STORE-method .zip into { entries:[{path,bytes}], skippedCompressed }. */
    function decode(bytes) {
        if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let eocd = -1;
        const maxScan = Math.min(bytes.length, 65557);
        for (let i = bytes.length - 22; i >= bytes.length - maxScan && i >= 0; i--) {
            if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('not a zip file');
        const cdOffset = dv.getUint32(eocd + 16, true);
        const cdCount  = dv.getUint16(eocd + 10, true);
        const td = new TextDecoder('utf-8');
        let off = cdOffset;
        const entries = [];
        let skippedCompressed = 0;
        for (let i = 0; i < cdCount; i++) {
            if (dv.getUint32(off, true) !== 0x02014b50) break;
            const method     = dv.getUint16(off + 10, true);
            const compSize   = dv.getUint32(off + 20, true);
            const nameLen    = dv.getUint16(off + 28, true);
            const extraLen   = dv.getUint16(off + 30, true);
            const commentLen = dv.getUint16(off + 32, true);
            const localOff   = dv.getUint32(off + 42, true);
            const name = td.decode(bytes.subarray(off + 46, off + 46 + nameLen));
            off += 46 + nameLen + extraLen + commentLen;
            if (method !== 0) { skippedCompressed++; continue; }
            if (name.endsWith('/')) continue;
            const lhNameLen  = dv.getUint16(localOff + 26, true);
            const lhExtraLen = dv.getUint16(localOff + 28, true);
            const dataOff = localOff + 30 + lhNameLen + lhExtraLen;
            const data = bytes.subarray(dataOff, dataOff + compSize);
            entries.push({ path: name, bytes: data });
        }
        return { entries, skippedCompressed };
    }

    window.arutaZip = { encode, decode, crc32 };
})();
