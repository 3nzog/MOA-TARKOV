// Opening the .exe directly does what "Abrir Tarkov MoA.bat" does first: it
// asks GitHub whether there is a newer version and, when there is, hands over
// to the .bat (which downloads it, rebuilds and opens the new .exe) and quits.
//
// Only for the folder this app was built from by the .bat: a git checkout with
// the .bat beside it. Without git, without internet or when GitHub takes too
// long, the app just opens as it is. Git never asks for a login here
// (no prompt, no credential helper): the repository is public.
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const LAUNCHER: &str = "Abrir Tarkov MoA.bat";
/// Set by the .bat (and by this hand-over) on the .exe it starts: it has just
/// checked, so the .exe does not check again (nor loop when the update failed).
pub const FROM_LAUNCHER: &str = "MOA_FROM_LAUNCHER";
const FETCH_TIMEOUT: Duration = Duration::from_secs(6);

/// The project folder: four levels above src-tauri\target\release\x.exe, or
/// the folder it was built in. It must hold the .bat and a .git.
fn project_root() -> Option<PathBuf> {
    let from_exe = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.ancestors().nth(4).map(Path::to_path_buf));
    let built_in = Path::new(env!("CARGO_MANIFEST_DIR")).parent().map(Path::to_path_buf);
    [from_exe, built_in]
        .into_iter()
        .flatten()
        .find(|root| is_project(root))
}

fn is_project(root: &Path) -> bool {
    root.join(LAUNCHER).is_file() && root.join(".git").exists() && root.join("package.json").is_file()
}

fn git(root: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .args(["-c", "credential.helper="])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn git_out(root: &Path, args: &[&str]) -> Option<String> {
    let out = git(root).args(args).stdout(Stdio::piped()).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

/// `git fetch`, given up after `limit`.
fn fetch(root: &Path, limit: Duration) -> bool {
    let Ok(mut child) = git(root).args(["fetch", "--quiet", "origin"]).spawn() else {
        return false;
    };
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if start.elapsed() < limit => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

/// The branch the .bat follows: the upstream, else origin/main (or master).
fn upstream(root: &Path) -> Option<String> {
    git_out(root, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).or_else(|| {
        ["origin/main", "origin/master"]
            .into_iter()
            .find(|b| git_out(root, &["rev-parse", "--verify", "--quiet", b]).is_some())
            .map(str::to_string)
    })
}

/// GitHub has commits this folder does not have yet. A folder that is only
/// ahead (unsent work of its own) is up to date.
fn behind(root: &Path) -> bool {
    let Some(up) = upstream(root) else { return false };
    let range = format!("HEAD..{up}");
    git_out(root, &["rev-list", "--count", &range])
        .and_then(|n| n.parse::<u64>().ok())
        .is_some_and(|n| n > 0)
}

/// Opens the .bat in its own window, marked so that the .exe it opens at the
/// end does not check again.
fn hand_over(root: &Path) -> bool {
    let mut cmd = Command::new(root.join(LAUNCHER));
    cmd.current_dir(root).env(FROM_LAUNCHER, "1");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        cmd.creation_flags(CREATE_NEW_CONSOLE);
    }
    cmd.spawn().is_ok()
}

/// True when the .bat took over to update: the caller quits without opening.
pub fn hand_over_if_outdated() -> bool {
    if cfg!(debug_assertions) || std::env::var_os(FROM_LAUNCHER).is_some() {
        return false;
    }
    let Some(root) = project_root() else { return false };
    if !fetch(&root, FETCH_TIMEOUT) || !behind(&root) {
        return false;
    }
    hand_over(&root)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(dir: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .current_dir(dir)
            .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"])
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        assert!(ok, "git {args:?}");
    }

    fn git_available() -> bool {
        Command::new("git").arg("--version").output().is_ok_and(|o| o.status.success())
    }

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("moa-self-update-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_folder_behind_github_is_outdated_and_one_ahead_is_not() {
        if !git_available() {
            return;
        }
        let base = temp_dir("behind");
        let origin = base.join("origin");
        let here = base.join("here");
        std::fs::create_dir_all(&origin).unwrap();
        run(&origin, &["init", "--quiet", "-b", "main"]);
        std::fs::write(origin.join("package.json"), "{}").unwrap();
        std::fs::write(origin.join(LAUNCHER), "@echo off").unwrap();
        run(&origin, &["add", "."]);
        run(&origin, &["commit", "--quiet", "-m", "one"]);
        run(&base, &["clone", "--quiet", "origin", "here"]);
        assert!(is_project(&here));

        assert!(fetch(&here, FETCH_TIMEOUT));
        assert!(!behind(&here), "same version");

        // A new version on "GitHub".
        std::fs::write(origin.join("a.txt"), "new").unwrap();
        run(&origin, &["add", "."]);
        run(&origin, &["commit", "--quiet", "-m", "two"]);
        assert!(fetch(&here, FETCH_TIMEOUT));
        assert!(behind(&here), "GitHub has a newer version");

        // Caught up and then ahead with work of its own: not outdated.
        run(&here, &["merge", "--quiet", "--ff-only", "origin/main"]);
        std::fs::write(here.join("b.txt"), "mine").unwrap();
        run(&here, &["add", "."]);
        run(&here, &["commit", "--quiet", "-m", "mine"]);
        assert!(!behind(&here));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn a_folder_without_git_or_the_launcher_is_not_the_project() {
        let d = temp_dir("plain");
        std::fs::write(d.join("package.json"), "{}").unwrap();
        assert!(!is_project(&d));
        std::fs::write(d.join(LAUNCHER), "@echo off").unwrap();
        assert!(!is_project(&d), "no .git");
        let _ = std::fs::remove_dir_all(&d);
    }
}
