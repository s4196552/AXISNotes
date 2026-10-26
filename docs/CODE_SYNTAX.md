# Code in AXISNotes

Inline code uses backticks: `value`.

A code block uses three backticks on separate lines. Put a language immediately after the opening backticks:

````markdown
```python
def hello():
    return "Hello"
```

```java
public class Hello {
    String message = "Hello";
}
```
````

Language suggestions appear while you type the opening fence. Python, Java, JavaScript, TypeScript, C, C++, C#, Rust, HTML, CSS, JSON, SQL, Bash and the other installed CodeMirror languages are supported. Common aliases such as `py` and `js`, and uppercase language names such as `PYTHON`, also work. Untagged and unknown-language blocks remain readable plain code. Highlighting only displays code; it does not execute it.

Press **Ctrl+/** in a note and choose **Inline code**, **Code block** or a language-specific choice such as **Python code block**. Use **Turn into** to preserve the current line as a block. The command palette (**Ctrl+P**) also has **Insert inline code** and **Insert code block**; these wrap selected text, or place the cursor inside empty code. Undo reverses each insertion in one step. A typed command trigger is optional and follows Settings.

To change highlighting colours, override `--syntax-keyword`, `--syntax-string`, `--syntax-comment`, `--syntax-number`, `--syntax-function` and `--syntax-type` in your vault's custom CSS theme. The built-in defaults adapt to the theme's light or dark colour scheme.
