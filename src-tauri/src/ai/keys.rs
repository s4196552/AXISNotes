//! API keys in the OS keychain (Windows Credential Manager, macOS Keychain, Linux Secret
//! Service). Keys are write-only from the UI's point of view: commands can set, delete
//! or ask whether a key exists, but no command ever returns one.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::error::{AppError, AppResult};

const SERVICE: &str = "AXISNotes";
/// The keychain service used before the app was renamed AXISNotes. Keys found there are
/// moved to `SERVICE` the first time they're read.
const LEGACY_SERVICE: &str = "AXIS";

pub trait KeyStore: Send + Sync {
    fn get(&self, provider_id: &str) -> AppResult<Option<String>>;
    fn set(&self, provider_id: &str, key: &str) -> AppResult<()>;
    fn delete(&self, provider_id: &str) -> AppResult<()>;
}

pub struct Keychain;

fn entry_in(service: &str, provider_id: &str) -> AppResult<keyring::Entry> {
    keyring::Entry::new(service, &format!("ai-provider:{provider_id}"))
        .map_err(|e| AppError::Io(format!("keychain: {e}")))
}

fn entry(provider_id: &str) -> AppResult<keyring::Entry> {
    entry_in(SERVICE, provider_id)
}

/// A key saved under the old service name: move it to the new one and return it.
fn migrate_legacy(provider_id: &str) -> AppResult<Option<String>> {
    let old = entry_in(LEGACY_SERVICE, provider_id)?;
    match old.get_password() {
        Ok(k) => {
            entry(provider_id)?
                .set_password(&k)
                .map_err(|e| AppError::Io(format!("keychain: {e}")))?;
            let _ = old.delete_credential();
            Ok(Some(k))
        }
        Err(_) => Ok(None),
    }
}

impl KeyStore for Keychain {
    fn get(&self, provider_id: &str) -> AppResult<Option<String>> {
        match entry(provider_id)?.get_password() {
            Ok(k) => Ok(Some(k)),
            Err(keyring::Error::NoEntry) => migrate_legacy(provider_id),
            Err(e) => Err(AppError::Io(format!("keychain: {e}"))),
        }
    }

    fn set(&self, provider_id: &str, key: &str) -> AppResult<()> {
        entry(provider_id)?
            .set_password(key.trim())
            .map_err(|e| AppError::Io(format!("keychain: {e}")))
    }

    fn delete(&self, provider_id: &str) -> AppResult<()> {
        let _ = entry_in(LEGACY_SERVICE, provider_id)?.delete_credential();
        match entry(provider_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Io(format!("keychain: {e}"))),
        }
    }
}

/// In-memory store for tests.
#[derive(Default)]
pub struct MemoryKeys(Mutex<HashMap<String, String>>);

impl KeyStore for MemoryKeys {
    fn get(&self, provider_id: &str) -> AppResult<Option<String>> {
        Ok(self.0.lock().unwrap().get(provider_id).cloned())
    }

    fn set(&self, provider_id: &str, key: &str) -> AppResult<()> {
        self.0
            .lock()
            .unwrap()
            .insert(provider_id.to_string(), key.trim().to_string());
        Ok(())
    }

    fn delete(&self, provider_id: &str) -> AppResult<()> {
        self.0.lock().unwrap().remove(provider_id);
        Ok(())
    }
}
