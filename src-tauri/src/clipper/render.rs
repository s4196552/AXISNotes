//! Turning a clip from the browser extension into a Markdown note (and a screenshot file).

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClipKind {
    /// The readable article, already converted to Markdown by the extension.
    Page,
    Selection,
    Screenshot,
    /// Just the link.
    Url,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    /// Set by the extension so a retried delivery isn't saved twice.
    #[serde(default)]
    pub id: Option<String>,
    pub kind: ClipKind,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    /// Markdown for pages and selections.
    #[serde(default)]
    pub markdown: String,
    /// Base64 PNG for screenshots (a `data:` prefix is accepted).
    #[serde(default)]
    pub image: Option<String>,
    /// When the clip was taken (ms since the epoch); defaults to now.
    #[serde(default)]
    pub created_ms: Option<u64>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, PartialEq)]
pub struct Rendered {
    pub title: String,
    pub note: String,
    pub content: String,
    /// (vault path, base64 data) of the screenshot.
    pub attachment: Option<(String, String)>,
}

/// UTC date-time from ms since the epoch: ("2026-09-27", "14:05").
pub fn utc(ms: u64) -> (String, String) {
    let secs = ms / 1000;
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (
        format!("{y:04}-{m:02}-{d:02}"),
        format!("{:02}:{:02}", rem / 3600, (rem % 3600) / 60),
    )
}

/// A file-name-safe version of a title.
pub fn safe_name(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '#' | '^' | '[' | ']' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let mut name = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    name = name.trim_matches(['.', ' ']).to_string();
    if name.chars().count() > 80 {
        name = name
            .chars()
            .take(80)
            .collect::<String>()
            .trim_end()
            .to_string();
    }
    if name.is_empty() {
        "Clipping".into()
    } else {
        name
    }
}

fn yaml_string(s: &str) -> String {
    serde_json::to_string(s).unwrap()
}

/// `folder/name.ext`, or `folder/name 2.ext`, ... if taken.
fn unique(folder: &str, name: &str, ext: &str, exists: &impl Fn(&str) -> bool) -> String {
    let mut n = 1;
    loop {
        let candidate = if n == 1 {
            format!("{folder}/{name}.{ext}")
        } else {
            format!("{folder}/{name} {n}.{ext}")
        };
        if !exists(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

pub fn render_clip(
    clip: &Clip,
    folder: &str,
    now_ms: u64,
    exists: impl Fn(&str) -> bool,
) -> Result<Rendered, String> {
    let when = clip.created_ms.unwrap_or(now_ms);
    let (date, time) = utc(when);
    let host = clip
        .url
        .split("://")
        .nth(1)
        .and_then(|r| r.split('/').next())
        .unwrap_or("")
        .trim_start_matches("www.");
    let title = match clip.title.trim() {
        "" if !host.is_empty() => host.to_string(),
        "" => "Clipping".to_string(),
        t => t.to_string(),
    };
    let name = safe_name(&title);
    let note = unique(folder, &name, "md", &exists);

    let mut tags = vec!["clipping".to_string()];
    for t in &clip.tags {
        let t = t.trim().trim_start_matches('#');
        if !t.is_empty() && !tags.iter().any(|x| x == t) {
            tags.push(t.to_string());
        }
    }
    let kind = match clip.kind {
        ClipKind::Page => "page",
        ClipKind::Selection => "selection",
        ClipKind::Screenshot => "screenshot",
        ClipKind::Url => "link",
    };
    let mut front = String::from("---\n");
    if !clip.url.is_empty() {
        front += &format!("source: {}\n", yaml_string(&clip.url));
    }
    front += &format!("clipped: {date} {time} UTC\n");
    front += &format!("clip: {kind}\n");
    front += &format!(
        "tags: [{}]\n---\n",
        tags.iter()
            .map(|t| yaml_string(t))
            .collect::<Vec<_>>()
            .join(", ")
    );

    let link = if clip.url.is_empty() {
        String::new()
    } else {
        format!(
            "[{}]({})",
            title.replace(['[', ']'], ""),
            clip.url.replace(' ', "%20")
        )
    };
    let mut attachment = None;
    let body = match clip.kind {
        ClipKind::Page => {
            if clip.markdown.trim().is_empty() {
                return Err("the page clip has no content".into());
            }
            format!("{}\n", clip.markdown.trim())
        }
        ClipKind::Selection => {
            if clip.markdown.trim().is_empty() {
                return Err("the selection is empty".into());
            }
            let quoted: Vec<String> = clip
                .markdown
                .trim()
                .lines()
                .map(|l| {
                    if l.is_empty() {
                        ">".into()
                    } else {
                        format!("> {l}")
                    }
                })
                .collect();
            format!("{}\n\n— {link}\n", quoted.join("\n"))
        }
        ClipKind::Screenshot => {
            let data = clip.image.as_deref().unwrap_or("").trim();
            let data = data.split_once("base64,").map_or(data, |(_, d)| d);
            if data.is_empty() {
                return Err("the screenshot has no image".into());
            }
            let stamp = format!("{} {}", date, time.replace(':', "."));
            let file = unique(
                &format!("{folder}/attachments"),
                &format!("{name} {stamp}"),
                "png",
                &exists,
            );
            let file_name = file.rsplit('/').next().unwrap().to_string();
            attachment = Some((file, data.to_string()));
            format!("![[{file_name}]]\n\n{link}\n")
        }
        ClipKind::Url => format!("{link}\n"),
    };
    let heading = format!("# {title}\n\n");
    let source_line = if matches!(clip.kind, ClipKind::Page) && !link.is_empty() {
        format!("Source: {link}\n\n")
    } else {
        String::new()
    };
    Ok(Rendered {
        title,
        note,
        content: format!("{front}{heading}{source_line}{body}"),
        attachment,
    })
}
