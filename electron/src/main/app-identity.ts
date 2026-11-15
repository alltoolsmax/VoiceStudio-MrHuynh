import type { AboutPanelOptionsOptions, App, MenuItemConstructorOptions } from 'electron';
import { DISPLAY_NAME, PRODUCT_NAME } from '../../../config/app-config.mjs';

/** ASCII: đặt tên thư mục dữ liệu của Electron. */
export const DESKTOP_APP_NAME = PRODUCT_NAME;
/** Tên hiển thị có dấu cho menu và hộp thoại Giới thiệu. */
export const DESKTOP_DISPLAY_NAME = DISPLAY_NAME;

/** Set before Electron creates the native application menu. */
export function installAppIdentity(application: Pick<App, 'setName'>): void {
  application.setName(DESKTOP_APP_NAME);
}

export function createMacApplicationMenuTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: DESKTOP_DISPLAY_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
}

interface AboutApplication {
  setAboutPanelOptions(options: AboutPanelOptionsOptions): void;
}

interface ApplicationMenuInstaller<TMenu> {
  buildFromTemplate(template: MenuItemConstructorOptions[]): TMenu;
  setApplicationMenu(menu: TMenu): void;
}

export function installMacApplicationMenu<TMenu>(
  application: AboutApplication,
  menu: ApplicationMenuInstaller<TMenu>,
  version: string,
): void {
  application.setAboutPanelOptions({
    applicationName: DESKTOP_DISPLAY_NAME,
    applicationVersion: version,
    version,
  });
  menu.setApplicationMenu(menu.buildFromTemplate(createMacApplicationMenuTemplate()));
}
