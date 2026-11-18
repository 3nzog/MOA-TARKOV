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
  it('exist', () => {
    expect(bats).toContain('Abrir Tarkov MoA.bat');
    expect(bats).toContain('Instalar Tarkov MoA.bat');
  });

  it.each(bats)('%s keeps Windows (CRLF) line endings on every line', (f) => {
    const text = read(f);
    const lfOnly = text.split('\r\n').filter((chunk) => chunk.includes('\n')).length;
    expect(lfOnly, `${f} has lines ending in LF only`).toBe(0);
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
