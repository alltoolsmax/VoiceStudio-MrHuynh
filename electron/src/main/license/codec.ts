/**
 * Định dạng mã máy và key bản quyền của Voice Studio - Mr.Huỳnh.
 *
 * Định dạng này phải khớp từng byte với app cấp key (tools/keygen/vsmh_license.py).
 *
 * Mã máy: "VSMH-XXXX-XXXX-XXXX-XXXX" — 15 ký tự Crockford base32 lấy từ
 * SHA-256 của mã định danh máy, cộng 1 ký tự kiểm tra để phát hiện gõ nhầm.
 *
 * Key: "VSMH1-XXXXX-XXXXX-…" — Crockford base32 của
 *   payload (14 byte) + chữ ký Ed25519 (64 byte) trên payload.
 *   payload = [phiên bản=1][loại][thẻ máy 8 byte][ngày cấp uint16 BE][số sê-ri uint16 BE]
 * Chỉ khóa công khai nằm trong app, nên app kiểm tra được key nhưng không tạo được key.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const MACHINE_PREFIX = 'VSMH';
export const KEY_PREFIX = 'VSMH1';
export const KEY_VERSION = 1;
export const LICENSE_TYPE_PERMANENT = 1;
/** Ngày 0 của trường "ngày cấp" trong key (UTC). */
export const ISSUE_EPOCH_MS = Date.UTC(2026, 0, 1);
const PAYLOAD_BYTES = 14;
const SIGNATURE_BYTES = 64;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

/** Giải mã Crockford base32; trả về null khi có ký tự lạ. */
export function base32Decode(text: string, byteLength: number): Uint8Array | null {
  const out = new Uint8Array(byteLength);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of text) {
    const digit = CROCKFORD.indexOf(char);
    if (digit < 0) return null;
    value = ((value << 5) | digit) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      if (index >= byteLength) return null;
      out[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return index === byteLength ? out : null;
}

/** Chuẩn hóa chuỗi người dùng gõ/dán: bỏ khoảng trắng, gạch, sửa O→0, I/L→1. */
export function normalizeCode(text: string): string {
  return text
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

function checksumChar(data: string): string {
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) sum += (i + 1) * CROCKFORD.indexOf(data[i]);
  return CROCKFORD[sum % 32];
}

/** Mã máy hiển thị cho người dùng, từ mã định danh thô của máy. */
export function machineCodeFromRaw(rawId: string): string {
  const digest = createHash('sha256').update(`VSMH-MACHINE-v1|${rawId}`).digest();
  const data = base32Encode(digest.subarray(0, 10)).slice(0, 15);
  const body = data + checksumChar(data);
  return `${MACHINE_PREFIX}-${body.match(/.{4}/g)!.join('-')}`;
}

/** 16 ký tự lõi của mã máy, hoặc null khi sai định dạng hay sai ký tự kiểm tra. */
export function parseMachineCode(text: string): string | null {
  let body = normalizeCode(text);
  if (body.startsWith(MACHINE_PREFIX)) body = body.slice(MACHINE_PREFIX.length);
  if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(body)) return null;
  return checksumChar(body.slice(0, 15)) === body[15] ? body : null;
}

/** Thẻ máy 8 byte nhúng trong key. */
export function machineTag(machineCode: string): Uint8Array {
  const body = parseMachineCode(machineCode);
  if (!body) throw new Error('invalid machine code');
  return createHash('sha256').update(`VSMH-KEY-v1|${body}`).digest().subarray(0, 8);
}

export interface DecodedKey {
  version: number;
  type: number;
  machineTag: Uint8Array;
  issuedAt: Date;
  serial: number;
  payload: Uint8Array;
  signature: Uint8Array;
}

export function decodeKey(text: string): DecodedKey | null {
  let body = normalizeCode(text);
  if (body.startsWith(KEY_PREFIX)) body = body.slice(KEY_PREFIX.length);
  const bytes = base32Decode(body, PAYLOAD_BYTES + SIGNATURE_BYTES);
  if (!bytes) return null;
  const payload = bytes.subarray(0, PAYLOAD_BYTES);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    version: payload[0],
    type: payload[1],
    machineTag: payload.subarray(2, 10),
    issuedAt: new Date(ISSUE_EPOCH_MS + view.getUint16(10) * 86_400_000),
    serial: view.getUint16(12),
    payload,
    signature: bytes.subarray(PAYLOAD_BYTES),
  };
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function verifySignature(
  payload: Uint8Array,
  signature: Uint8Array,
  publicKeyHex: string,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, payload, key, signature);
  } catch {
    return false;
  }
}

export type KeyCheck =
  | { ok: true; type: number; issuedAt: Date; serial: number }
  | { ok: false; reason: 'format' | 'signature' | 'machine' | 'version' };

/** Kiểm tra key có hợp lệ và đúng máy này không. */
export function checkKey(text: string, machineCode: string, publicKeyHex: string): KeyCheck {
  const key = decodeKey(text);
  if (!key) return { ok: false, reason: 'format' };
  if (!verifySignature(key.payload, key.signature, publicKeyHex))
    return { ok: false, reason: 'signature' };
  if (key.version !== KEY_VERSION || key.type !== LICENSE_TYPE_PERMANENT)
    return { ok: false, reason: 'version' };
  if (Buffer.compare(Buffer.from(key.machineTag), Buffer.from(machineTag(machineCode))) !== 0)
    return { ok: false, reason: 'machine' };
  return {
    ok: true,
    type: key.type,
    issuedAt: key.issuedAt,
    serial: key.serial,
  };
}

/** Trình bày key thành các nhóm 5 ký tự cho dễ đọc. */
export function formatKey(body: string): string {
  return `${KEY_PREFIX}-${body.match(/.{1,5}/g)!.join('-')}`;
}
