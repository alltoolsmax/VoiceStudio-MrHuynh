/**
 * Bản quyền Voice Studio - Mr.Huỳnh: tự động dùng thử 24 giờ, sau đó cần key
 * vĩnh viễn gắn với mã máy (do app cấp key của Mr.Huỳnh tạo).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { checkKey, machineCodeFromRaw, normalizeCode } from './codec';
import { rawMachineId } from './machine';
import {
  decodeRecord,
  encodeRecord,
  systemTrialBackend,
  type TrialBackend,
  type TrialRecord,
} from './trial-store';

/** Khóa công khai Ed25519 (hex). Khóa bí mật chỉ nằm trong app cấp key. */
export const LICENSE_PUBLIC_KEY =
  'c6b424e5d1f327c5c8b3befd5dd0522e660e7bda559607cd18eb715354439cad';
export const TRIAL_MS = 24 * 60 * 60 * 1000;
/** Cho phép lệch giờ nhỏ (đồng bộ giờ Windows) trước khi coi là lùi giờ. */
const CLOCK_TOLERANCE_MS = 10 * 60 * 1000;

export type LicenseStatus =
  | { state: 'licensed'; machineCode: string; issuedAt: string | null }
  | { state: 'trial'; machineCode: string; endsAt: string }
  | {
      state: 'expired';
      machineCode: string;
      reason: 'trial_ended' | 'tampered' | 'clock';
    };

export type ActivateResult =
  | { ok: true; status: LicenseStatus }
  | {
      ok: false;
      reason: 'format' | 'signature' | 'machine' | 'version';
      status: LicenseStatus;
    };

export interface LicenseDeps {
  machineCode: string;
  trial: TrialBackend;
  keyFiles: string[];
  now: () => number;
  publicKey?: string;
}

function readKey(files: string[], machineCode: string, publicKey: string) {
  for (const file of files) {
    try {
      const text = readFileSync(file, 'utf8');
      const result = checkKey(text, machineCode, publicKey);
      if (result.ok) return result;
    } catch {
      // chưa có key ở đây
    }
  }
  return null;
}

/** Tính trạng thái dùng thử và ghi lại bản ghi ở mọi nơi lưu. */
export function evaluateTrial(
  machineCode: string,
  trial: TrialBackend,
  now: number,
): LicenseStatus {
  const decoded = trial
    .read()
    .map((text) => decodeRecord(text, machineCode))
    .filter((item) => item !== null);
  if (decoded.some((item) => !item.valid)) {
    return { state: 'expired', machineCode, reason: 'tampered' };
  }
  const records = decoded.map((item) => item.record);
  const start = records.length ? Math.min(...records.map((r) => r.s)) : now;
  const lastSeen = records.length ? Math.max(...records.map((r) => r.l)) : now;
  const next: TrialRecord = {
    m: machineCode,
    s: start,
    l: Math.max(lastSeen, now),
  };
  trial.write(encodeRecord(next));
  if (now < lastSeen - CLOCK_TOLERANCE_MS) {
    return { state: 'expired', machineCode, reason: 'clock' };
  }
  const endsAt = start + TRIAL_MS;
  if (now >= endsAt) return { state: 'expired', machineCode, reason: 'trial_ended' };
  return {
    state: 'trial',
    machineCode,
    endsAt: new Date(endsAt).toISOString(),
  };
}

export function evaluateLicense(deps: LicenseDeps): LicenseStatus {
  const publicKey = deps.publicKey ?? LICENSE_PUBLIC_KEY;
  const key = readKey(deps.keyFiles, deps.machineCode, publicKey);
  if (key) {
    return {
      state: 'licensed',
      machineCode: deps.machineCode,
      issuedAt: key.issuedAt.toISOString(),
    };
  }
  return evaluateTrial(deps.machineCode, deps.trial, deps.now());
}

export function activateLicense(deps: LicenseDeps, keyText: string): ActivateResult {
  const publicKey = deps.publicKey ?? LICENSE_PUBLIC_KEY;
  const result = checkKey(keyText, deps.machineCode, publicKey);
  if (!result.ok) return { ok: false, reason: result.reason, status: evaluateLicense(deps) };
  const normalized = normalizeCode(keyText);
  for (const file of deps.keyFiles) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${normalized}\n`);
    } catch {
      // một nơi lỗi thì vẫn còn nơi khác
    }
  }
  return { ok: true, status: evaluateLicense(deps) };
}

/** Nơi lưu key: thư mục dữ liệu của app và một bản ngoài thư mục cài đặt. */
export function systemKeyFiles(userDataDir: string): string[] {
  const shared =
    platform() === 'win32'
      ? join(process.env.ProgramData || 'C:\\ProgramData', 'VSMH', 'license.key')
      : join(homedir(), '.config', '.vsmh', 'license.key');
  return [join(userDataDir, 'license.key'), shared];
}

/**
 * Giờ từ Internet (tiêu đề Date của một trang lớn), để lùi giờ máy không kéo
 * dài được bản dùng thử. Không có mạng thì dùng giờ máy.
 */
export async function fetchNetworkTime(timeoutMs = 3000): Promise<number | null> {
  const probe = async (url: string) => {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const date = Date.parse(response.headers.get('date') ?? '');
    if (!Number.isFinite(date)) throw new Error('no date');
    return date;
  };
  try {
    return await Promise.any(
      ['https://www.google.com/generate_204', 'https://www.cloudflare.com/'].map(probe),
    );
  } catch {
    return null;
  }
}

export function systemLicenseDeps(userDataDir: string, clockOffsetMs = 0): LicenseDeps {
  return {
    machineCode: machineCodeFromRaw(rawMachineId()),
    trial: systemTrialBackend(),
    keyFiles: systemKeyFiles(userDataDir),
    now: () => Date.now() + clockOffsetMs,
  };
}
