//! The update window (T-119): AXISNotes's own small window that installs an update, in
//! place of the installer's plain progress window.
//!
//! Installing replaces the app's files, so the app can't show it itself. It copies its own
//! executable to the temp folder and starts that copy in updater mode (`--axis-updater`
//! with a job file), then quits. The copy opens the update window, runs the installer
//! silently (`/S /UPDATE`; it closes any AXISNotes still running), and starts the updated
//! app. If the installer fails, the window says so and offers to open AXISNotes again.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::{AppError, AppResult};

/// The command-line flag that starts updater mode; the job file's path follows it.
pub const FLAG: &str = "--axis-updater";
/// The updater's copy of the executable. Not the installed name (`axisnotes.exe`), which
/// the installer looks for to close it.
const COPY_NAME: &str = "AXISNotes-updater.exe";

/// What the update window installs, written by the running app before it quits.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    /// The verified installer.
    pub installer: PathBuf,
    /// The installed app, started again when done.
    pub relaunch: PathBuf,
    pub from_version: String,
    pub to_version: String,
    pub notes: String,
}

/// The job, when this process was started as the updater.
pub fn job_from_args(args: &[String]) -> Option<AppResult<Job>> {
    let i = args.iter().position(|a| a == FLAG)?;
    Some(match args.get(i + 1) {
        Some(path) => read_job(Path::new(path)),
        None => Err(AppError::Io(format!("{FLAG} needs a job file"))),
    })
}

fn read_job(path: &Path) -> AppResult<Job> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| AppError::Io(format!("couldn’t read the update job: {e}")))?;
    serde_json::from_str(&text).map_err(|e| AppError::Io(format!("bad update job: {e}")))
}

/// Starts the update window for `job` from a copy of this executable in `dir`. On success
/// the caller quits so the installer can replace the app.
pub fn start(dir: &Path, job: &Job) -> AppResult<()> {
    let io = |what: &str, e: std::io::Error| AppError::Io(format!("couldn’t {what}: {e}"));
    std::fs::create_dir_all(dir).map_err(|e| io("prepare the update", e))?;
    let exe = std::env::current_exe().map_err(|e| io("find AXISNotes", e))?;
    let copy = dir.join(COPY_NAME);
    std::fs::copy(&exe, &copy).map_err(|e| io("prepare the update window", e))?;
    let job_file = dir.join("update-job.json");
    let text = serde_json::to_string_pretty(job).map_err(|e| AppError::Io(e.to_string()))?;
    std::fs::write(&job_file, text).map_err(|e| io("prepare the update", e))?;
    // Arguments, never a shell string.
    Command::new(&copy)
        .arg(FLAG)
        .arg(&job_file)
        .spawn()
        .map_err(|e| io("start the update window", e))?;
    Ok(())
}

/// The job, or why it couldn't be read (shown in the window).
struct JobState(Result<Job, String>);

impl JobState {
    fn get(&self) -> AppResult<Job> {
        self.0.clone().map_err(AppError::Io)
    }
}

/// Runs the update window until it closes. `context` is the app's own (same pages).
pub fn run(mut context: tauri::Context<tauri::Wry>, job: AppResult<Job>) {
    // Only the update window: not the main one from the config.
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .manage(JobState(job.map_err(|e| e.to_string())))
        .setup(|app| {
            let job = app.state::<JobState>();
            let mut window =
                WebviewWindowBuilder::new(app, "updater", WebviewUrl::App("index.html".into()))
                    .title("Updating AXISNotes")
                    .inner_size(440.0, 300.0)
                    .resizable(false)
                    .maximizable(false)
                    .decorations(false)
                    .center()
                    .initialization_script("window.__AXIS_UPDATER__ = true;");
            // Its own browser storage, so it never waits on the closing app's.
            if let Ok(job) = &job.0 {
                window = window.data_directory(job.installer.with_file_name("updater-webview"));
            }
            window.build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            updater_job,
            updater_install,
            updater_finish
        ])
        .run(context)
        .expect("error while running the AXISNotes update window");
}

/// The update being installed, for the window to show.
#[tauri::command]
fn updater_job(job: tauri::State<'_, JobState>) -> AppResult<Job> {
    job.get()
}

/// Runs the installer silently and waits for it.
#[tauri::command]
async fn updater_install(job: tauri::State<'_, JobState>) -> AppResult<()> {
    let job = job.get()?;
    tauri::async_runtime::spawn_blocking(move || install(&job.installer))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

fn install(installer: &Path) -> AppResult<()> {
    // Silent (no installer window: this one shows progress), update mode (keeps the
    // user's shortcut choices). It closes any AXISNotes still running first.
    let status = Command::new(installer)
        .args(["/S", "/UPDATE"])
        .stdin(Stdio::null())
        .status()
        .map_err(|e| AppError::Io(format!("couldn’t start the installer: {e}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::Io(match status.code() {
            Some(code) => format!("The installer stopped with error {code}."),
            None => "The installer stopped unexpectedly.".into(),
        }))
    }
}

/// Closes the update window, opening AXISNotes first when `open` is set.
#[tauri::command]
fn updater_finish(app: AppHandle, job: tauri::State<'_, JobState>, open: bool) -> AppResult<()> {
    if open {
        let job = job.get()?;
        Command::new(&job.relaunch)
            .stdin(Stdio::null())
            .spawn()
            .map_err(|e| AppError::Io(format!("couldn’t open AXISNotes: {e}")))?;
    }
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job() -> Job {
        Job {
            installer: PathBuf::from("C:/t/AXISNotes_0.4.0_x64-setup.exe"),
            relaunch: PathBuf::from("C:/apps/AXISNotes/axisnotes.exe"),
            from_version: "0.3.0".into(),
            to_version: "0.4.0".into(),
            notes: "Faster search".into(),
        }
    }

    #[test]
    fn reads_the_job_named_after_the_flag() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("job.json");
        std::fs::write(&file, serde_json::to_string(&job()).unwrap()).unwrap();
        let args = vec![
            "axisnotes.exe".into(),
            FLAG.into(),
            file.display().to_string(),
        ];
        assert_eq!(job_from_args(&args).unwrap().unwrap(), job());
    }

    #[test]
    fn is_not_the_updater_without_the_flag() {
        assert!(job_from_args(&["axisnotes.exe".into()]).is_none());
        assert!(job_from_args(&["axisnotes.exe".into(), FLAG.into()])
            .unwrap()
            .is_err());
        let missing = vec!["x".into(), FLAG.into(), "C:/nowhere/job.json".into()];
        assert!(job_from_args(&missing).unwrap().is_err());
    }

    #[test]
    fn reports_an_installer_that_fails() {
        // A program that exits with an error stands in for a failed installer.
        let failing = if cfg!(windows) {
            "C:/Windows/System32/whoami.exe"
        } else {
            "/bin/false"
        };
        let err = install(Path::new(failing)).unwrap_err();
        assert!(err.to_string().contains("error"), "{err}");
        assert!(install(Path::new("C:/nowhere/setup.exe")).is_err());
    }
}
