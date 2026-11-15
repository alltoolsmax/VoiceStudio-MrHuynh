import { app, ipcMain, type BrowserWindow } from 'electron';
import { assertTrustedMainFrame } from '../ipc';
import {
  activateLicense,
  evaluateLicense,
  fetchNetworkTime,
  systemLicenseDeps,
  type LicenseDeps,
  type LicenseStatus,
} from './index';

/**
 * Bản chạy thử khi phát triển (chưa đóng gói) coi như đã kích hoạt, trừ khi đặt
 * VSMH_LICENSE_DEV=1 để thử màn hình kích hoạt.
 */
function licensingEnforced(): boolean {
  return app.isPackaged || process.env.VSMH_LICENSE_DEV === '1';
}

export interface LicenseController {
  status(): LicenseStatus;
  /** Đợi đồng bộ giờ Internet (tối đa vài giây) rồi trả trạng thái. */
  ready(): Promise<LicenseStatus>;
}

export function registerLicenseIpc(
  getMainWindow: () => BrowserWindow | null,
  onActivated: () => void,
): LicenseController {
  let deps: LicenseDeps = systemLicenseDeps(app.getPath('userData'));
  const devStatus = (): LicenseStatus => ({
    state: 'licensed',
    machineCode: deps.machineCode,
    issuedAt: null,
  });
  const status = () => (licensingEnforced() ? evaluateLicense(deps) : devStatus());
  const ready = (async () => {
    const network = await fetchNetworkTime();
    if (network !== null) {
      deps = systemLicenseDeps(app.getPath('userData'), network - Date.now());
    }
    return status();
  })();

  ipcMain.handle('license:status', async (event) => {
    assertTrustedMainFrame(event, getMainWindow());
    await ready;
    return status();
  });
  ipcMain.handle('license:activate', async (event, key: unknown) => {
    assertTrustedMainFrame(event, getMainWindow());
    await ready;
    if (typeof key !== 'string' || key.length > 400) {
      return { ok: false, reason: 'format', status: status() };
    }
    const result = activateLicense(deps, key);
    if (result.ok) onActivated();
    return result;
  });
  return { status, ready: () => ready };
}
