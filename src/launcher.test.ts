// The Windows launchers (.bat). cmd.exe reads a batch file a piece at a time
// straight from disk: with LF-only line endings (and the UTF-8 code page these
// use) it misreads the lines and the launcher does not run at all — which is
// what happened once, and a broken launcher cannot update itself to a fixed
// one. These checks keep that from shipping again.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const bats = readdirSync('.').filter((f) => /\.(bat|cmd)$/i.test(f));
const read = (f: string) => readFileSync(f).toString('utf8');

describe('the .bat launchers', () => {
  it('is one launcher (installs, updates, opens) and one diagnosis to send to someone', () => {
    expect(bats.sort()).toEqual(['Abrir Tarkov MoA.bat', 'Diagnosticar Tarkov MoA.bat']);
  });

  describe('Diagnosticar Tarkov MoA.bat', () => {
    const text = read('Diagnosticar Tarkov MoA.bat');
    const ps = text.slice(text.lastIndexOf('##POWERSHELL##'));

    it('carries its PowerShell after a marker that appears once, and finds it without spelling it out', () => {
      expect(text.split('##POWERSHELL##')).toHaveLength(2);
      expect(text).toContain("$m = '##' + 'POWERSHELL' + '##'");
    });

    it('closes only the MoA of the folder it repairs, keeps folders it replaces, keeps the app data', () => {
      expect(text).not.toMatch(/taskkill/i);
      expect(ps).toContain('function Close-MoA-In');
      expect(ps).toContain("(antiga)");
      expect(ps).not.toMatch(/Remove-Item[^\r\n]*com\.tarkov-companion/);
    });

    it('opens through the launcher and then deletes itself (unless it sits in the program folder)', () => {
      expect(text).toContain('call "%DEST%\\Abrir Tarkov MoA.bat" --atualizado');
      expect(text).toContain('(goto) 2>nul & del "%~f0"');
    });
  });

  it.each(bats)('%s keeps Windows (CRLF) line endings on every line', (f) => {
    const text = read(f);
    const lfOnly = text.split('\r\n').filter((chunk) => chunk.includes('\n')).length;
    expect(lfOnly, `${f} has lines ending in LF only`).toBe(0);
  });

  describe('Abrir Tarkov MoA.bat installs when it is not in the program folder', () => {
    const text = read('Abrir Tarkov MoA.bat');

    it('picks installing or opening before anything else', () => {
      const pick = text.indexOf('if /i "%~1"=="--instalar" goto :install');
      expect(pick).toBeGreaterThan(0);
      expect(text.indexOf('if not exist "%~dp0package.json" goto :install')).toBeGreaterThan(pick);
      expect(text.indexOf(':install\r\n')).toBeGreaterThan(pick);
      expect(text.indexOf(':open\r\n')).toBeGreaterThan(text.indexOf(':install\r\n'));
    });

    it('installs into Documents and hands over to the installed copy, which then opens', () => {
      expect(text).toContain('set "DEST=%DOCS%\\Tarkov MoA"');
      expect(text).toContain('call "%DEST%\\Abrir Tarkov MoA.bat" --atualizado');
    });

    it('a program folder without Git installs a copy that updates itself, from a copy of this file', () => {
      expect(text).toMatch(/copy \/y "%~f0" "%ICOPY%"[^\r\n]*\r\n(?:[^\r\n]*\r\n)*?\(\r\n\s*call "%ICOPY%" --instalar\r\n\s*del "%ICOPY%"[^\r\n]*\r\n\s*exit \/b\r\n\)/);
    });

    it('every label is there once, and every jump has its label', () => {
      const labels = [...text.matchAll(/^:([A-Za-z_0-9]+)\r$/gm)].map((m) => m[1]);
      expect(labels.length).toBeGreaterThan(40);
      expect(new Set(labels).size).toBe(labels.length);
      const jumps = new Set([...text.matchAll(/(?:goto|call) :([A-Za-z_0-9]+)/g)].map((m) => m[1]));
      for (const j of jumps) if (j !== 'eof') expect(labels, `:${j}`).toContain(j);
    });
  });

  describe('Abrir Tarkov MoA.bat repairs an install that will not update', () => {
    const text = read('Abrir Tarkov MoA.bat');

    it('Git trusts the program folders (a folder made by another Windows user is "dubious" to it)', () => {
      expect(text).toContain('set "GIT_CONFIG_KEY_0=safe.directory"');
      expect(text).toContain('set "GIT_CONFIG_VALUE_0=*"');
    });

    it('only GitHub\'s own words count as a refused login ("Permission denied" on a file is the folder)', () => {
      const auth = text.slice(text.indexOf(':auth_error\r\n'), text.indexOf('exit /b', text.indexOf(':auth_error\r\n')));
      expect(auth).toContain('/c:"returned error: 403"');
      expect(auth).not.toMatch(/\/c:"403"|\/c:"denied"/);
    });

    it('a broken install is set aside and downloaded again, once', () => {
      expect(text).toMatch(/:update_broken\r\ncall :is_install_dir/);
      expect(text).toMatch(/set "MOA_REPAIR=1"\r\n\s*call "%ICOPY%" --instalar/);
      expect(text).toMatch(/if not defined REPAIRED \(\r\n\s*set "REPAIRED=1"/);
    });

    it('closes only the MoA of the folder it replaces, never every MoA by name', () => {
      expect(text).not.toMatch(/taskkill[^\r\n]*tarkov-companion/i);
      expect(text).toContain(':close_moa');
    });

    it('a copy run from outside the program deletes itself when it is done', () => {
      expect(text).toContain('(goto) 2>nul & del "%~f0"');
      expect(text).toContain('if /i "%~dp0"=="%DEST%\\" exit /b 0');
    });
  });

  describe('Abrir Tarkov MoA.bat hands over to the newest launcher first', () => {
    const text = read('Abrir Tarkov MoA.bat');

    it('takes the newest launcher from GitHub into a temporary copy, only if that copy can run as one', () => {
      expect(text).toMatch(/git cat-file --filters "%UP0%:Abrir Tarkov MoA\.bat" > "%NEWBAT%"/);
      expect(text).toMatch(/findstr \/c:"--copia" "%NEWBAT%"/);
    });

    it('runs the copy, deletes it and leaves in one block (nothing of the replaced file is read after)', () => {
      const block = /\(\r\n(?:[^\r\n]*\r\n)*?\s*call "%NEWBAT%" --copia "%CD%" buscado\r\n\s*del "%NEWBAT%"[^\r\n]*\r\n\s*exit \/b\r\n\)/;
      expect(text).toMatch(block);
    });

    it('as the copy, works in the project folder and does not hand over or restart again', () => {
      expect(text).toContain('if /i "%~1"=="--copia" (');
      expect(text).toContain('set "PROJECT=%~2"');
      expect(text).toContain('if defined LAUNCHER_COPY goto :handover_done');
      expect(text).toContain('set "SELF=%CD%\\Abrir Tarkov MoA.bat"');
      expect(text).toMatch(/if defined MERGED if not defined LAUNCHER_COPY \(\r\n\s*call :ok[^\r\n]*\r\n\s*call "%~f0" --atualizado/);
    });

    it('still accepts --atualizado from an older launcher that restarts with this one', () => {
      expect(text).toContain('if /i "%~1"=="--atualizado" goto :handover_done');
    });
  });
});
