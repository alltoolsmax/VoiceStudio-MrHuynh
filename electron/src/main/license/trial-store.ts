/**
 * Lưu thời điểm bắt đầu dùng thử ở nhiều nơi để gỡ app rồi cài lại không
 * được dùng thử lại (chống reset mức 1, không cần máy chủ).
 *
 * Mỗi bản ghi có HMAC gắn với mã máy: sửa tay hay chép từ máy khác sang đều bị
 * coi là không hợp lệ. Khóa HMAC nằm trong mã nguồn công khai nên đây chỉ là
 * chống sửa thông thường, không phải bảo mật mật mã.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';

const HMAC_SALT = 'VSMH-TRIAL-v1|9c4e1f7a-mrhuynh';
const REG_KEY = 'HKCU\\Software\\VSMH\\Runtime';
const REG_VALUE = 'rt';

export interface TrialRecord {
  /** Mã máy của bản ghi. */
  m: string;
  /** Lúc bắt đầu dùng thử (ms). */
  s: number;
  /** Lần cuối thấy app chạy (ms), để phát hiện lùi giờ máy. */
  l: number;
}

export type StoredRecord = { record: TrialRecord; valid: boolean };

export interface TrialBackend {
  read(): string[];
  write(encoded: string): void;
}

function sign(record: TrialRecord): string {
  return createHmac('sha256', `${HMAC_SALT}|${record.m}`)
    .update(`${record.m}|${record.s}|${record.l}`)
    .digest('base64url');
}

export function encodeRecord(record: TrialRecord): string {
  return Buffer.from(JSON.stringify({ ...record, h: sign(record) })).toString('base64url');
}

/** Giải mã một bản ghi; `valid` sai khi chữ ký không khớp hoặc khác máy. */
export function decodeRecord(encoded: string, machineCode: string): StoredRecord | null {
  try {
    const raw = JSON.parse(Buffer.from(encoded.trim(), 'base64url').toString('utf8'));
    if (typeof raw?.m !== 'string' || typeof raw?.s !== 'number' || typeof raw?.l !== 'number')
      return null;
    const record: TrialRecord = { m: raw.m, s: raw.s, l: raw.l };
    const expected = Buffer.from(sign(record));
    const actual = Buffer.from(String(raw.h ?? ''));
    const signed = expected.length === actual.length && timingSafeEqual(expected, actual);
    return { record, valid: signed && record.m === machineCode };
  } catch {
    return null;
  }
}

function fileLocations(): string[] {
  if (platform() === 'win32') {
    const programData = process.env.ProgramData || 'C:\\ProgramData';
    const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    return [join(programData, 'VSMH', 'rt.dat'), join(local, 'VSMH', 'cache', 'rt.bin')];
  }
  return [
    join(homedir(), '.config', '.vsmh', 'rt.dat'),
    join(homedir(), '.local', 'share', '.vsmh', 'rt.bin'),
  ];
}

/** Nơi lưu thật: Registry (Windows) và hai tệp ngoài thư mục cài đặt. */
export function systemTrialBackend(): TrialBackend {
  const files = fileLocations();
  return {
    read() {
      const found: string[] = [];
      for (const file of files) {
        try {
          found.push(readFileSync(file, 'utf8'));
        } catch {
          // chưa có
        }
      }
      if (platform() === 'win32') {
        try {
          const out = execFileSync('reg', ['query', REG_KEY, '/v', REG_VALUE], {
            encoding: 'utf8',
            timeout: 5000,
            windowsHide: true,
          });
          const match = out.match(new RegExp(`${REG_VALUE}\\s+REG_SZ\\s+(\\S+)`));
          if (match) found.push(match[1]);
        } catch {
          // chưa có
        }
      }
      return found;
    },
    write(encoded) {
      for (const file of files) {
        try {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, encoded);
        } catch {
          // một nơi lỗi thì vẫn còn các nơi khác
        }
      }
      if (platform() === 'win32') {
        try {
          execFileSync(
            'reg',
            ['add', REG_KEY, '/v', REG_VALUE, '/t', 'REG_SZ', '/d', encoded, '/f'],
            { timeout: 5000, windowsHide: true, stdio: 'ignore' },
          );
        } catch {
          // bỏ qua
        }
      }
    },
  };
}
