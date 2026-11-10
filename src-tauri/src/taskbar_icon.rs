//! Tauri's setIcon updates ICON_SMALL on Windows; the taskbar needs ICON_BIG too.

use crate::error::{AppError, AppResult};

const SIDE: usize = 256;
const PIXEL_BYTES: usize = SIDE * SIDE * 4;

#[derive(Default)]
pub struct TaskbarIconState {
    #[cfg(windows)]
    current: std::sync::Arc<std::sync::Mutex<Option<native::Icon>>>,
}

fn allowed_caller(label: &str, url: &tauri::Url) -> bool {
    label == "main"
        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (matches!(url.scheme(), "http" | "https")
                && url.host_str() == Some("tauri.localhost"))
            || (cfg!(debug_assertions)
                && url.origin().ascii_serialization() == "http://localhost:1420"))
}

#[tauri::command]
pub fn set_taskbar_icon(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, TaskbarIconState>,
    rgba: Vec<u8>,
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
        let icon = native::create(&rgba)?;
        let hwnd = window.hwnd().map_err(|e| AppError::Io(e.to_string()))?.0 as usize;
        let current = state.current.clone();
        // Serialize replacements with window messages. The old HICON stays alive until
        // Windows has accepted the new one; never destroy Tauri's separately owned small icon.
        window
            .run_on_main_thread(move || native::install(hwnd, icon, &current))
            .map_err(|e| AppError::Io(e.to_string()))?;
    }
    #[cfg(not(windows))]
    let _ = state;
    Ok(())
}

#[cfg(windows)]
mod native {
    use super::*;
    use std::ffi::c_void;
    use std::sync::Mutex;

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
            // SAFETY: exclusively owns a successful CreateIcon result, never a shared/class icon.
            unsafe {
                DestroyIcon(self.0 as *mut c_void);
            }
        }
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

    pub(super) fn install(hwnd: usize, icon: Icon, current: &Mutex<Option<Icon>>) {
        // SAFETY: HWND was obtained from the calling main window and this runs on its UI
        // thread. WM_SETICON (0x80), ICON_BIG (1) borrows our live, independently owned icon.
        unsafe {
            SendMessageW(hwnd as *mut c_void, 0x80, 1, icon.0 as isize);
        }
        *current.lock().unwrap_or_else(|e| e.into_inner()) = Some(icon);
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
}
