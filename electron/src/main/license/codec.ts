/**
 * Định dạng mã máy và key bản quyền của Voice Studio - Mr.Huỳnh.
 *
 * Định dạng này phải khớp từng byte với app cấp key (tools/keygen/vsmh_license.py).
 *
 * Mã máy: "VSMH-XXXX-XXXX-XXXX-XXXX" — 15 ký tự Crockford base32 lấy từ
 * SHA-256 của mã định danh máy, cộng 1 ký tự kiểm tra để phát hiện gõ nhầm.
 *
 * Key: "VSMH2-XXXXX-…" (hoặc VSMH1 cũ, vĩnh viễn) — Crockford base32 của
 *   payload + chữ ký Ed25519 (64 byte) trên payload; xem decodeKey.
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

/** Loại gói trong key. */
export const PLAN_PERMANENT = 1;
export const PLAN_MONTH_1 = 2;
export const PLAN_MONTH_3 = 3;
export const PLAN_YEAR_1 = 4;
export type PlanId = 'permanent' | 'month1' | 'month3' | 'year1';
export const PLAN_BY_TYPE: Record<number, PlanId> = {
  [PLAN_PERMANENT]: 'permanent',
  [PLAN_MONTH_1]: 'month1',
  [PLAN_MONTH_3]: 'month3',
  [PLAN_YEAR_1]: 'year1',
};
export const KEY_V2_PREFIX = 'VSMH2';
const DAY_MS = 86_400_000;
const V1_PAYLOAD_BYTES = 14;
const V2_PAYLOAD_BYTES = 16;

export interface DecodedKey {
  version: number;
  type: number;
  machineTag: Uint8Array;
  issuedAt: Date;
  /** Thời điểm hết hạn (không tính), null với key vĩnh viễn. */
  expiresAt: Date | null;
  serial: number;
  payload: Uint8Array;
  signature: Uint8Array;
}

/**
 * Hai phiên bản key:
 * - VSMH1 (78 byte): [1][loại=1 vĩnh viễn][thẻ máy 8][ngày cấp u16][sê-ri u16] + chữ ký
 * - VSMH2 (80 byte): [2][loại][thẻ máy 8][ngày cấp u16][ngày hết hạn u16, 0 = vĩnh viễn][sê-ri u16] + chữ ký
 */
export function decodeKey(text: string): DecodedKey | null {
  let body = normalizeCode(text);
  if (body.startsWith(KEY_V2_PREFIX)) body = body.slice(KEY_V2_PREFIX.length);
  else if (body.startsWith(KEY_PREFIX)) body = body.slice(KEY_PREFIX.length);
  for (const payloadBytes of [V2_PAYLOAD_BYTES, V1_PAYLOAD_BYTES]) {
    const bytes = base32Decode(body, payloadBytes + SIGNATURE_BYTES);
    if (!bytes) continue;
    const payload = bytes.subarray(0, payloadBytes);
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const version = payload[0];
    if (payloadBytes === V2_PAYLOAD_BYTES ? version !== 2 : version !== 1) return null;
    const expiryDay = payloadBytes === V2_PAYLOAD_BYTES ? view.getUint16(12) : 0;
    return {
      version,
      type: payload[1],
      machineTag: payload.subarray(2, 10),
      issuedAt: new Date(ISSUE_EPOCH_MS + view.getUint16(10) * DAY_MS),
      expiresAt: expiryDay ? new Date(ISSUE_EPOCH_MS + expiryDay * DAY_MS) : null,
      serial: view.getUint16(payloadBytes - 2),
      payload,
      signature: bytes.subarray(payloadBytes),
    };
  }
  return null;
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
  | {
      ok: true;
      plan: PlanId;
      issuedAt: Date;
      /** null với key vĩnh viễn. */
      expiresAt: Date | null;
      serial: number;
    }
  | { ok: false; reason: 'format' | 'signature' | 'machine' | 'version' };

/**
 * Kiểm tra chữ ký và mã máy của key. Không xét hạn dùng: key hết hạn vẫn "ok"
 * ở đây, người gọi so expiresAt với giờ hiện tại.
 */
export function checkKey(text: string, machineCode: string, publicKeyHex: string): KeyCheck {
  const key = decodeKey(text);
  if (!key) return { ok: false, reason: 'format' };
  if (!verifySignature(key.payload, key.signature, publicKeyHex))
    return { ok: false, reason: 'signature' };
  const plan = PLAN_BY_TYPE[key.type];
  const validShape =
    plan !== undefined &&
    (key.version === 2 || key.type === LICENSE_TYPE_PERMANENT) &&
    (plan === 'permanent') === (key.expiresAt === null);
  if (!validShape) return { ok: false, reason: 'version' };
  if (Buffer.compare(Buffer.from(key.machineTag), Buffer.from(machineTag(machineCode))) !== 0)
    return { ok: false, reason: 'machine' };
  return {
    ok: true,
    plan,
    issuedAt: key.issuedAt,
    expiresAt: key.expiresAt,
    serial: key.serial,
  };
}

/** Trình bày key thành các nhóm 5 ký tự cho dễ đọc. */
export function formatKey(body: string): string {
  return `${KEY_PREFIX}-${body.match(/.{1,5}/g)!.join('-')}`;
}
