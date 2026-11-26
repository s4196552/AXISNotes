//! Clipboard text for the note's Paste and "Paste as plain text" menu items (T-288).
//!
//! The page's own `navigator.clipboard.readText()` needs WebView2's clipboard-read
//! permission, which the app's windows don't have (Tauri grants it only to windows built
//! with `enable_clipboard_access`), so WebView2 asks the user first. Paste chosen from the
//! menu is the user asking already, so the text is read here instead. Only the app's own
//! pages may ask; on other systems the page falls back to the browser API.

use crate::error::{AppError, AppResult};

/// Whether `url` is one of the app's own pages (any of its windows), not web content.
fn app_page(url: &tauri::Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
        || (cfg!(debug_assertions) && url.origin().ascii_serialization() == "http://localhost:1420")
}

/// The text on the clipboard ("" when it holds none, such as only an image).
#[tauri::command]
pub async fn read_clipboard_text(webview: tauri::Webview) -> AppResult<String> {
    let url = webview.url().map_err(|e| AppError::Io(e.to_string()))?;
    if !app_page(&url) {
        return Err(AppError::Blocked(
            "Only AXISNotes's own pages can read the clipboard.".into(),
        ));
    }
    native::read_text()
}

#[cfg(windows)]
mod native {
    use crate::error::{AppError, AppResult};
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    use windows::Win32::System::Ole::CF_UNICODETEXT;

    /// Closes the clipboard when dropped.
    struct Opened;
    impl Drop for Opened {
        fn drop(&mut self) {
            // SAFETY: only made after OpenClipboard succeeded on this thread.
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }

    pub fn read_text() -> AppResult<String> {
        let format = u32::from(CF_UNICODETEXT.0);
        // Another program may hold the clipboard for a moment: try a few times.
        let mut tries = 0;
        // SAFETY: plain Win32 calls; the clipboard is closed again by `Opened`.
        let _open = loop {
            if unsafe { OpenClipboard(None) }.is_ok() {
                break Opened;
            }
            tries += 1;
            if tries == 10 {
                return Err(AppError::Io("The clipboard is busy. Try again.".into()));
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        };
        if unsafe { IsClipboardFormatAvailable(format) }.is_err() {
            return Ok(String::new());
        }
        let handle = unsafe { GetClipboardData(format) }
            .map_err(|e| AppError::Io(format!("Couldn't read the clipboard: {e}")))?;
        let global = HGLOBAL(handle.0);
        // SAFETY: CF_UNICODETEXT data is a NUL-terminated UTF-16 string the clipboard owns;
        // it is read while locked and the clipboard is open, and copied before unlocking.
        unsafe {
            let ptr = GlobalLock(global) as *const u16;
            if ptr.is_null() {
                return Err(AppError::Io("Couldn't read the clipboard.".into()));
            }
            let mut len = 0;
            while *ptr.add(len) != 0 {
                len += 1;
            }
            let text = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
            let _ = GlobalUnlock(global);
            Ok(text)
        }
    }
}

#[cfg(not(windows))]
mod native {
    use crate::error::{AppError, AppResult};

    pub fn read_text() -> AppResult<String> {
        Err(AppError::Io("not available on this system".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::app_page;

    #[test]
    fn only_app_pages_may_read_the_clipboard() {
        let ok = |u: &str| app_page(&tauri::Url::parse(u).unwrap());
        assert!(ok("http://tauri.localhost/"));
        assert!(ok("https://tauri.localhost/index.html?note=1"));
        assert!(ok("tauri://localhost/"));
        assert!(!ok("https://example.com/"));
        assert!(!ok("https://tauri.localhost.example.com/"));
        assert!(!ok("http://localhost:9999/"));
    }
}
