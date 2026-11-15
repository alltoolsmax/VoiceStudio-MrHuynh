import { app, ipcMain, type BrowserWindow } from 'electron';
import { assertTrustedMainFrame } from '../ipc';
import {
  activateLicense,
  bestStoredKey,
  evaluateLicense,
  fetchNetworkTime,
  systemLicenseDeps,
  type LicenseDeps,
  type LicenseStatus,
} from './index';
import { checkOrder, createOrder, fetchPlans, fetchUpdatePolicy } from './store-client';

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
    plan: 'permanent',
    expiresAt: null,
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
  // Mua gói qua QR (máy chủ active.mrhuynh.net); chỉ gọi khi khách mở màn hình mua.
  ipcMain.handle('license:plans', async (event) => {
    assertTrustedMainFrame(event, getMainWindow());
    return fetchPlans();
  });
  ipcMain.handle('license:create-order', async (event, plan: unknown) => {
    assertTrustedMainFrame(event, getMainWindow());
    await ready;
    if (typeof plan !== 'string') return { ok: false, error: 'bad_request' };
    // Gửi key đang có (đã ký) để máy chủ cộng dồn hạn khi gia hạn.
    return createOrder(deps.machineCode, plan, bestStoredKey(deps)?.text ?? null);
  });
  ipcMain.handle('license:check-order', async (event, code: unknown) => {
    assertTrustedMainFrame(event, getMainWindow());
    await ready;
    if (typeof code !== 'string') return { ok: false, error: 'bad_request' };
    const result = await checkOrder(deps.machineCode, code);
    if (!result.ok || result.state.status !== 'paid') return result;
    const activation = activateLicense(deps, result.state.key);
    if (activation.ok) onActivated();
    return { ok: true, state: { status: 'paid' }, activation };
  });
  // Bắt buộc cập nhật: chỉ bản đóng gói mới bị chặn (bản dev luôn bỏ qua).
  ipcMain.handle('license:update-policy', async (event) => {
    assertTrustedMainFrame(event, getMainWindow());
    if (!app.isPackaged && process.env.VSMH_LICENSE_DEV !== '1') {
      return fetchUpdatePolicy('999.0.0');
    }
    return fetchUpdatePolicy(app.getVersion());
  });
  return { status, ready: () => ready };
}
