//! The selected app logo on the Windows window, taskbar button and pins.
//!
//! Tauri's setIcon updates ICON_SMALL only, so the logo is also set as ICON_BIG. That alone
//! is not enough: the installer's Start-menu shortcut gives AXISNotes the AppUserModelID
//! `app.axis.axisnotes`, Windows groups the window under it, and the taskbar then draws the
//! shortcut's icon and ignores the window's icons. A custom logo therefore also gives the
//! main window its own AppUserModelID with relaunch properties (command, name and a saved
//! .ico), so the button and any pin made from it show the logo. The original logo clears
//! them, and the window rejoins the installed shortcut.
//!
//! Windows caches a relaunch icon by its path, so each logo is saved under a name made from
//! its pixels (`logo-<hash>.ico`) and `current.txt` names the one in use. The few most recent
//! icons are kept, as pins may still point at them. At startup the current one is applied at
//! once, so a fresh launch shows the logo before the page loads.

use crate::error::{AppError, AppResult};
#[cfg(windows)]
use tauri::Manager;

const SIDE: usize = 256;
const PIXEL_BYTES: usize = SIDE * SIDE * 4;
/// The window identity used while a custom logo is selected (see the module docs).
pub const BRANDED_APP_ID: &str = "app.axis.axisnotes.logo";
/// Folder (in app-local data) holding the saved logo icons.
#[cfg(windows)]
const ICON_DIR: &str = "taskbar";
/// Names the icon in use; present only while a custom logo is selected.
const CURRENT_FILE: &str = "current.txt";
/// Saved icons kept, the current one included.
const KEEP_ICONS: usize = 6;

#[derive(Default)]
pub struct TaskbarIconState {
    #[cfg(windows)]
    current: std::sync::Arc<std::sync::Mutex<Option<native::Icon>>>,
    /// The small icon set at startup, kept alive until Tauri replaces it and the app exits.
    #[cfg(windows)]
    startup_small: std::sync::Arc<std::sync::Mutex<Option<native::Icon>>>,
    /// Counts logo changes, so a delayed identity from an older change is dropped.
    #[cfg(windows)]
    generation: std::sync::Arc<std::sync::atomic::AtomicU64>,
    /// The relaunch icon the window's identity points at (None: the installed identity).
    #[cfg(windows)]
    shown: std::sync::Mutex<Option<std::path::PathBuf>>,
}

/// How long the window goes without its own identity before getting it back, so the taskbar
/// notices the change and rereads the relaunch icon (an instant swap is ignored).
#[cfg(windows)]
const IDENTITY_GAP: std::time::Duration = std::time::Duration::from_millis(400);

fn allowed_caller(label: &str, url: &tauri::Url) -> bool {
    label == "main"
        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (matches!(url.scheme(), "http" | "https")
                && url.host_str() == Some("tauri.localhost"))
            || (cfg!(debug_assertions)
                && url.origin().ascii_serialization() == "http://localhost:1420"))
}

/// A 256×256 32-bit .ico (one BMP image with its 1-bit transparency mask) from RGBA pixels.
pub fn ico_bytes(rgba: &[u8]) -> AppResult<Vec<u8>> {
    if rgba.len() != PIXEL_BYTES {
        return Err(AppError::InvalidName(
            "Expected a 256×256 RGBA icon.".into(),
        ));
    }
    let row_mask = SIDE / 8; // 32 bytes: already a multiple of 4.
    let image_bytes = 40 + PIXEL_BYTES + row_mask * SIDE;
    let mut out = Vec::with_capacity(22 + image_bytes);
    // ICONDIR, then one ICONDIRENTRY (0 means 256 for width/height).
    for v in [0u16, 1, 1] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(&[0, 0, 0, 0]);
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(&(image_bytes as u32).to_le_bytes());
    out.extend_from_slice(&22u32.to_le_bytes());
    // BITMAPINFOHEADER; an icon's height counts the colour and mask rows together.
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&(SIDE as i32).to_le_bytes());
    out.extend_from_slice(&(2 * SIDE as i32).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&((PIXEL_BYTES + row_mask * SIDE) as u32).to_le_bytes());
    out.extend_from_slice(&[0; 16]);
    // Rows are stored bottom-up, as BGRA, followed by the AND mask (1 = transparent).
    for row in (0..SIDE).rev() {
        for pixel in rgba[row * SIDE * 4..(row + 1) * SIDE * 4].chunks_exact(4) {
            out.extend_from_slice(&[pixel[2], pixel[1], pixel[0], pixel[3]]);
        }
    }
    for row in (0..SIDE).rev() {
        let mut mask = [0u8; SIDE / 8];
        for x in 0..SIDE {
            if rgba[(row * SIDE + x) * 4 + 3] == 0 {
                mask[x / 8] |= 0x80 >> (x % 8);
            }
        }
        out.extend_from_slice(&mask);
    }
    Ok(out)
}

/// 64-bit FNV-1a: a stable name for a logo's pixels.
fn fnv(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3)
    })
}

fn is_icon_name(name: &str) -> bool {
    name.strip_prefix("logo-")
        .and_then(|n| n.strip_suffix(".ico"))
        .is_some_and(|hex| hex.len() == 16 && hex.chars().all(|c| c.is_ascii_hexdigit()))
}

fn io_error(e: std::io::Error) -> AppError {
    AppError::Io(e.to_string())
}

/// Save `rgba` as the current logo icon in `dir` and return its path. Keeps the most
/// recent `KEEP_ICONS` icons and removes older ones.
pub fn save_current(dir: &std::path::Path, rgba: &[u8]) -> AppResult<std::path::PathBuf> {
    let bytes = ico_bytes(rgba)?;
    std::fs::create_dir_all(dir).map_err(io_error)?;
    let name = format!("logo-{:016x}.ico", fnv(rgba));
    let path = dir.join(&name);
    // Rewritten even when present: the newest file is the one kept longest.
    std::fs::write(&path, bytes).map_err(io_error)?;
    std::fs::write(dir.join(CURRENT_FILE), &name).map_err(io_error)?;
    let mut old: Vec<(std::time::SystemTime, std::path::PathBuf)> = std::fs::read_dir(dir)
        .map_err(io_error)?
        .flatten()
        .filter(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            is_icon_name(&n) && n != name
        })
        .map(|e| {
            let modified = e.metadata().and_then(|m| m.modified());
            (modified.unwrap_or(std::time::UNIX_EPOCH), e.path())
        })
        .collect();
    old.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    for (_, stale) in old.into_iter().skip(KEEP_ICONS - 1) {
        let _ = std::fs::remove_file(stale);
    }
    Ok(path)
}

/// The original logo: no icon is current (saved icons stay for pins that use them).
pub fn clear_current(dir: &std::path::Path) -> AppResult<()> {
    match std::fs::remove_file(dir.join(CURRENT_FILE)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(io_error(e)),
        _ => Ok(()),
    }
}

/// The current logo icon, if a custom logo is selected and its file is still there.
pub fn current(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let name = std::fs::read_to_string(dir.join(CURRENT_FILE)).ok()?;
    let name = name.trim();
    let path = dir.join(name);
    (is_icon_name(name) && path.is_file()).then_some(path)
}

#[cfg(windows)]
fn icon_dir(app: &tauri::AppHandle) -> AppResult<std::path::PathBuf> {
    // Tests run with their own settings folder, never the installed app's.
    if let Some(config) = std::env::var_os("AXIS_CONFIG_DIR") {
        return Ok(std::path::PathBuf::from(config).join(ICON_DIR));
    }
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(dir.join(ICON_DIR))
}

/// Relaunch properties for a branded window: the running executable and the saved icon.
#[cfg(windows)]
fn identity(icon: &std::path::Path) -> AppResult<native::Identity> {
    let exe = std::env::current_exe().map_err(|e| AppError::Io(e.to_string()))?;
    Ok(native::Identity {
        command: format!("\"{}\"", exe.display()),
        icon: format!("{},0", icon.display()),
    })
}

/// Set the main window's icons from `rgba`. `branded` is false for the original AXIS logo,
/// which keeps the installed shortcut's identity; true gives the window its own (see above).
#[tauri::command]
pub fn set_taskbar_icon(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, TaskbarIconState>,
    rgba: Vec<u8>,
    branded: bool,
) -> AppResult<()> {
    let url = window.url().map_err(|e| AppError::Blocked(e.to_string()))?;
    if !allowed_caller(window.label(), &url) {
        return Err(AppError::Blocked(
            "Only the main app can set its taskbar icon.".into(),
        ));
    }
    if rgba.len() != PIXEL_BYTES {
        return Err(AppError::InvalidName(
            "Expected a 256×256 RGBA icon.".into(),
        ));
    }
    #[cfg(windows)]
    {
        let dir = icon_dir(window.app_handle())?;
        let saved = if branded {
            Some(save_current(&dir, &rgba)?)
        } else {
            clear_current(&dir)?;
            None
        };
        // The same logo again (the page reapplies it at startup): only the window icon.
        let unchanged = {
            let mut shown = state.shown.lock().unwrap_or_else(|e| e.into_inner());
            let unchanged = *shown == saved;
            *shown = saved.clone();
            unchanged
        };
        let identity = saved.as_deref().map(identity).transpose()?;
        let icon = native::create(&rgba)?;
        let hwnd = window.hwnd().map_err(|e| AppError::Io(e.to_string()))?.0 as usize;
        let current = state.current.clone();
        use std::sync::atomic::Ordering;
        // An unchanged logo must not cancel a pending identity from the previous change.
        let mine = if unchanged {
            state.generation.load(Ordering::SeqCst)
        } else {
            state.generation.fetch_add(1, Ordering::SeqCst) + 1
        };
        // Serialize replacements with window messages. The old HICON stays alive until
        // Windows has accepted the new one; never destroy Tauri's separately owned small icon.
        // The button shows the relaunch icon, which the taskbar rereads only when the window's
        // identity changes: clear it now, and give it back after a short gap (dropped if
        // another change came in meanwhile).
        window
            .run_on_main_thread(move || {
                native::install(hwnd, icon, &current);
                if unchanged {
                    return;
                }
                if let Err(e) = native::set_identity(hwnd, None) {
                    eprintln!("taskbar identity: {e}");
                }
            })
            .map_err(|e| AppError::Io(e.to_string()))?;
        if let Some(identity) = identity.filter(|_| !unchanged) {
            let generation = state.generation.clone();
            let window = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(IDENTITY_GAP);
                let _ = window.run_on_main_thread(move || {
                    if generation.load(Ordering::SeqCst) != mine {
                        return;
                    }
                    if let Err(e) = native::set_identity(hwnd, Some(&identity)) {
                        eprintln!("taskbar identity: {e}");
                    }
                });
            });
        }
    }
    #[cfg(not(windows))]
    let _ = (state, branded);
    Ok(())
}

/// At startup, before the page loads: if the last logo was a custom one, show it on the
/// main window and give the window its own taskbar identity straight away.
pub fn restore(app: &tauri::AppHandle) {
    #[cfg(windows)]
    {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let Some(path) = icon_dir(app).ok().and_then(|dir| current(&dir)) else {
            return;
        };
        let (Ok(hwnd), Ok(identity)) = (window.hwnd(), identity(&path)) else {
            return;
        };
        let state = app.state::<TaskbarIconState>();
        match native::load(&path) {
            Ok((big, small)) => {
                native::install(hwnd.0 as usize, big, &state.current);
                native::install_small(hwnd.0 as usize, small, &state.startup_small);
            }
            Err(e) => {
                eprintln!("taskbar icon {}: {e}", path.display());
                return;
            }
        }
        match native::set_identity(hwnd.0 as usize, Some(&identity)) {
            Ok(()) => *state.shown.lock().unwrap_or_else(|e| e.into_inner()) = Some(path),
            Err(e) => eprintln!("taskbar identity: {e}"),
        }
    }
    #[cfg(not(windows))]
    let _ = app;
}

#[cfg(windows)]
mod native {
    use super::*;
    use std::ffi::c_void;
    use std::sync::Mutex;
    use windows::core::{HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{HWND, PROPERTYKEY};
    use windows::Win32::System::Com::StructuredStorage::{
        PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
    };
    use windows::Win32::System::Variant::{VT_EMPTY, VT_LPWSTR};
    use windows::Win32::UI::Shell::PropertiesSystem::{
        IPropertyStore, SHGetPropertyStoreForWindow,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, LoadImageW, IMAGE_ICON, LR_LOADFROMFILE, SM_CXSMICON, SM_CYSMICON,
    };

    #[link(name = "user32")]
    unsafe extern "system" {
        fn CreateIcon(
            instance: *mut c_void,
            width: i32,
            height: i32,
            planes: u8,
            bits: u8,
            and_mask: *const u8,
            xor_mask: *const u8,
        ) -> *mut c_void;
        fn DestroyIcon(icon: *mut c_void) -> i32;
        fn SendMessageW(hwnd: *mut c_void, message: u32, wparam: usize, lparam: isize) -> isize;
    }

    /// An app-owned HICON, retained for the lifetime of its use by the window.
    /// Integer storage permits moving ownership to Tauri's UI thread.
    pub(super) struct Icon(usize);
    impl Drop for Icon {
        fn drop(&mut self) {
            // SAFETY: exclusively owns a successful CreateIcon/LoadImage result, never a
            // shared/class icon.
            unsafe {
                DestroyIcon(self.0 as *mut c_void);
            }
        }
    }

    /// Relaunch properties for a window with its own AppUserModelID.
    pub(super) struct Identity {
        pub command: String,
        pub icon: String,
    }

    fn pixels(rgba: &[u8]) -> AppResult<(Vec<u8>, Vec<u8>)> {
        if rgba.len() != PIXEL_BYTES {
            return Err(AppError::InvalidName(
                "Expected a 256×256 RGBA icon.".into(),
            ));
        }
        let mut bgra = rgba.to_vec();
        let mut mask = vec![0; SIDE * SIDE / 8]; // 1-bit AND mask, rows aligned to 32 bits.
        for (index, pixel) in bgra.chunks_exact_mut(4).enumerate() {
            pixel.swap(0, 2);
            if pixel[3] == 0 {
                mask[index / 8] |= 0x80 >> (index % 8);
            }
        }
        Ok((bgra, mask))
    }

    pub(super) fn create(rgba: &[u8]) -> AppResult<Icon> {
        let (bgra, mask) = pixels(rgba)?;
        // SAFETY: buffers have the exact fixed size required by a 256×256 32-bit icon.
        // CreateIcon copies both buffers; no pointer outlives this call.
        let handle = unsafe {
            CreateIcon(
                std::ptr::null_mut(),
                SIDE as i32,
                SIDE as i32,
                1,
                32,
                mask.as_ptr(),
                bgra.as_ptr(),
            )
        };
        if handle.is_null() {
            Err(AppError::Io(std::io::Error::last_os_error().to_string()))
        } else {
            Ok(Icon(handle as usize))
        }
    }

    /// The saved .ico at full size (ICON_BIG) and at the system's small-icon size.
    pub(super) fn load(path: &std::path::Path) -> AppResult<(Icon, Icon)> {
        let file = HSTRING::from(path.as_os_str());
        let one = |w: i32, h: i32| -> AppResult<Icon> {
            // SAFETY: loads a private copy from a file; the handle is owned by the result.
            let handle = unsafe {
                LoadImageW(
                    None,
                    PCWSTR(file.as_ptr()),
                    IMAGE_ICON,
                    w,
                    h,
                    LR_LOADFROMFILE,
                )
            }
            .map_err(|e| AppError::Io(e.to_string()))?;
            Ok(Icon(handle.0 as usize))
        };
        // SAFETY: GetSystemMetrics has no preconditions.
        let (sw, sh) = unsafe { (GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON)) };
        Ok((one(SIDE as i32, SIDE as i32)?, one(sw, sh)?))
    }

    pub(super) fn install(hwnd: usize, icon: Icon, current: &Mutex<Option<Icon>>) {
        // SAFETY: HWND was obtained from the calling main window and this runs on its UI
        // thread. WM_SETICON (0x80), ICON_BIG (1) borrows our live, independently owned icon.
        unsafe {
            SendMessageW(hwnd as *mut c_void, 0x80, 1, icon.0 as isize);
        }
        *current.lock().unwrap_or_else(|e| e.into_inner()) = Some(icon);
    }

    /// Startup only: ICON_SMALL (0) until Tauri's own setIcon replaces it.
    pub(super) fn install_small(hwnd: usize, icon: Icon, keep: &Mutex<Option<Icon>>) {
        // SAFETY: as in `install`; the icon outlives its use because `keep` holds it.
        unsafe {
            SendMessageW(hwnd as *mut c_void, 0x80, 0, icon.0 as isize);
        }
        *keep.lock().unwrap_or_else(|e| e.into_inner()) = Some(icon);
    }

    const APP_USER_MODEL: windows::core::GUID =
        windows::core::GUID::from_u128(0x9F4C2855_9F79_4B39_A8D0_E1D42DE1D5F3);
    const fn key(pid: u32) -> PROPERTYKEY {
        PROPERTYKEY {
            fmtid: APP_USER_MODEL,
            pid,
        }
    }
    const RELAUNCH_COMMAND: PROPERTYKEY = key(2);
    const RELAUNCH_ICON: PROPERTYKEY = key(3);
    const RELAUNCH_NAME: PROPERTYKEY = key(4);
    const ID: PROPERTYKEY = key(5);

    fn set(store: &IPropertyStore, key: &PROPERTYKEY, value: Option<&str>) -> AppResult<()> {
        let mut wide: Vec<u16> = value
            .unwrap_or_default()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let value = PROPVARIANT {
            Anonymous: PROPVARIANT_0 {
                Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                    vt: if value.is_some() { VT_LPWSTR } else { VT_EMPTY },
                    wReserved1: 0,
                    wReserved2: 0,
                    wReserved3: 0,
                    Anonymous: PROPVARIANT_0_0_0 {
                        pwszVal: PWSTR(wide.as_mut_ptr()),
                    },
                }),
            },
        };
        // SAFETY: SetValue copies the value; `wide` outlives the call and is freed by Rust.
        // The PROPVARIANT is never cleared, so the borrowed string is not freed twice.
        let result = unsafe { store.SetValue(key, &value) };
        std::mem::forget(value);
        result.map_err(|e| AppError::Io(e.to_string()))
    }

    /// Give the window its own AppUserModelID with relaunch properties, or clear them so it
    /// rejoins the installed shortcut. Relaunch properties are set before the ID and cleared
    /// after it, as they only apply to a window with an explicit ID.
    pub(super) fn set_identity(hwnd: usize, identity: Option<&Identity>) -> AppResult<()> {
        // SAFETY: a live top-level window of this process, on its UI thread (COM is
        // initialised there by the webview).
        let store: IPropertyStore =
            unsafe { SHGetPropertyStoreForWindow(HWND(hwnd as *mut c_void)) }
                .map_err(|e| AppError::Io(e.to_string()))?;
        match identity {
            Some(identity) => {
                set(&store, &RELAUNCH_COMMAND, Some(&identity.command))?;
                set(&store, &RELAUNCH_NAME, Some("AXISNotes"))?;
                set(&store, &RELAUNCH_ICON, Some(&identity.icon))?;
                set(&store, &ID, Some(BRANDED_APP_ID))?;
            }
            None => {
                set(&store, &ID, None)?;
                set(&store, &RELAUNCH_ICON, None)?;
                set(&store, &RELAUNCH_NAME, None)?;
                set(&store, &RELAUNCH_COMMAND, None)?;
            }
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn converts_colour_and_transparency_without_changing_alpha() {
            let mut rgba = vec![0; PIXEL_BYTES];
            rgba[..8].copy_from_slice(&[17, 34, 51, 255, 68, 85, 102, 128]);
            let (bgra, mask) = pixels(&rgba).unwrap();
            assert_eq!(&bgra[..8], &[51, 34, 17, 255, 102, 85, 68, 128]);
            assert_eq!(mask.len(), 8192);
            assert_eq!(mask[0], 0b00111111);
            assert_eq!(*mask.last().unwrap(), 255);
            assert!(pixels(&rgba[..PIXEL_BYTES - 1]).is_err());
            assert!(pixels(&vec![0; PIXEL_BYTES + 1]).is_err());
            // Exercise real native allocation/release rather than treating RGBA as a handle.
            drop(create(&rgba).unwrap());
        }

        #[test]
        fn saved_icon_loads_back_at_both_sizes() {
            let mut rgba = vec![0; PIXEL_BYTES];
            for pixel in rgba.chunks_exact_mut(4).take(SIDE * 10) {
                pixel.copy_from_slice(&[200, 30, 40, 255]);
            }
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("logo.ico");
            std::fs::write(&path, ico_bytes(&rgba).unwrap()).unwrap();
            let (big, small) = load(&path).unwrap();
            drop((big, small));
            assert!(load(&dir.path().join("missing.ico")).is_err());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_local_main_app_can_change_the_icon() {
        for url in [
            "tauri://localhost/",
            "http://tauri.localhost/index.html",
            "https://tauri.localhost/",
        ] {
            let url = tauri::Url::parse(url).unwrap();
            assert!(allowed_caller("main", &url));
            assert!(!allowed_caller("agent", &url));
        }
        for url in [
            "https://example.com/",
            "http://axispage.localhost/a.html",
            "tauri://other/",
            "file:///a.html",
        ] {
            assert!(!allowed_caller("main", &tauri::Url::parse(url).unwrap()));
        }
    }

    #[test]
    fn each_logo_gets_its_own_file_and_the_current_one_is_remembered() {
        let dir = tempfile::tempdir().unwrap();
        let logo = |v: u8| vec![v; PIXEL_BYTES];
        assert_eq!(current(dir.path()), None);
        let first = save_current(dir.path(), &logo(1)).unwrap();
        let second = save_current(dir.path(), &logo(2)).unwrap();
        assert_ne!(first, second, "a new path makes Windows redraw the icon");
        assert_eq!(current(dir.path()), Some(second.clone()));
        assert!(first.is_file(), "older icons stay for pins that use them");
        assert_eq!(save_current(dir.path(), &logo(1)).unwrap(), first);
        clear_current(dir.path()).unwrap();
        assert_eq!(current(dir.path()), None);
        clear_current(dir.path()).unwrap();
        // Only the most recent icons are kept.
        for v in 3..12 {
            save_current(dir.path(), &logo(v)).unwrap();
        }
        let icons = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter(|e| is_icon_name(&e.file_name().to_string_lossy()))
            .count();
        assert_eq!(icons, KEEP_ICONS);
        // A tampered pointer never escapes the folder.
        std::fs::write(dir.path().join(CURRENT_FILE), "../secret.ico").unwrap();
        assert_eq!(current(dir.path()), None);
    }

    #[test]
    fn writes_a_bottom_up_256_pixel_icon_with_its_mask() {
        let mut rgba = vec![0; PIXEL_BYTES];
        // Top-left pixel opaque red; everything else transparent.
        rgba[..4].copy_from_slice(&[255, 0, 0, 255]);
        let ico = ico_bytes(&rgba).unwrap();
        assert_eq!(&ico[..6], &[0, 0, 1, 0, 1, 0]);
        assert_eq!(&ico[6..8], &[0, 0], "0 means 256 wide and high");
        let size = u32::from_le_bytes(ico[14..18].try_into().unwrap()) as usize;
        assert_eq!(ico.len(), 22 + size);
        assert_eq!(i32::from_le_bytes(ico[30..34].try_into().unwrap()), 512);
        // The top row is stored last among the colour rows.
        let colour = 22 + 40;
        let top_row = colour + (SIDE - 1) * SIDE * 4;
        assert_eq!(&ico[top_row..top_row + 4], &[0, 0, 255, 255]);
        assert_eq!(&ico[colour..colour + 4], &[0, 0, 0, 0]);
        // Mask: the top row's first pixel is opaque (bit clear), the rest transparent.
        let mask = colour + PIXEL_BYTES;
        let top_mask = mask + (SIDE - 1) * SIDE / 8;
        assert_eq!(ico[top_mask], 0b0111_1111);
        assert_eq!(ico[mask], 0xFF);
        assert!(ico_bytes(&rgba[1..]).is_err());
    }
}
