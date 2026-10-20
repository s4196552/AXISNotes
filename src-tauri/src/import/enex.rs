//! Evernote `.enex` notebooks: each `<note>` becomes a Markdown note with its tags and
//! dates as frontmatter; its attachments (`<resource>`, matched to `<en-media>` by the MD5
//! of their bytes) go to an `Attachments` folder beside it.

use base64::Engine;

use super::html::{self, Node, Token};

#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct Resource {
    pub data: Vec<u8>,
    pub mime: String,
    pub file_name: Option<String>,
    /// Lowercase hex MD5 of `data` (what `<en-media hash>` refers to).
    pub hash: String,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct Note {
    pub title: String,
    /// ENML (XHTML) content.
    pub content: String,
    pub created: Option<String>,
    pub updated: Option<String>,
    pub tags: Vec<String>,
    pub source_url: Option<String>,
    pub author: Option<String>,
    pub resources: Vec<Resource>,
    /// Resources whose data couldn't be decoded.
    pub bad_resources: usize,
}

/// How many notes and resources an `.enex` holds (for the preview).
pub(crate) fn count(text: &str) -> (usize, usize) {
    (
        text.matches("<note>").count(),
        text.matches("<resource>").count(),
    )
}

/// The notes in an `.enex` file, one at a time.
pub(crate) fn notes(text: &str) -> impl Iterator<Item = Note> + '_ {
    let mut rest = text;
    std::iter::from_fn(move || {
        let start = rest.find("<note>")?;
        let after = &rest[start..];
        // Note content is CDATA whose own `<` are escaped, so `</note>` only ends a note.
        let end = after.find("</note>").map_or(after.len(), |e| e + 7);
        let chunk = &after[..end];
        rest = &after[end..];
        Some(parse_note(chunk))
    })
}

/// `20261020T093000Z` -> `2026-10-20T09:30:00Z`.
pub(crate) fn iso_date(s: &str) -> String {
    let b = s.as_bytes();
    if b.len() == 16 && b[8] == b'T' && b[15] == b'Z' && s.is_char_boundary(16) {
        format!(
            "{}-{}-{}T{}:{}:{}Z",
            &s[0..4],
            &s[4..6],
            &s[6..8],
            &s[9..11],
            &s[11..13],
            &s[13..15]
        )
    } else {
        s.to_string()
    }
}

fn parse_note(chunk: &str) -> Note {
    let mut note = Note::default();
    let mut stack: Vec<String> = Vec::new();
    let mut resource: Option<Resource> = None;
    let mut data = String::new();
    for token in html::tokenize(chunk) {
        match token {
            Token::Open { name, closed, .. } => {
                if name == "resource" && !closed {
                    resource = Some(Resource::default());
                    data.clear();
                }
                if !closed {
                    stack.push(name);
                }
            }
            Token::Close(name) => {
                if let Some(pos) = stack.iter().rposition(|n| *n == name) {
                    stack.truncate(pos);
                }
                if name == "resource" {
                    if let Some(mut r) = resource.take() {
                        let clean: String = data.chars().filter(|c| !c.is_whitespace()).collect();
                        match base64::engine::general_purpose::STANDARD.decode(clean) {
                            Ok(bytes) => {
                                r.hash = md5_hex(&bytes);
                                r.data = bytes;
                                note.resources.push(r);
                            }
                            Err(_) => note.bad_resources += 1,
                        }
                    }
                }
            }
            Token::Text(t) => {
                let top = stack.last().map(String::as_str).unwrap_or("");
                let in_resource = stack.iter().any(|n| n == "resource");
                match (top, in_resource) {
                    ("data", true) => data.push_str(&t),
                    ("mime", true) => {
                        if let Some(r) = &mut resource {
                            r.mime = t.trim().to_string();
                        }
                    }
                    ("file-name", true) => {
                        if let Some(r) = &mut resource {
                            r.file_name = Some(t.trim().to_string()).filter(|s| !s.is_empty());
                        }
                    }
                    (_, true) => {}
                    ("title", _) => note.title.push_str(&t),
                    ("content", _) => note.content.push_str(&t),
                    ("created", _) => note.created = Some(iso_date(t.trim())),
                    ("updated", _) => note.updated = Some(iso_date(t.trim())),
                    ("tag", _) => {
                        let tag = t.trim();
                        if !tag.is_empty() {
                            note.tags.push(tag.to_string());
                        }
                    }
                    ("source-url", _) => note.source_url = Some(t.trim().to_string()),
                    ("author", _) => note.author = Some(t.trim().to_string()),
                    _ => {}
                }
            }
        }
    }
    note.title = note.title.trim().to_string();
    note
}

/// Markdown for a note's ENML, `media(hash)` giving the Markdown for an attachment.
pub(crate) fn to_markdown(content: &str, media: &dyn Fn(&str) -> Option<String>) -> String {
    let embed = |n: &Node| {
        let Node::Elem { attrs, .. } = n else {
            return None;
        };
        let hash = attrs.iter().find(|(k, _)| k == "hash")?.1.to_lowercase();
        media(&hash)
    };
    html::Converter { media: &embed }.convert(content)
}

/// Extension for a MIME type, for attachments without a file name.
pub(crate) fn ext_for_mime(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "application/pdf" => "pdf",
        "audio/mpeg" => "mp3",
        "audio/wav" | "audio/x-wav" => "wav",
        "video/mp4" => "mp4",
        "text/plain" => "txt",
        _ => "bin",
    }
}

/// MD5 (RFC 1321) as lowercase hex. Only used to match Evernote's resource hashes.
pub(crate) fn md5_hex(input: &[u8]) -> String {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5,
        9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10,
        15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    let k: Vec<u32> = (0..64)
        .map(|i| ((i as f64 + 1.0).sin().abs() * 4_294_967_296.0) as u32)
        .collect();
    let (mut a0, mut b0, mut c0, mut d0) = (
        0x6745_2301u32,
        0xefcd_ab89u32,
        0x98ba_dcfeu32,
        0x1032_5476u32,
    );
    let mut msg = input.to_vec();
    let bit_len = (input.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_le_bytes());
    for chunk in msg.chunks(64) {
        let m: Vec<u32> = chunk
            .chunks(4)
            .map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]]))
            .collect();
        let (mut a, mut b, mut c, mut d) = (a0, b0, c0, d0);
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | (!b & d), i),
                1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let f = f.wrapping_add(a).wrapping_add(k[i]).wrapping_add(m[g]);
            a = d;
            d = c;
            c = b;
            b = b.wrapping_add(f.rotate_left(S[i]));
        }
        a0 = a0.wrapping_add(a);
        b0 = b0.wrapping_add(b);
        c0 = c0.wrapping_add(c);
        d0 = d0.wrapping_add(d);
    }
    [a0, b0, c0, d0]
        .iter()
        .flat_map(|w| w.to_le_bytes())
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn md5_matches_rfc_1321() {
        assert_eq!(md5_hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(
            md5_hex(
                b"12345678901234567890123456789012345678901234567890123456789012345678901234567890"
            ),
            "57edf4a22be3c955ac49da2e2107b67a"
        );
    }

    #[test]
    fn reads_notes_and_resources() {
        let png = b"\x89PNG fake";
        let b64 = base64::engine::general_purpose::STANDARD.encode(png);
        let hash = md5_hex(png);
        let enex = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export application="Evernote">
<note><title>Trip &amp; Plans</title><content><![CDATA[<?xml version="1.0"?><!DOCTYPE en-note SYSTEM "x"><en-note><div>Hello <b>you</b></div><en-media hash="{hash}" type="image/png"/></en-note>]]></content>
<created>20261020T093000Z</created><updated>20261021T100000Z</updated><tag>travel</tag><tag>2026</tag>
<note-attributes><source-url>https://example.com</source-url><author>Sam</author></note-attributes>
<resource><data encoding="base64">
{b64}
</data><mime>image/png</mime><resource-attributes><file-name>map.png</file-name></resource-attributes></resource>
</note>
<note><title>Second</title><content><![CDATA[<en-note>Two</en-note>]]></content></note>
</en-export>"#
        );
        assert_eq!(count(&enex), (2, 1));
        let notes: Vec<Note> = notes(&enex).collect();
        assert_eq!(notes.len(), 2);
        let n = &notes[0];
        assert_eq!(n.title, "Trip & Plans");
        assert_eq!(n.created.as_deref(), Some("2026-10-20T09:30:00Z"));
        assert_eq!(n.tags, ["travel", "2026"]);
        assert_eq!(n.source_url.as_deref(), Some("https://example.com"));
        assert_eq!(n.author.as_deref(), Some("Sam"));
        assert_eq!(n.resources.len(), 1);
        assert_eq!(n.resources[0].data, png);
        assert_eq!(n.resources[0].file_name.as_deref(), Some("map.png"));
        let md = to_markdown(&n.content, &|h| {
            (h == hash).then(|| "![](Attachments/map.png)".into())
        });
        assert_eq!(md, "Hello **you**\n![](Attachments/map.png)\n");
        assert_eq!(to_markdown(&notes[1].content, &|_| None), "Two\n");
    }
}
