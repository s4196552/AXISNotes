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

Press **Ctrl+/** in a note and choose **Inline code** or **Code block**. Code block leaves the cursor after the opening backticks, so type the language there (suggestions appear), then press Enter to write the code. Typing three backticks alone on a line does the same. The command palette (**Ctrl+P**) also has **Insert inline code** and **Insert code block**; these wrap selected text, or place the cursor inside empty code. Undo reverses each insertion in one step. A typed command trigger is optional and follows Settings.

Away from the cursor, a code block shows as a rounded box with its language in the top-right corner (for example **Python**), thin indent guides, and no backtick lines; put the cursor in the block to see and edit its fences.

To change highlighting colours, override `--syntax-keyword`, `--syntax-string`, `--syntax-comment`, `--syntax-number`, `--syntax-function` (calls), `--syntax-definition` (functions and classes being defined), `--syntax-variable`, `--syntax-builtin`, `--syntax-type`, `--syntax-operator` and `--syntax-guide` (indent guides) in your vault's custom CSS theme. The built-in defaults follow One Light and One Dark, matching the theme's light or dark colour scheme.
