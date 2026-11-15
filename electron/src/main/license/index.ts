/**
 * Bản quyền Voice Studio - Mr.Huỳnh: tự động dùng thử 24 giờ, sau đó cần key
 * gắn với mã máy — 1 tháng, 3 tháng, 1 năm hoặc vĩnh viễn — do máy chủ
 * active.mrhuynh.net (mua qua QR) hoặc app cấp key của Mr.Huỳnh tạo.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { checkKey, machineCodeFromRaw, normalizeCode, type KeyCheck, type PlanId } from './codec';
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
  | {
      state: 'licensed';
      machineCode: string;
      plan: PlanId;
      /** null với gói vĩnh viễn. */
      expiresAt: string | null;
    }
  | { state: 'trial'; machineCode: string; endsAt: string }
  | {
      state: 'expired';
      machineCode: string;
      reason: 'trial_ended' | 'tampered' | 'clock' | 'license_ended';
      /** Gói vừa hết hạn, khi reason là license_ended. */
      plan?: PlanId;
      expiredAt?: string;
    };

export type ActivateResult =
  | { ok: true; status: LicenseStatus }
  | {
      ok: false;
      reason: 'format' | 'signature' | 'machine' | 'version' | 'expired';
      status: LicenseStatus;
    };

export interface LicenseDeps {
  machineCode: string;
  trial: TrialBackend;
  keyFiles: string[];
  now: () => number;
  publicKey?: string;
}

type ValidKey = Extract<KeyCheck, { ok: true }> & { text: string };

/** Key "tốt" hơn: vĩnh viễn hơn có hạn; cùng có hạn thì hạn xa hơn. */
function better(a: ValidKey | null, b: ValidKey | null): ValidKey | null {
  if (!a) return b;
  if (!b) return a;
  if (!a.expiresAt) return a;
  if (!b.expiresAt) return b;
  return b.expiresAt.getTime() > a.expiresAt.getTime() ? b : a;
}

/** Key tốt nhất đã lưu trên máy (đúng chữ ký và đúng máy), kể cả đã hết hạn. */
export function bestStoredKey(deps: LicenseDeps): ValidKey | null {
  const publicKey = deps.publicKey ?? LICENSE_PUBLIC_KEY;
  let best: ValidKey | null = null;
  for (const file of deps.keyFiles) {
    try {
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const result = checkKey(line, deps.machineCode, publicKey);
        if (result.ok) best = better(best, { ...result, text: normalizeCode(line) });
      }
    } catch {
      // chưa có key ở đây
    }
  }
  return best;
}

interface ClockState {
  start: number;
  lastSeen: number;
  tampered: boolean;
}

/**
 * Đọc và cập nhật bản ghi thời gian (lúc bắt đầu dùng thử, lần cuối chạy) ở
 * mọi nơi lưu. Lần cuối chạy dùng để phát hiện lùi giờ máy, cho cả bản dùng
 * thử lẫn gói có thời hạn.
 */
function touchClock(machineCode: string, trial: TrialBackend, now: number): ClockState {
  const decoded = trial
    .read()
    .map((text) => decodeRecord(text, machineCode))
    .filter((item) => item !== null);
  const tampered = decoded.some((item) => !item.valid);
  const records = decoded.filter((item) => item.valid).map((item) => item.record);
  const start = records.length ? Math.min(...records.map((r) => r.s)) : now;
  const lastSeen = records.length ? Math.max(...records.map((r) => r.l)) : now;
  if (!tampered) {
    const next: TrialRecord = { m: machineCode, s: start, l: Math.max(lastSeen, now) };
    trial.write(encodeRecord(next));
  }
  return { start, lastSeen, tampered };
}

/** Tính trạng thái dùng thử và ghi lại bản ghi ở mọi nơi lưu. */
export function evaluateTrial(
  machineCode: string,
  trial: TrialBackend,
  now: number,
): LicenseStatus {
  const clock = touchClock(machineCode, trial, now);
  if (clock.tampered) return { state: 'expired', machineCode, reason: 'tampered' };
  if (now < clock.lastSeen - CLOCK_TOLERANCE_MS) {
    return { state: 'expired', machineCode, reason: 'clock' };
  }
  const endsAt = clock.start + TRIAL_MS;
  if (now >= endsAt) return { state: 'expired', machineCode, reason: 'trial_ended' };
  return { state: 'trial', machineCode, endsAt: new Date(endsAt).toISOString() };
}

export function evaluateLicense(deps: LicenseDeps): LicenseStatus {
  const key = bestStoredKey(deps);
  const machineCode = deps.machineCode;
  if (key && !key.expiresAt) {
    return { state: 'licensed', machineCode, plan: key.plan, expiresAt: null };
  }
  if (key?.expiresAt) {
    const now = deps.now();
    const clock = touchClock(machineCode, deps.trial, now);
    if (!clock.tampered && now < clock.lastSeen - CLOCK_TOLERANCE_MS) {
      return { state: 'expired', machineCode, reason: 'clock' };
    }
    if (now < key.expiresAt.getTime()) {
      return {
        state: 'licensed',
        machineCode,
        plan: key.plan,
        expiresAt: key.expiresAt.toISOString(),
      };
    }
    return {
      state: 'expired',
      machineCode,
      reason: 'license_ended',
      plan: key.plan,
      expiredAt: key.expiresAt.toISOString(),
    };
  }
  return evaluateTrial(machineCode, deps.trial, deps.now());
}

/**
 * Kích hoạt một key. Máy giữ key tốt nhất: key gia hạn (hạn xa hơn) thay key
 * cũ; key cũ hơn key đang có vẫn được nhận nhưng không làm giảm hạn dùng.
 */
export function activateLicense(deps: LicenseDeps, keyText: string): ActivateResult {
  const publicKey = deps.publicKey ?? LICENSE_PUBLIC_KEY;
  const result = checkKey(keyText, deps.machineCode, publicKey);
  if (!result.ok) return { ok: false, reason: result.reason, status: evaluateLicense(deps) };
  if (result.expiresAt && result.expiresAt.getTime() <= deps.now()) {
    return { ok: false, reason: 'expired', status: evaluateLicense(deps) };
  }
  const incoming: ValidKey = { ...result, text: normalizeCode(keyText) };
  const best = better(bestStoredKey(deps), incoming)!;
  for (const file of deps.keyFiles) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${best.text}\n`);
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
