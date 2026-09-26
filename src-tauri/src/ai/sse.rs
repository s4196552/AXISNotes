//! Incremental Server-Sent Events parser. Bytes arrive in arbitrary chunks (possibly
//! splitting lines or UTF-8 characters); complete events come out.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Event {
    /// The `event:` field, if any.
    pub event: Option<String>,
    /// All `data:` lines joined with `\n`.
    pub data: String,
}

#[derive(Default)]
pub struct SseParser {
    buf: Vec<u8>,
    event: Option<String>,
    data: Vec<String>,
}

impl SseParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed a chunk; returns the events it completed.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<Event> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some(nl) = self.buf.iter().position(|&b| b == b'\n') {
            let mut line: Vec<u8> = self.buf.drain(..=nl).collect();
            line.pop(); // \n
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let line = String::from_utf8_lossy(&line).into_owned();
            self.line(&line, &mut out);
        }
        out
    }

    /// End of stream: dispatch a final event that wasn't followed by a blank line.
    pub fn finish(&mut self) -> Vec<Event> {
        let mut out = Vec::new();
        if !self.buf.is_empty() {
            let rest = String::from_utf8_lossy(&std::mem::take(&mut self.buf)).into_owned();
            self.line(rest.trim_end_matches('\r'), &mut out);
        }
        self.dispatch(&mut out);
        out
    }

    fn line(&mut self, line: &str, out: &mut Vec<Event>) {
        if line.is_empty() {
            self.dispatch(out);
            return;
        }
        if line.starts_with(':') {
            return; // comment / keep-alive
        }
        let (field, value) = match line.split_once(':') {
            Some((f, v)) => (f, v.strip_prefix(' ').unwrap_or(v)),
            None => (line, ""),
        };
        match field {
            "event" => self.event = Some(value.to_string()),
            "data" => self.data.push(value.to_string()),
            _ => {}
        }
    }

    fn dispatch(&mut self, out: &mut Vec<Event>) {
        if self.data.is_empty() {
            self.event = None;
            return;
        }
        out.push(Event {
            event: self.event.take(),
            data: std::mem::take(&mut self.data).join("\n"),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_events_split_across_chunks() {
        let mut p = SseParser::new();
        let mut all = p.push(b"event: a\r\ndata: {\"x\":");
        assert!(all.is_empty());
        all.extend(p.push(b"1}\r\n\r\n: ping\n\ndata: line1\ndata: line2\n\ndata: [DONE]"));
        all.extend(p.finish());
        assert_eq!(
            all,
            vec![
                Event {
                    event: Some("a".into()),
                    data: "{\"x\":1}".into()
                },
                Event {
                    event: None,
                    data: "line1\nline2".into()
                },
                Event {
                    event: None,
                    data: "[DONE]".into()
                },
            ]
        );
    }

    #[test]
    fn keeps_multibyte_characters_split_between_chunks() {
        let text = "data: héllo\n\n".as_bytes();
        let (a, b) = text.split_at(8); // splits the é
        let mut p = SseParser::new();
        let mut all = p.push(a);
        all.extend(p.push(b));
        assert_eq!(all[0].data, "héllo");
    }
}
