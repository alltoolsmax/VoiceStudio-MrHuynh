import { describe, expect, test } from 'vitest';
import { checkKey, decodeKey, machineCodeFromRaw, normalizeCode, parseMachineCode } from './codec';
import {
  activateLicense,
  evaluateLicense,
  evaluateTrial,
  LICENSE_PUBLIC_KEY,
  TRIAL_MS,
  type LicenseDeps,
} from './index';
import { decodeRecord, encodeRecord, type TrialBackend } from './trial-store';

// Vector do app cấp key (tools/keygen/vsmh_license.py) tạo bằng khóa THỬ
// (bí mật = 32 byte 0x01), không phải khóa thật. Giữ hai bên khớp từng byte.
const TEST_PUBLIC_KEY = '8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c';
const RAW_ID = 'win:12345678-1234-1234-1234-123456789abc';
const MACHINE = 'VSMH-K4V4-99VS-J484-XGTN';
const KEY =
  'VSMH1-040TM-Y60RJ-WYHYZ-Z04Z1-14MZ1-CE6QW-YF43C-3V4GW-RPT2J-K4RWJ-ZBD10-FTQB2-BRS0V-EWVRK-6Y6SC-SCTQE-C3F85-V11F0-ZR009-PGVQF-MRXZK-XF7VE-MGVC6-ZKF06-2BQG0';

describe('machine code', () => {
  test('matches the key generator for the same machine', () => {
    expect(machineCodeFromRaw(RAW_ID)).toBe(MACHINE);
  });
  test('accepts sloppy input and rejects typos', () => {
    expect(parseMachineCode(MACHINE.toLowerCase().replace(/-/g, ' '))).toBe('K4V499VSJ484XGTN');
    expect(parseMachineCode('VSMH-K4V4-99VS-J484-XGTM')).toBeNull();
    expect(parseMachineCode('VSMH-K4V4')).toBeNull();
  });
});

describe('license key', () => {
  test('a generator key verifies for its machine', () => {
    const result = checkKey(KEY, MACHINE, TEST_PUBLIC_KEY);
    expect(result).toMatchObject({ ok: true, serial: 4242 });
    if (result.ok) expect(result.issuedAt.toISOString()).toBe('2026-11-15T00:00:00.000Z');
  });
  test('tolerates spaces, line breaks and lowercase from chat apps', () => {
    const messy = ` ${KEY.toLowerCase().replace(/-/g, '\n')} `;
    expect(checkKey(messy, MACHINE, TEST_PUBLIC_KEY).ok).toBe(true);
  });
  test('refuses another machine, a forged key and garbage', () => {
    const other = machineCodeFromRaw('win:another-machine');
    expect(checkKey(KEY, other, TEST_PUBLIC_KEY)).toEqual({ ok: false, reason: 'machine' });
    expect(checkKey(KEY, MACHINE, LICENSE_PUBLIC_KEY)).toEqual({ ok: false, reason: 'signature' });
    const body = normalizeCode(KEY);
    const flipped = body.slice(0, 20) + (body[20] === 'A' ? 'B' : 'A') + body.slice(21);
    expect(checkKey(flipped, MACHINE, TEST_PUBLIC_KEY).ok).toBe(false);
    expect(checkKey('hello', MACHINE, TEST_PUBLIC_KEY)).toEqual({ ok: false, reason: 'format' });
    expect(decodeKey('')).toBeNull();
  });
});

function memoryTrial(initial: string[] = []): TrialBackend & { stored: string[] } {
  const backend = {
    stored: [...initial],
    read: () => backend.stored,
    write: (encoded: string) => {
      backend.stored = [encoded, encoded, encoded];
    },
  };
  return backend;
}

describe('24-hour trial', () => {
  const t0 = Date.UTC(2026, 10, 15, 8);
  test('starts on first run and ends after 24 hours', () => {
    const trial = memoryTrial();
    expect(evaluateTrial(MACHINE, trial, t0)).toEqual({
      state: 'trial',
      machineCode: MACHINE,
      endsAt: new Date(t0 + TRIAL_MS).toISOString(),
    });
    expect(evaluateTrial(MACHINE, trial, t0 + TRIAL_MS - 1).state).toBe('trial');
    expect(evaluateTrial(MACHINE, trial, t0 + TRIAL_MS)).toMatchObject({
      state: 'expired',
      reason: 'trial_ended',
    });
  });
  test('reinstalling keeps the original start (earliest record wins)', () => {
    const old = encodeRecord({ m: MACHINE, s: t0 - TRIAL_MS * 3, l: t0 - TRIAL_MS * 2 });
    const trial = memoryTrial([old]);
    expect(evaluateTrial(MACHINE, trial, t0)).toMatchObject({ state: 'expired' });
    expect(decodeRecord(trial.stored[0], MACHINE)?.record.s).toBe(t0 - TRIAL_MS * 3);
  });
  test('an edited or copied record counts as tampering', () => {
    const genuine = encodeRecord({ m: MACHINE, s: t0, l: t0 });
    const raw = JSON.parse(Buffer.from(genuine, 'base64url').toString());
    const edited = Buffer.from(JSON.stringify({ ...raw, s: t0 + TRIAL_MS * 10 })).toString(
      'base64url',
    );
    expect(evaluateTrial(MACHINE, memoryTrial([edited]), t0)).toMatchObject({
      reason: 'tampered',
    });
    const otherMachine = machineCodeFromRaw('win:another-machine');
    expect(evaluateTrial(otherMachine, memoryTrial([genuine]), t0)).toMatchObject({
      reason: 'tampered',
    });
  });
  test('setting the clock back ends the trial', () => {
    const trial = memoryTrial();
    evaluateTrial(MACHINE, trial, t0 + 60 * 60 * 1000);
    expect(evaluateTrial(MACHINE, trial, t0 - 60 * 60 * 1000)).toMatchObject({ reason: 'clock' });
  });
});

describe('activation', () => {
  test('a valid key is saved and survives the trial ending', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'vsmh-license-'));
    let now = Date.UTC(2026, 10, 15);
    const deps: LicenseDeps = {
      machineCode: MACHINE,
      trial: memoryTrial(),
      keyFiles: [join(dir, 'a', 'license.key'), join(dir, 'b', 'license.key')],
      now: () => now,
      publicKey: TEST_PUBLIC_KEY,
    };
    expect(evaluateLicense(deps).state).toBe('trial');
    expect(activateLicense(deps, 'not a key')).toMatchObject({ ok: false, reason: 'format' });
    const result = activateLicense(deps, KEY);
    expect(result).toMatchObject({ ok: true, status: { state: 'licensed' } });
    now += TRIAL_MS * 30;
    expect(evaluateLicense(deps).state).toBe('licensed');
    const { rmSync } = await import('node:fs');
    rmSync(join(dir, 'a'), { recursive: true });
    expect(evaluateLicense(deps).state).toBe('licensed');
  });
});
