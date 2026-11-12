mod icons;

use super::{InstalledApp, Target};
use std::{
    collections::HashSet,
    ffi::{c_void, OsStr},
    mem::size_of,
    os::windows::ffi::OsStrExt,
    path::Path,
    process::Command,
};
use windows::{
    core::{w, PCWSTR},
    Win32::{
        System::Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED},
        UI::{
            Shell::{
                BHID_EnumItems, FOLDERID_AppsFolder, IEnumShellItems, IShellItem,
                SHCreateItemFromParsingName, SHCreateItemInKnownFolder, SHGetIDListFromObject,
                ShellExecuteExW, KF_FLAG_DEFAULT, SEE_MASK_FLAG_NO_UI, SEE_MASK_INVOKEIDLIST,
                SEE_MASK_NOASYNC, SHELLEXECUTEINFOW, SIGDN, SIGDN_NORMALDISPLAY,
                SIGDN_PARENTRELATIVEPARSING,
            },
            WindowsAndMessaging::SW_SHOWNORMAL,
        },
    },
};

const MAX_APPS: usize = 2048;

struct Apartment;

impl Apartment {
    fn enter() -> windows::core::Result<Self> {
        // Shell discovery and invocation use the calling thread's STA. S_FALSE also needs
        // a matching uninitialization, so preserve the balance if this is already an STA.
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.ok()?;
        Ok(Self)
    }
}

impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

struct ShellMemory(*mut c_void);

impl Drop for ShellMemory {
    fn drop(&mut self) {
        unsafe { CoTaskMemFree(Some(self.0)) };
    }
}

fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain([0]).collect()
}

fn display_name(item: &IShellItem, kind: SIGDN) -> windows::core::Result<String> {
    let result = unsafe { item.GetDisplayName(kind) }?;
    let _owned = ShellMemory(result.0.cast());
    unsafe { result.to_string() }.map_err(Into::into)
}

fn installed_items() -> windows::core::Result<IEnumShellItems> {
    // AppsFolder is the Shell's per-user installed-app inventory. It includes both
    // traditional Start entries and packaged applications.
    unsafe {
        let folder: IShellItem =
            SHCreateItemInKnownFolder(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, PCWSTR::null())?;
        folder.BindToHandler(None, &BHID_EnumItems)
    }
}

fn next_item(items: &IEnumShellItems) -> windows::core::Result<Option<IShellItem>> {
    let mut result = [None];
    let mut count = 0;
    unsafe { items.Next(&mut result, Some(&mut count)) }?;
    Ok(result[0].take())
}

fn app_id(item: &IShellItem) -> Option<String> {
    let id = display_name(item, SIGDN_PARENTRELATIVEPARSING).ok()?;
    (!id.trim().is_empty() && id.chars().count() <= 1024 && !id.chars().any(char::is_control))
        .then_some(id)
}

fn installed_item(id: &str) -> Result<IShellItem, String> {
    let items =
        installed_items().map_err(|error| format!("Could not read installed apps. {error}"))?;
    for _ in 0..MAX_APPS {
        let Some(item) =
            next_item(&items).map_err(|error| format!("Could not read installed apps. {error}"))?
        else {
            break;
        };
        // Match an enumerated child. A saved ID is never interpreted as a path, command,
        // protocol or Shell namespace expression.
        if app_id(&item).as_deref() == Some(id) {
            return Ok(item);
        }
    }
    Err("This app is no longer available in Windows Start. Pick its current entry or edit the shortcut.".into())
}

pub fn discover_apps() -> Result<Vec<InstalledApp>, String> {
    let _apartment = Apartment::enter()
        .map_err(|error| format!("Could not start Windows app discovery. {error}"))?;
    let items =
        installed_items().map_err(|error| format!("Could not read installed apps. {error}"))?;
    let mut seen = HashSet::new();
    let mut apps = Vec::new();

    for _ in 0..MAX_APPS {
        let Some(item) =
            next_item(&items).map_err(|error| format!("Could not read installed apps. {error}"))?
        else {
            break;
        };
        let (Some(id), Ok(name)) = (app_id(&item), display_name(&item, SIGDN_NORMALDISPLAY)) else {
            continue;
        };
        let name = name.trim();
        if name.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        apps.push(InstalledApp {
            name: name.into(),
            target: Target::WindowsApp { id },
            // Windows Shell icon handlers can block even when only cached icons are
            // requested. Resolve icons for the apps the user actually picks.
            icon: None,
        });
    }

    apps.sort_by_cached_key(|app| app.name.to_lowercase());
    Ok(apps)
}

pub fn target_icon(target: &Target) -> Option<String> {
    let _apartment = Apartment::enter().ok()?;
    let item = match target {
        Target::Path { path } => {
            let path = Path::new(path);
            if !icons::local_disk(path) || !path.exists() {
                return None;
            }
            let path = wide(path.as_os_str());
            unsafe { SHCreateItemFromParsingName(PCWSTR(path.as_ptr()), None).ok()? }
        }
        Target::WindowsApp { id } => installed_item(id).ok()?,
        Target::Website { .. } => return None,
    };
    let factory = icons::factory().ok()?;
    icons::shell_icon(&factory, &item).ok()
}

pub fn custom_icon(path: &Path) -> Result<String, String> {
    let _apartment =
        Apartment::enter().map_err(|error| format!("Could not start image import. {error}"))?;
    icons::custom_icon(path)
}

pub fn launch(target: &Target) -> Result<(), String> {
    let _apartment =
        Apartment::enter().map_err(|error| format!("Could not open the shortcut. {error}"))?;
    let mut info = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_FLAG_NO_UI | SEE_MASK_NOASYNC,
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };

    match target {
        Target::WindowsApp { id } => {
            let item = installed_item(id)?;
            let pidl = unsafe { SHGetIDListFromObject(&item) }
                .map_err(|error| format!("Could not resolve this installed app. {error}"))?;
            let _owned = ShellMemory(pidl.cast());
            info.fMask |= SEE_MASK_INVOKEIDLIST;
            info.lpIDList = pidl.cast();
            execute(&mut info)
        }
        Target::Path { path } => {
            let path = Path::new(path);
            if !path.exists() {
                return Err("This path is missing or unavailable. Edit the shortcut to select its current location.".into());
            }
            if path.is_file()
                && path
                    .extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
            {
                let mut command = Command::new(path);
                if let Some(directory) = path.parent() {
                    command.current_dir(directory);
                }
                return command
                    .spawn()
                    .map(|_| ())
                    .map_err(|error| format!("Windows could not open this application. {error}"));
            }
            let path = wide(path.as_os_str());
            info.lpFile = PCWSTR(path.as_ptr());
            execute(&mut info)
        }
        Target::Website { url } => {
            let url = wide(OsStr::new(url));
            info.lpVerb = w!("open");
            info.lpFile = PCWSTR(url.as_ptr());
            execute(&mut info)
        }
    }
}

fn execute(info: &mut SHELLEXECUTEINFOW) -> Result<(), String> {
    // Windows receives a file/URL or an enumerated item ID list, with no command line,
    // parameters or interpolated script.
    unsafe { ShellExecuteExW(info) }
        .map_err(|error| format!("Windows could not open this shortcut. {error}"))
}
