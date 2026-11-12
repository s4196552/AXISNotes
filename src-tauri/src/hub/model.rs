use std::collections::HashSet;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use tauri::Url;

const VERSION: u32 = 1;
const MAX_PLUGINS: usize = 32;
const MAX_GROUPS: usize = 128;
const MAX_GROUP_DEPTH: usize = 6;
const MAX_SHORTCUTS: usize = 1024;
const MAX_ICON_BYTES: usize = 512 * 1024;
const MAX_ICON_TOTAL: usize = 12 * 1024 * 1024;
const COLORS: [&str; 6] = ["slate", "mint", "blue", "amber", "violet", "rose"];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Library {
    pub version: u32,
    pub plugins: Vec<Plugin>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plugin {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub enabled: bool,
    pub groups: Vec<Group>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub color: String,
    pub groups: Vec<Group>,
    pub shortcuts: Vec<Shortcut>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Shortcut {
    pub id: String,
    pub name: String,
    pub target: Target,
    pub icon: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Target {
    Path { path: String },
    WindowsApp { id: String },
    Website { url: String },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginPackage {
    pub version: u32,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub groups: Vec<Group>,
}

impl Default for Library {
    fn default() -> Self {
        Self {
            version: VERSION,
            plugins: vec![Plugin {
                id: "launcher".into(),
                name: "Launcher".into(),
                description: "Your personal shortcut groups.".into(),
                enabled: true,
                groups: vec![Group {
                    id: "favorites".into(),
                    name: "Favorites".into(),
                    color: "mint".into(),
                    groups: Vec::new(),
                    shortcuts: Vec::new(),
                }],
            }],
        }
    }
}

impl Library {
    pub fn validate(&self) -> Result<(), String> {
        check_version(self.version)?;
        if self.plugins.len() > MAX_PLUGINS {
            return Err(format!(
                "The library can contain up to {MAX_PLUGINS} plugins."
            ));
        }
        if !self
            .plugins
            .iter()
            .any(|plugin| plugin.id == "launcher" && plugin.enabled)
        {
            return Err("The built-in Launcher plugin must stay enabled.".into());
        }
        let mut validation = Validation::default();
        for plugin in &self.plugins {
            validation.id(&plugin.id)?;
            validate_name(&plugin.name)?;
            validate_description(&plugin.description)?;
            validation.groups(&plugin.groups, 1)?;
        }
        Ok(())
    }

    pub fn target(&self, id: &str) -> Option<&Target> {
        self.plugins
            .iter()
            .filter(|plugin| plugin.enabled)
            .flat_map(|plugin| &plugin.groups)
            .find_map(|group| group.target(id))
    }
}

impl Group {
    fn target(&self, id: &str) -> Option<&Target> {
        self.shortcuts
            .iter()
            .find(|shortcut| shortcut.id == id)
            .map(|shortcut| &shortcut.target)
            .or_else(|| self.groups.iter().find_map(|group| group.target(id)))
    }
}

impl PluginPackage {
    pub fn validate(&self) -> Result<(), String> {
        check_version(self.version)?;
        validate_name(&self.name)?;
        validate_description(&self.description)?;
        Validation::default().groups(&self.groups, 1)
    }
}

impl Target {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Path { path } if !valid_path(path) => {
                Err("Enter a full Windows file or folder path, such as C:\\Documents.".into())
            }
            // The platform adapter resolves this opaque key against Windows' AppsFolder.
            Self::WindowsApp { id }
                if id.trim().is_empty()
                    || id.chars().count() > 1024
                    || id.chars().any(char::is_control) =>
            {
                Err("The Windows application identifier is invalid.".into())
            }
            Self::Website { url } if !valid_website(url) => Err(
                "Enter a full HTTP or HTTPS website address without embedded credentials.".into(),
            ),
            _ => Ok(()),
        }
    }
}

fn check_version(version: u32) -> Result<(), String> {
    if version == VERSION {
        Ok(())
    } else {
        Err(format!(
            "AXIS Hub cannot read launcher data version {version}."
        ))
    }
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.chars().count() > 100 || name.chars().any(char::is_control) {
        Err("Names must contain 1 to 100 characters and no control characters.".into())
    } else {
        Ok(())
    }
}

fn validate_description(description: &str) -> Result<(), String> {
    if description.chars().count() > 500
        || description
            .chars()
            .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
    {
        Err("Plugin descriptions must contain at most 500 characters.".into())
    } else {
        Ok(())
    }
}

#[derive(Default)]
struct Validation<'a> {
    ids: HashSet<&'a str>,
    groups: usize,
    shortcuts: usize,
    icon_total: usize,
}

impl<'a> Validation<'a> {
    fn id(&mut self, id: &'a str) -> Result<(), String> {
        if id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, b'-' | b'_'))
        {
            return Err("An entry has an invalid ID.".into());
        }
        if !self.ids.insert(id) {
            return Err("Launcher data contains duplicate IDs.".into());
        }
        Ok(())
    }

    fn groups(&mut self, groups: &'a [Group], depth: usize) -> Result<(), String> {
        self.groups += groups.len();
        if self.groups > MAX_GROUPS {
            return Err(format!(
                "The library can contain up to {MAX_GROUPS} groups."
            ));
        }
        if !groups.is_empty() && depth > MAX_GROUP_DEPTH {
            return Err(format!(
                "Groups can be nested up to {MAX_GROUP_DEPTH} levels."
            ));
        }
        for group in groups {
            self.id(&group.id)?;
            validate_name(&group.name)?;
            if !COLORS.contains(&group.color.as_str()) {
                return Err("A group has an unknown color.".into());
            }
            self.shortcuts += group.shortcuts.len();
            if self.shortcuts > MAX_SHORTCUTS {
                return Err(format!(
                    "The library can contain up to {MAX_SHORTCUTS} shortcuts."
                ));
            }
            for shortcut in &group.shortcuts {
                self.id(&shortcut.id)?;
                validate_name(&shortcut.name)?;
                shortcut.target.validate()?;
                if let Some(icon) = &shortcut.icon {
                    self.icon_total += icon.len();
                    if self.icon_total > MAX_ICON_TOTAL {
                        return Err("The library has reached its total icon size limit.".into());
                    }
                    validate_icon(icon)?;
                }
            }
            self.groups(&group.groups, depth + 1)?;
        }
        Ok(())
    }
}

fn valid_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    if !matches!(bytes, [drive, b':', b'\\' | b'/', ..] if drive.is_ascii_alphabetic())
        || path.encode_utf16().count() > 4096
    {
        return false;
    }

    let tail = &path[3..];
    if tail.is_empty() {
        return true;
    }
    let tail = tail.strip_suffix(['\\', '/']).unwrap_or(tail);
    tail.split(['\\', '/']).all(valid_component)
}

fn valid_component(component: &str) -> bool {
    if component.is_empty()
        || component.starts_with(' ')
        || component.ends_with([' ', '.'])
        || component.encode_utf16().count() > 255
        || component
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
    {
        return false;
    }

    let device = component
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end_matches(' ')
        .to_ascii_uppercase();
    if matches!(
        device.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$" | "CONIN$" | "CONOUT$"
    ) {
        return false;
    }
    let port = device
        .strip_prefix("COM")
        .or_else(|| device.strip_prefix("LPT"));
    !matches!(
        port,
        Some("1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³")
    )
}

fn valid_website(url: &str) -> bool {
    if url.len() > 4096
        || url
            .chars()
            .any(|ch| ch.is_whitespace() || ch.is_control() || ch == '\\')
    {
        return false;
    }
    let Some((_, rest)) = url.split_once("://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return false;
    }
    Url::parse(url)
        .is_ok_and(|url| matches!(url.scheme(), "http" | "https") && url.host().is_some())
}

fn validate_icon(icon: &str) -> Result<(), String> {
    let invalid =
        || "Icons must be embedded PNG images up to 512 × 512 pixels and 512 KiB.".to_owned();
    let encoded = icon
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(invalid)?;
    if encoded.len() > MAX_ICON_BYTES.div_ceil(3) * 4 {
        return Err(invalid());
    }
    let data = STANDARD.decode(encoded).map_err(|_| invalid())?;
    if data.len() > MAX_ICON_BYTES
        || data.len() < 45
        || !data.starts_with(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR")
        || !data.ends_with(b"\0\0\0\0IEND\xae\x42\x60\x82")
    {
        return Err(invalid());
    }
    let width = u32::from_be_bytes(data[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(data[20..24].try_into().unwrap());
    if !(1..=512).contains(&width) || !(1..=512).contains(&height) {
        return Err(invalid());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn website() -> Target {
        Target::Website {
            url: "https://example.com/".into(),
        }
    }

    #[test]
    fn validates_windows_paths_without_discarding_real_filename_characters() {
        for path in [
            r"C:\",
            "d:/",
            r"C:\Users\Someone's #1 Project (50%)\日本語.pdf",
            r"C:\ProgramData\Tools\Launch.lnk",
        ] {
            assert!(valid_path(path), "{path}");
        }
        for path in [
            r"\\server\share\file.txt",
            r"\\?\C:\Windows",
            r"\\.\COM1",
            r"C:relative.exe",
            r"C:\Temp\..\file.txt",
            r"C:\Temp\file.txt:alternate",
            r"C:\Temp\NUL.txt",
            r"C:\Temp\COM².jpg",
            r"C:\Temp\ NUL.txt",
            r"C:\Temp\bad. ",
            r"C:\Temp\\file",
            r"C:\\",
            r"shell:AppsFolder",
            "C:\\Temp\\evil\nfile",
        ] {
            assert!(!valid_path(path), "{path}");
        }
    }

    #[test]
    fn checks_website_authority_and_scheme() {
        for url in [
            "https://example.com/a%20b?q=one#two",
            "HTTP://localhost:8080/",
        ] {
            assert!(valid_website(url), "{url}");
        }
        for url in [
            "javascript:alert(1)",
            "file:///C:/windows",
            "https:example.com",
            "https:///example.com",
            "https://user@example.com",
            "https://@example.com",
            "https://exa mple.com",
            "https://\nexample.com",
            r"https://example.com\foo",
        ] {
            assert!(!valid_website(url), "{url}");
        }
    }

    #[test]
    fn validates_opaque_windows_ids_and_rejects_unknown_target_fields() {
        for id in [
            r"C:\Program Files\Riot Client\RiotClientServices.exe",
            "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
            "308046B0AF4A39CB;PrivateBrowsingAUMID",
        ] {
            assert!(Target::WindowsApp { id: id.into() }.validate().is_ok());
        }
        assert!(Target::WindowsApp {
            id: "app\0id".into()
        }
        .validate()
        .is_err());
        assert!(serde_json::from_str::<Target>(
            r#"{"kind":"website","url":"https://example.com","command":"test"}"#
        )
        .is_err());
    }

    #[test]
    fn finds_nested_shortcuts_only_in_enabled_plugins() {
        let mut library = Library::default();
        library.plugins.push(Plugin {
            id: "work".into(),
            name: "Work".into(),
            description: String::new(),
            enabled: true,
            groups: vec![Group {
                id: "projects".into(),
                name: "Projects".into(),
                color: "blue".into(),
                shortcuts: vec![],
                groups: vec![Group {
                    id: "nested".into(),
                    name: "Nested".into(),
                    color: "mint".into(),
                    groups: vec![],
                    shortcuts: vec![Shortcut {
                        id: "link".into(),
                        name: "Website".into(),
                        target: website(),
                        icon: None,
                    }],
                }],
            }],
        });
        assert!(library.validate().is_ok());
        assert!(library.target("link").is_some());
        assert!(library.target("missing").is_none());
        library.plugins[1].enabled = false;
        assert!(library.validate().is_ok());
        assert!(library.target("link").is_none());
        library.plugins[0].enabled = false;
        assert!(library.validate().is_err());
    }

    #[test]
    fn rejects_duplicate_ids_and_oversized_group_trees() {
        let mut library = Library::default();
        let plugin = &mut library.plugins[0];
        plugin.groups.push(plugin.groups[0].clone());
        assert!(library.validate().is_err());

        let mut library = Library::default();
        let mut parent = &mut library.plugins[0].groups[0];
        for level in 0..MAX_GROUP_DEPTH {
            parent.groups.push(Group {
                id: format!("nested-{level}"),
                name: "Nested".into(),
                color: "slate".into(),
                groups: vec![],
                shortcuts: vec![],
            });
            parent = &mut parent.groups[0];
        }
        assert!(library.validate().is_err());
    }

    #[test]
    fn validates_plugin_packages_as_data_only() {
        let source = r#"{"version":1,"name":"My plugin","groups":[]}"#;
        let mut plugin = serde_json::from_str::<PluginPackage>(source).unwrap();
        assert!(plugin.validate().is_ok());
        assert!(plugin.description.is_empty());
        plugin.version = 2;
        assert!(plugin.validate().is_err());
        assert!(serde_json::from_str::<PluginPackage>(
            r#"{"version":1,"name":"My plugin","groups":[],"script":"launch()"}"#
        )
        .is_err());
    }

    #[test]
    fn rejects_external_and_oversized_icon_data() {
        let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=";
        assert!(validate_icon(&format!("data:image/png;base64,{png}")).is_ok());
        assert!(validate_icon("https://example.com/image.png").is_err());
        assert!(validate_icon("data:image/svg+xml;base64,PHN2Zz4=").is_err());
        let mut large = STANDARD.decode(png).unwrap();
        large[16..20].copy_from_slice(&513u32.to_be_bytes());
        assert!(
            validate_icon(&format!("data:image/png;base64,{}", STANDARD.encode(large))).is_err()
        );
    }
}
