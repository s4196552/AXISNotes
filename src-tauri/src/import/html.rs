//! A forgiving HTML/XML reader and an HTML-to-Markdown converter, for Evernote notes (ENML,
//! which is XHTML) and HTML exports. It handles what note apps write: paragraphs, `div`
//! lines, headings, emphasis, links, images, lists, to-dos, quotes, code and tables.

/// Elements with no content or end tag.
const VOID: &[&str] = &[
    "br", "hr", "img", "input", "meta", "link", "area", "base", "col", "embed", "param", "source",
    "track", "wbr", "en-media", "en-todo", "en-crypt",
];
/// Elements whose content is skipped.
const SKIP: &[&str] = &[
    "head", "script", "style", "title", "noscript", "template", "en-crypt",
];
const BLOCK: &[&str] = &[
    "address",
    "article",
    "aside",
    "blockquote",
    "body",
    "center",
    "dd",
    "div",
    "dl",
    "dt",
    "en-note",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "html",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "ul",
];

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Token {
    Open {
        name: String,
        attrs: Vec<(String, String)>,
        closed: bool,
    },
    Close(String),
    Text(String),
}

fn entity(name: &str) -> Option<char> {
    if let Some(num) = name.strip_prefix('#') {
        let code = match num.strip_prefix(['x', 'X']) {
            Some(hex) => u32::from_str_radix(hex, 16).ok()?,
            None => num.parse().ok()?,
        };
        return char::from_u32(code);
    }
    Some(match name {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => '\u{a0}',
        "ndash" => '–',
        "mdash" => '—',
        "hellip" => '…',
        "lsquo" => '‘',
        "rsquo" => '’',
        "ldquo" => '“',
        "rdquo" => '”',
        "bull" => '•',
        "middot" => '·',
        "copy" => '©',
        "reg" => '®',
        "trade" => '™',
        "deg" => '°',
        "times" => '×',
        "divide" => '÷',
        "euro" => '€',
        "pound" => '£',
        "yen" => '¥',
        "cent" => '¢',
        "sect" => '§',
        "para" => '¶',
        "laquo" => '«',
        "raquo" => '»',
        "larr" => '←',
        "rarr" => '→',
        "uarr" => '↑',
        "darr" => '↓',
        "check" => '✓',
        _ => return None,
    })
}

/// Replace `&amp;`, `&#39;` and similar; unknown ones stay as written.
pub(crate) fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let decoded = rest[1..]
            .find(';')
            .filter(|&j| j > 0 && j <= 10)
            .and_then(|j| entity(&rest[1..=j]).map(|c| (c, j)));
        match decoded {
            Some((c, j)) => {
                out.push(c);
                rest = &rest[j + 2..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn find_ci(hay: &str, needle: &str) -> Option<usize> {
    hay.as_bytes()
        .windows(needle.len())
        .position(|w| w.eq_ignore_ascii_case(needle.as_bytes()))
}

/// Tokens of an HTML or XML document. Comments, doctypes and processing instructions are
/// dropped; CDATA becomes text as it is; `script`/`style` content is dropped.
pub(crate) fn tokenize(s: &str) -> Vec<Token> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    let mut text_start = 0;
    let flush = |out: &mut Vec<Token>, from: usize, to: usize| {
        if to > from {
            out.push(Token::Text(decode_entities(&s[from..to])));
        }
    };
    while i < b.len() {
        if b[i] != b'<' {
            i += 1;
            continue;
        }
        let rest = &s[i..];
        if rest.starts_with("<!--") {
            flush(&mut out, text_start, i);
            i += rest.find("-->").map_or(rest.len(), |j| j + 3);
            text_start = i;
        } else if rest.starts_with("<![CDATA[") {
            flush(&mut out, text_start, i);
            let end = rest.find("]]>").unwrap_or(rest.len());
            out.push(Token::Text(rest[9..end.max(9)].to_string()));
            i += (end + 3).min(rest.len());
            text_start = i;
        } else if rest.starts_with("<!") || rest.starts_with("<?") {
            flush(&mut out, text_start, i);
            i += rest.find('>').map_or(rest.len(), |j| j + 1);
            text_start = i;
        } else if rest.starts_with("</") {
            flush(&mut out, text_start, i);
            let end = rest.find('>').unwrap_or(rest.len());
            let name = rest[2..end].trim().to_ascii_lowercase();
            out.push(Token::Close(name));
            i += (end + 1).min(rest.len());
            text_start = i;
        } else if rest.len() > 1 && b[i + 1].is_ascii_alphabetic() {
            flush(&mut out, text_start, i);
            let (token, len) = open_tag(rest);
            i += len;
            text_start = i;
            if let Token::Open { name, closed, .. } = &token {
                if !closed && (name == "script" || name == "style") {
                    let close = format!("</{name}");
                    i += find_ci(&s[i..], &close).unwrap_or(s.len() - i);
                    text_start = i;
                }
            }
            out.push(token);
        } else {
            i += 1;
        }
    }
    flush(&mut out, text_start, b.len());
    out
}

/// An opening tag at the start of `s`, and its length.
fn open_tag(s: &str) -> (Token, usize) {
    let b = s.as_bytes();
    let mut i = 1;
    while i < b.len() && (b[i].is_ascii_alphanumeric() || matches!(b[i], b':' | b'-' | b'_')) {
        i += 1;
    }
    let name = s[1..i].to_ascii_lowercase();
    let mut attrs = Vec::new();
    let mut closed = false;
    loop {
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= b.len() {
            break;
        }
        if b[i] == b'>' {
            i += 1;
            break;
        }
        if b[i] == b'/' {
            closed = true;
            i += 1;
            continue;
        }
        let start = i;
        while i < b.len() && !b[i].is_ascii_whitespace() && !matches!(b[i], b'=' | b'>' | b'/') {
            i += 1;
        }
        let key = s[start..i].to_ascii_lowercase();
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        let mut value = String::new();
        if i < b.len() && b[i] == b'=' {
            i += 1;
            while i < b.len() && b[i].is_ascii_whitespace() {
                i += 1;
            }
            if i < b.len() && (b[i] == b'"' || b[i] == b'\'') {
                let q = b[i];
                let end = s[i + 1..]
                    .bytes()
                    .position(|c| c == q)
                    .map_or(b.len(), |j| i + 1 + j);
                value = decode_entities(&s[i + 1..end]);
                i = (end + 1).min(b.len());
            } else {
                let start = i;
                while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'>' {
                    i += 1;
                }
                value = decode_entities(&s[start..i]);
            }
        }
        if !key.is_empty() {
            attrs.push((key, value));
        }
        if i == start {
            i += 1; // a stray character
        }
    }
    let closed = closed || VOID.contains(&name.as_str());
    (
        Token::Open {
            name,
            attrs,
            closed,
        },
        i,
    )
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Node {
    Elem {
        name: String,
        attrs: Vec<(String, String)>,
        children: Vec<Node>,
    },
    Text(String),
}

impl Node {
    fn attr(&self, key: &str) -> Option<&str> {
        match self {
            Node::Elem { attrs, .. } => attrs
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v.as_str()),
            Node::Text(_) => None,
        }
    }
}

/// A tree from tokens, closing what's left open and ignoring stray end tags.
pub(crate) fn parse(tokens: Vec<Token>) -> Vec<Node> {
    // Each open element: (name, attrs, children).
    type Open = (String, Vec<(String, String)>, Vec<Node>);
    let mut stack: Vec<Open> = vec![(String::new(), Vec::new(), Vec::new())];
    fn close_top(stack: &mut Vec<Open>) {
        let (name, attrs, children) = stack.pop().expect("never pops the root");
        stack.last_mut().expect("root stays").2.push(Node::Elem {
            name,
            attrs,
            children,
        });
    }
    for t in tokens {
        match t {
            Token::Text(s) => stack.last_mut().expect("root").2.push(Node::Text(s)),
            Token::Open {
                name,
                attrs,
                closed,
            } => {
                // `<p>` and `<li>` close an open one of the same kind (HTML's implied ends).
                let implied = matches!(name.as_str(), "p" | "li" | "tr" | "td" | "th")
                    && stack.len() > 1
                    && {
                        let top = stack.last().expect("non-empty").0.as_str();
                        top == name
                            || (name == "td" || name == "th") && (top == "td" || top == "th")
                    };
                if implied {
                    close_top(&mut stack);
                }
                if closed {
                    stack.last_mut().expect("root").2.push(Node::Elem {
                        name,
                        attrs,
                        children: Vec::new(),
                    });
                } else {
                    stack.push((name, attrs, Vec::new()));
                }
            }
            Token::Close(name) => {
                if let Some(pos) = stack.iter().rposition(|(n, _, _)| *n == name) {
                    if pos > 0 {
                        while stack.len() > pos {
                            close_top(&mut stack);
                        }
                    }
                }
            }
        }
    }
    while stack.len() > 1 {
        close_top(&mut stack);
    }
    stack.pop().map(|(_, _, c)| c).unwrap_or_default()
}

/// Text of a node and its descendants (`<br>` as a newline).
fn text_content(nodes: &[Node], out: &mut String) {
    for n in nodes {
        match n {
            Node::Text(t) => out.push_str(t),
            Node::Elem { name, children, .. } => {
                if name == "br" {
                    out.push('\n');
                } else if !SKIP.contains(&name.as_str()) {
                    text_content(children, out);
                    if BLOCK.contains(&name.as_str()) && !out.ends_with('\n') {
                        out.push('\n');
                    }
                }
            }
        }
    }
}

fn has_block(nodes: &[Node]) -> bool {
    nodes.iter().any(|n| match n {
        Node::Elem { name, children, .. } => BLOCK.contains(&name.as_str()) || has_block(children),
        Node::Text(_) => false,
    })
}

fn collapse(t: &str) -> String {
    let mut out = String::with_capacity(t.len());
    let mut space = false;
    for c in t.chars() {
        if c.is_whitespace() || c == '\u{a0}' {
            space = true;
        } else {
            if space {
                out.push(' ');
                space = false;
            }
            out.push(c);
        }
    }
    if space {
        out.push(' ');
    }
    out
}

fn escape(t: &str) -> String {
    let mut out = String::with_capacity(t.len());
    for c in t.chars() {
        if matches!(c, '*' | '`' | '[' | ']') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn wrap(marker: &str, inner: String) -> String {
    let t = inner.trim();
    if t.is_empty() || t.contains('\n') {
        return inner;
    }
    let lead = if inner.starts_with(char::is_whitespace) {
        " "
    } else {
        ""
    };
    let trail = if inner.ends_with(char::is_whitespace) {
        " "
    } else {
        ""
    };
    format!("{lead}{marker}{t}{marker}{trail}")
}

fn destination(href: &str) -> String {
    if href.contains([' ', '(', ')']) {
        format!("<{href}>")
    } else {
        href.to_string()
    }
}

struct Prefix {
    first: String,
    rest: String,
    used: bool,
}

/// Markdown output with list/quote prefixes and collapsed blank lines.
#[derive(Default)]
struct Writer {
    out: String,
    prefixes: Vec<Prefix>,
    /// Newlines owed before the next text.
    nl: usize,
    /// Nothing written on the current line yet.
    line_start: bool,
    started: bool,
}

impl Writer {
    fn newline(&mut self, n: usize) {
        // A paragraph opening a list item stays on the item's line (a tight list).
        let n = if self.prefixes.last().is_some_and(|p| !p.used) {
            n.min(1)
        } else {
            n
        };
        if self.started {
            self.nl = self.nl.max(n);
        }
    }

    fn line_break(&mut self) {
        if !self.started {
            return;
        }
        self.nl = if self.nl > 0 || self.line_start {
            (self.nl.max(1) + 1).min(2)
        } else {
            1
        };
    }

    fn flush(&mut self) {
        if self.started && self.nl > 0 {
            self.out.push('\n');
            for _ in 1..self.nl {
                let blank: String = self
                    .prefixes
                    .iter()
                    .filter(|p| p.used)
                    .map(|p| p.rest.as_str())
                    .collect();
                self.out.push_str(blank.trim_end());
                self.out.push('\n');
            }
            self.line_start = true;
        }
        self.nl = 0;
    }

    fn prefix(&mut self) {
        for p in &mut self.prefixes {
            if p.used {
                self.out.push_str(&p.rest);
            } else {
                self.out.push_str(&p.first);
                p.used = true;
            }
        }
    }

    /// Inline text; `\n` starts a new line.
    fn write(&mut self, s: &str) {
        for (i, part) in s.split('\n').enumerate() {
            if i > 0 {
                self.newline(1);
            }
            self.write_part(part);
        }
    }

    fn write_part(&mut self, s: &str) {
        let at_start = self.line_start || self.nl > 0 || !self.started;
        let s = if at_start { s.trim_start() } else { s };
        if s.is_empty() {
            return;
        }
        self.flush();
        if at_start {
            self.prefix();
        }
        self.out.push_str(s);
        self.line_start = false;
        self.started = true;
    }

    /// One line as it is (code, table rows).
    fn raw_line(&mut self, s: &str) {
        self.flush();
        if self.started && !self.line_start {
            self.out.push('\n');
        }
        self.prefix();
        self.out.push_str(s);
        self.line_start = false;
        self.started = true;
        self.nl = 1;
    }

    fn finish(self) -> String {
        let mut out = String::with_capacity(self.out.len());
        let mut blank = 0;
        for line in self.out.lines() {
            let line = line.trim_end();
            if line.is_empty() {
                blank += 1;
                if blank > 1 {
                    continue;
                }
            } else {
                blank = 0;
            }
            out.push_str(line);
            out.push('\n');
        }
        let trimmed = out.trim_matches('\n');
        if trimmed.is_empty() {
            String::new()
        } else {
            format!("{trimmed}\n")
        }
    }
}

/// Converts HTML to Markdown. `media` writes an Evernote `<en-media>` (by its attributes).
pub(crate) struct Converter<'a> {
    pub media: &'a dyn Fn(&Node) -> Option<String>,
}

impl Converter<'_> {
    pub fn convert(&self, html: &str) -> String {
        let nodes = parse(tokenize(html));
        let mut w = Writer::default();
        self.block(&nodes, &mut w);
        w.finish()
    }

    fn block(&self, nodes: &[Node], w: &mut Writer) {
        for node in nodes {
            let Node::Elem { name, children, .. } = node else {
                if let Node::Text(t) = node {
                    w.write(&escape(&collapse(t)));
                }
                continue;
            };
            match name.as_str() {
                n if SKIP.contains(&n) => {}
                "br" => w.line_break(),
                "p" => {
                    w.newline(2);
                    self.block(children, w);
                    w.newline(2);
                }
                h if h.len() == 2 && h.starts_with('h') && h.as_bytes()[1].is_ascii_digit() => {
                    let level = (h.as_bytes()[1] - b'0').clamp(1, 6) as usize;
                    let text = self.inline_all(children).replace('\n', " ");
                    w.newline(2);
                    if !text.trim().is_empty() {
                        w.write(&format!("{} {}", "#".repeat(level), text.trim()));
                    }
                    w.newline(2);
                }
                "blockquote" => {
                    w.newline(2);
                    w.prefixes.push(Prefix {
                        first: "> ".into(),
                        rest: "> ".into(),
                        used: false,
                    });
                    self.block(children, w);
                    w.prefixes.pop();
                    w.newline(2);
                }
                "ul" | "ol" => {
                    w.newline(1);
                    let start: usize = node.attr("start").and_then(|s| s.parse().ok()).unwrap_or(1);
                    let mut n = start;
                    for li in children {
                        let Node::Elem { name, children, .. } = li else {
                            continue;
                        };
                        if name != "li" {
                            // A list nested without an `li` belongs to the previous item.
                            self.block(std::slice::from_ref(li), w);
                            continue;
                        }
                        let first = if node_is(node, "ol") {
                            format!("{n}. ")
                        } else {
                            "- ".to_string()
                        };
                        n += 1;
                        let rest = " ".repeat(first.len());
                        w.newline(1);
                        w.prefixes.push(Prefix {
                            first,
                            rest,
                            used: false,
                        });
                        self.block(children, w);
                        w.prefixes.pop();
                        w.newline(1);
                    }
                    // A blank line after a list, unless it's nested in another.
                    w.newline(if w.prefixes.is_empty() { 2 } else { 1 });
                }
                "pre" => {
                    let mut text = String::new();
                    text_content(children, &mut text);
                    let fence = if text.contains("```") { "~~~" } else { "```" };
                    w.newline(2);
                    w.raw_line(fence);
                    for line in text.trim_end_matches('\n').split('\n') {
                        w.raw_line(line);
                    }
                    w.raw_line(fence);
                    w.newline(2);
                }
                "hr" => {
                    w.newline(2);
                    w.raw_line("---");
                    w.newline(2);
                }
                "table" => self.table(children, w),
                n if BLOCK.contains(&n) => {
                    w.newline(1);
                    self.block(children, w);
                    w.newline(1);
                }
                _ if has_block(children) => self.block(children, w),
                _ => w.write(&self.inline(node)),
            }
        }
    }

    fn table(&self, children: &[Node], w: &mut Writer) {
        fn rows<'n>(nodes: &'n [Node], out: &mut Vec<&'n [Node]>) {
            for n in nodes {
                if let Node::Elem { name, children, .. } = n {
                    match name.as_str() {
                        "tr" => out.push(children),
                        "table" => {}
                        _ => rows(children, out),
                    }
                }
            }
        }
        let mut trs = Vec::new();
        rows(children, &mut trs);
        let grid: Vec<Vec<&Node>> = trs
            .iter()
            .map(|cells| {
                cells
                    .iter()
                    .filter(|c| node_is(c, "td") || node_is(c, "th"))
                    .collect()
            })
            .collect();
        let width = grid.iter().map(Vec::len).max().unwrap_or(0);
        if width == 0 {
            return;
        }
        // A one-cell table is layout, not data.
        if grid.len() == 1 && width == 1 {
            if let Node::Elem { children, .. } = grid[0][0] {
                self.block(children, w);
            }
            return;
        }
        let cell = |n: &Node| -> String {
            let Node::Elem { children, .. } = n else {
                return String::new();
            };
            self.inline_all(children)
                .trim()
                .replace('\n', "<br>")
                .replace('|', "\\|")
        };
        w.newline(2);
        for (r, row) in grid.iter().enumerate() {
            let cells: Vec<String> = (0..width)
                .map(|c| row.get(c).map(|n| cell(n)).unwrap_or_default())
                .collect();
            w.raw_line(&format!("| {} |", cells.join(" | ")));
            if r == 0 {
                w.raw_line(&format!("|{}", " --- |".repeat(width)));
            }
        }
        w.newline(2);
    }

    fn inline_all(&self, nodes: &[Node]) -> String {
        nodes.iter().map(|n| self.inline(n)).collect()
    }

    fn inline(&self, node: &Node) -> String {
        let (name, children) = match node {
            Node::Text(t) => return escape(&collapse(t)),
            Node::Elem { name, children, .. } => (name.as_str(), children),
        };
        match name {
            n if SKIP.contains(&n) => String::new(),
            "br" => "\n".into(),
            "b" | "strong" => wrap("**", self.inline_all(children)),
            "i" | "em" | "cite" => wrap("*", self.inline_all(children)),
            "s" | "strike" | "del" => wrap("~~", self.inline_all(children)),
            "code" | "tt" | "kbd" | "samp" => {
                let mut t = String::new();
                text_content(children, &mut t);
                let t = t.replace('\n', " ");
                if t.trim().is_empty() {
                    t
                } else if t.contains('`') {
                    format!("`` {t} ``")
                } else {
                    format!("`{t}`")
                }
            }
            "a" => {
                let text = self.inline_all(children).trim().to_string();
                let href = node.attr("href").unwrap_or("").trim();
                if href.is_empty() || href.starts_with("javascript:") {
                    text
                } else if text.is_empty() {
                    format!("<{href}>")
                } else {
                    format!("[{}]({})", text.replace('\n', " "), destination(href))
                }
            }
            "img" => {
                let src = node.attr("src").unwrap_or("").trim();
                if src.is_empty() || src.starts_with("data:") {
                    return String::new();
                }
                let alt = node
                    .attr("alt")
                    .unwrap_or("")
                    .replace(['[', ']', '\n'], " ");
                format!("![{}]({})", alt.trim(), destination(src))
            }
            "en-media" => (self.media)(node).unwrap_or_default(),
            "en-todo" => {
                if node.attr("checked") == Some("true") {
                    "- [x] ".into()
                } else {
                    "- [ ] ".into()
                }
            }
            n if BLOCK.contains(&n) => {
                // Flattened (inside a heading or table cell): one line per block.
                format!("{}\n", self.inline_all(children))
            }
            _ => {
                // `span`, `font` and the like: Evernote marks bold and italic with styles.
                let inner = self.inline_all(children);
                let style = node.attr("style").unwrap_or("").to_ascii_lowercase();
                let mut s = inner;
                if style.contains("line-through") {
                    s = wrap("~~", s);
                }
                if style.contains("font-style: italic") || style.contains("font-style:italic") {
                    s = wrap("*", s);
                }
                if style.contains("font-weight: bold")
                    || style.contains("font-weight:bold")
                    || style.contains("font-weight: 700")
                    || style.contains("font-weight:700")
                {
                    s = wrap("**", s);
                }
                s
            }
        }
    }
}

fn node_is(node: &Node, want: &str) -> bool {
    matches!(node, Node::Elem { name, .. } if name == want)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn md(html: &str) -> String {
        Converter {
            media: &|n: &Node| n.attr("hash").map(|h| format!("![](media/{h}.png)")),
        }
        .convert(html)
    }

    #[test]
    fn decodes_entities() {
        assert_eq!(
            decode_entities("a &amp; b &lt;c&gt; &#39;d&#x27; &bogus; &"),
            "a & b <c> 'd' &bogus; &"
        );
    }

    #[test]
    fn tokenizes_tags_attributes_cdata_and_comments() {
        let t = tokenize(
            "<?xml version=\"1.0\"?><!DOCTYPE x><a href='x y' data-n=1 checked>hi<!-- no --><br/></a><![CDATA[<raw>]]><script>if (a<b) {}</script>",
        );
        assert_eq!(
            t,
            vec![
                Token::Open {
                    name: "a".into(),
                    attrs: vec![
                        ("href".into(), "x y".into()),
                        ("data-n".into(), "1".into()),
                        ("checked".into(), "".into())
                    ],
                    closed: false
                },
                Token::Text("hi".into()),
                Token::Open {
                    name: "br".into(),
                    attrs: vec![],
                    closed: true
                },
                Token::Close("a".into()),
                Token::Text("<raw>".into()),
                Token::Open {
                    name: "script".into(),
                    attrs: vec![],
                    closed: false
                },
                Token::Close("script".into()),
            ]
        );
    }

    #[test]
    fn converts_evernote_lines_and_formatting() {
        let enml = r#"<en-note><div>First <b>bold</b> and <span style="font-style: italic;">it</span></div><div><br/></div><div>Second line<br/>third</div><div><en-todo checked="true"/>Done task</div><div><en-todo/>Open task</div><div><en-media hash="abc" type="image/png"/></div></en-note>"#;
        assert_eq!(
            md(enml),
            "First **bold** and *it*\n\nSecond line\nthird\n- [x] Done task\n- [ ] Open task\n![](media/abc.png)\n"
        );
    }

    #[test]
    fn converts_headings_lists_quotes_code_and_links() {
        let html = "<html><head><title>T</title><style>p{}</style></head><body>\
            <h2>Head <i>ing</i></h2><p>Para with <a href=\"other page.html\">a link</a> and *stars*.</p>\
            <ul><li>One<ul><li>Nested</li></ul></li><li><p>Two</p></li></ul>\
            <ol start=\"3\"><li>Three<li>Four</ol>\
            <blockquote><p>Quote</p><p>More</p></blockquote>\
            <pre><code>let x = 1;\n  y</code></pre><hr><p>End <img src=\"pic.png\" alt=\"Pic\"> <code>a`b</code></p></body></html>";
        assert_eq!(
            md(html),
            "## Head *ing*\n\nPara with [a link](<other page.html>) and \\*stars\\*.\n\n\
             - One\n  - Nested\n- Two\n\n3. Three\n4. Four\n\n> Quote\n>\n> More\n\n\
             ```\nlet x = 1;\n  y\n```\n\n---\n\nEnd ![Pic](pic.png) `` a`b ``\n"
        );
    }

    #[test]
    fn converts_tables() {
        let html = "<table><tr><th>Name</th><th>Note</th></tr><tr><td>A</td><td>x|y<br>z</td></tr><tr><td>B</td></tr></table><table><tr><td><div>Layout</div></td></tr></table>";
        assert_eq!(
            md(html),
            "| Name | Note |\n| --- | --- |\n| A | x\\|y<br>z |\n| B |  |\n\nLayout\n"
        );
    }
}
