use serde::{Serialize, Serializer};

/// Errors returned to the frontend as `{ code, message }` (see `src/ipc/types.ts`).
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("no vault is open")]
    NoVault,
    #[error("not found: {0}")]
    NotFound(String),
    #[error("already exists: {0}")]
    AlreadyExists(String),
    #[error("file changed on disk since it was loaded: {0}")]
    Conflict(String),
    #[error("path is outside the vault: {0}")]
    OutsideVault(String),
    #[error("invalid name: {0}")]
    InvalidName(String),
    #[error("{0}")]
    Io(String),
    /// An AI request refused by the vault's AI privacy rules or cost limits.
    #[error("{0}")]
    Blocked(String),
    /// An AI provider failed (after retries and fallbacks).
    #[error("{0}")]
    Ai(String),
    #[error("cancelled")]
    Cancelled,
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::NoVault => "NoVault",
            AppError::NotFound(_) => "NotFound",
            AppError::AlreadyExists(_) => "AlreadyExists",
            AppError::Conflict(_) => "Conflict",
            AppError::OutsideVault(_) => "OutsideVault",
            AppError::InvalidName(_) => "InvalidName",
            AppError::Io(_) => "Io",
            AppError::Blocked(_) => "Blocked",
            AppError::Ai(_) => "Ai",
            AppError::Cancelled => "Cancelled",
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("code", self.code())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
