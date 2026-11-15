/** Mã định danh thô của máy, dùng để tạo mã máy cho key bản quyền. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { hostname, cpus, platform } from 'node:os';

function run(file: string, args: string[]): string {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
  } catch {
    return '';
  }
}

/**
 * Windows: MachineGuid (đổi khi cài lại Windows). macOS: IOPlatformUUID.
 * Linux: /etc/machine-id. Không đọc được thì dùng tên máy + CPU.
 */
export function rawMachineId(): string {
  if (platform() === 'win32') {
    const out = run('reg', [
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
      '/v',
      'MachineGuid',
      '/reg:64',
    ]);
    const match = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/);
    if (match) return `win:${match[1].toLowerCase()}`;
  } else if (platform() === 'darwin') {
    const out = run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
    const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    if (match) return `mac:${match[1].toLowerCase()}`;
  } else {
    for (const path of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      try {
        const id = readFileSync(path, 'utf8').trim();
        if (id) return `linux:${id}`;
      } catch {
        // thử nguồn tiếp theo
      }
    }
  }
  return `fallback:${hostname()}|${cpus()[0]?.model ?? ''}`;
}
