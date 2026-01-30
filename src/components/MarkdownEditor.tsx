import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { marked } from "marked";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

import "./MarkdownEditor.css";

type ViewMode = "editor" | "preview" | "split";

const DEFAULT_MARKDOWN = `# Bienvenue dans OhMyMarkdown

Ceci est un **éditeur Markdown** en split-view.

## Fonctionnalités

- Édition en temps réel
- Prévisualisation instantanée
- Support de la syntaxe Markdown complète

### Code

\`\`\`javascript
function hello() {
  console.log("Hello, Markdown!");
}
\`\`\`

### Liste de tâches

- [x] Créer l'éditeur
- [x] Ajouter le split-view
- [x] Ajouter les boutons de vue
- [x] Menu Fichier > Ouvrir

> Commencez à écrire pour voir la magie opérer!

---

Créé avec ❤️ et **Tauri + React**
`;

interface Heading {
  level: number;
  text: string;
  lineIndex: number;
}

export function MarkdownEditor() {
  const [markdown, setMarkdown] = useState(DEFAULT_MARKDOWN);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [openMenu, setOpenMenu] = useState<"file" | "edit" | "format" | "paragraph" | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef<"editor" | "preview" | null>(null);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const lastSnapshotRef = useRef<string>(DEFAULT_MARKDOWN);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushUndoSnapshot = useCallback(() => {
    const current = lastSnapshotRef.current;
    const stack = undoStackRef.current;
    if (stack.length === 0 || stack[stack.length - 1] !== current) {
      stack.push(current);
      if (stack.length > 200) stack.shift();
    }
    redoStackRef.current = [];
  }, []);

  const handleMarkdownChange = useCallback((newValue: string) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      const stack = undoStackRef.current;
      const snap = lastSnapshotRef.current;
      if (stack.length === 0 || stack[stack.length - 1] !== snap) {
        stack.push(snap);
        if (stack.length > 200) stack.shift();
      }
      lastSnapshotRef.current = newValue;
      redoStackRef.current = [];
    }, 400);
    setMarkdown(newValue);
  }, []);

  function setMarkdownWithHistory(newValue: string) {
    pushUndoSnapshot();
    lastSnapshotRef.current = newValue;
    setMarkdown(newValue);
  }

  function undo() {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      // Pending typing: markdown has uncommitted changes,
      // lastSnapshotRef is the pre-typing value.
      // Save current text for redo, restore pre-typing state.
      redoStackRef.current.push(markdown);
      setMarkdown(lastSnapshotRef.current);
      return;
    }
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const prev = stack.pop()!;
    redoStackRef.current.push(lastSnapshotRef.current);
    lastSnapshotRef.current = prev;
    setMarkdown(prev);
  }

  function redo() {
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const next = stack.pop()!;
    undoStackRef.current.push(lastSnapshotRef.current);
    lastSnapshotRef.current = next;
    setMarkdown(next);
  }

  function handleUndo() {
    setOpenMenu(null);
    undo();
  }

  function handleRedo() {
    setOpenMenu(null);
    redo();
  }

  function handleCut() {
    setOpenMenu(null);
    const textarea = editorRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end) return;
    const selected = markdown.substring(start, end);
    navigator.clipboard.writeText(selected);
    const newMarkdown = markdown.substring(0, start) + markdown.substring(end);
    setMarkdownWithHistory(newMarkdown);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start);
    });
  }

  function handleCopy() {
    setOpenMenu(null);
    const textarea = editorRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end) return;
    navigator.clipboard.writeText(markdown.substring(start, end));
  }

  async function handlePaste() {
    setOpenMenu(null);
    const textarea = editorRef.current;
    if (!textarea) return;
    const text = await navigator.clipboard.readText();
    if (!text) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newMarkdown = markdown.substring(0, start) + text + markdown.substring(end);
    setMarkdownWithHistory(newMarkdown);
    const newCursor = start + text.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursor, newCursor);
    });
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuBarRef.current && !menuBarRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && event.shiftKey && event.key === "Z") {
        event.preventDefault();
        redo();
      } else if (event.ctrlKey && event.key === "z") {
        event.preventDefault();
        undo();
      } else if (event.ctrlKey && event.key === "y") {
        event.preventDefault();
        redo();
      } else if (event.ctrlKey && event.key === "o") {
        event.preventDefault();
        handleOpenFile();
      } else if (event.ctrlKey && event.shiftKey && event.key === "S") {
        event.preventDefault();
        handleSaveFileAs();
      } else if (event.ctrlKey && event.key === "s") {
        event.preventDefault();
        handleSaveFile();
      } else if (event.ctrlKey && event.key === "b") {
        event.preventDefault();
        toggleBold();
      } else if (event.ctrlKey && event.key === "i") {
        event.preventDefault();
        toggleItalic();
      } else if (event.ctrlKey && event.key === "u") {
        event.preventDefault();
        toggleUnderline();
      } else if (event.ctrlKey && event.key === "d") {
        event.preventDefault();
        toggleStrikethrough();
      } else if (event.ctrlKey && event.key === "e") {
        event.preventDefault();
        toggleCode();
      } else if (event.ctrlKey && event.key === "k") {
        event.preventDefault();
        insertLink();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [currentFile, markdown]);

  function handleEditorScroll() {
    if (isScrollingRef.current === "preview") return;
    if (!editorRef.current || !previewRef.current) return;

    isScrollingRef.current = "editor";
    const editor = editorRef.current;
    const preview = previewRef.current;

    const scrollPercentage =
      editor.scrollTop / (editor.scrollHeight - editor.clientHeight);
    preview.scrollTop =
      scrollPercentage * (preview.scrollHeight - preview.clientHeight);

    requestAnimationFrame(() => {
      isScrollingRef.current = null;
    });
  }

  function handlePreviewScroll() {
    if (isScrollingRef.current === "editor") return;
    if (!editorRef.current || !previewRef.current) return;

    isScrollingRef.current = "preview";
    const editor = editorRef.current;
    const preview = previewRef.current;

    const scrollPercentage =
      preview.scrollTop / (preview.scrollHeight - preview.clientHeight);
    editor.scrollTop =
      scrollPercentage * (editor.scrollHeight - editor.clientHeight);

    requestAnimationFrame(() => {
      isScrollingRef.current = null;
    });
  }

  async function handleOpenFile() {
    setOpenMenu(null);
    const selected = await open({
      multiple: false,
      filters: [
        { name: "Markdown", extensions: ["md", "markdown", "txt"] },
        { name: "Tous les fichiers", extensions: ["*"] },
      ],
    });

    if (selected) {
      const content = await readTextFile(selected);
      setMarkdownWithHistory(content);
      setCurrentFile(selected);
    }
  }

  async function handleSaveFile() {
    setOpenMenu(null);
    if (currentFile) {
      await writeTextFile(currentFile, markdown);
    } else {
      await handleSaveFileAs();
    }
  }

  async function handleSaveFileAs() {
    setOpenMenu(null);
    const selected = await save({
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "Texte", extensions: ["txt"] },
        { name: "Tous les fichiers", extensions: ["*"] },
      ],
      defaultPath: currentFile || "document.md",
    });

    if (selected) {
      await writeTextFile(selected, markdown);
      setCurrentFile(selected);
    }
  }

  async function handleImportWord() {
    setOpenMenu(null);
    const selected = await open({
      multiple: false,
      filters: [
        { name: "Word", extensions: ["docx", "doc"] },
      ],
    });

    if (selected) {
      try {
        const content = await invoke<string>("convert_word_to_markdown", {
          filePath: selected,
        });
        setMarkdownWithHistory(content);
        setCurrentFile(null);
      } catch (error) {
        alert(error);
      }
    }
  }

  async function handleImportPandoc(filterName: string, extensions: string[], fromFormat: string) {
    setOpenMenu(null);
    const selected = await open({
      multiple: false,
      filters: [
        { name: filterName, extensions },
      ],
    });

    if (selected) {
      try {
        const content = await invoke<string>("convert_to_markdown_via_pandoc", {
          filePath: selected,
          fromFormat,
        });
        setMarkdownWithHistory(content);
        setCurrentFile(null);
      } catch (error) {
        alert(error);
      }
    }
  }

  function handleExportPdf() {
    setOpenMenu(null);

    const container = document.createElement("div");
    container.className = "print-container";
    container.innerHTML = htmlContent;
    document.body.appendChild(container);

    window.print();

    document.body.removeChild(container);
  }

  async function handleExportPandoc(filterName: string, extension: string, toFormat: string) {
    setOpenMenu(null);
    const selected = await save({
      filters: [
        { name: filterName, extensions: [extension] },
      ],
      defaultPath: `document.${extension}`,
    });

    if (selected) {
      try {
        await invoke("export_markdown_via_pandoc", {
          markdownContent: markdown,
          outputPath: selected,
          toFormat,
        });
      } catch (error) {
        alert(error);
      }
    }
  }

  function handleToggleBold() {
    setOpenMenu(null);
    toggleBold();
  }

  function handleToggleItalic() {
    setOpenMenu(null);
    toggleItalic();
  }

  function handleToggleUnderline() {
    setOpenMenu(null);
    toggleUnderline();
  }

  function handleToggleStrikethrough() {
    setOpenMenu(null);
    toggleStrikethrough();
  }

  function handleToggleCode() {
    setOpenMenu(null);
    toggleCode();
  }

  function handleInsertComment() {
    setOpenMenu(null);
    insertComment();
  }

  function handleInsertLink() {
    setOpenMenu(null);
    insertLink();
  }

  function handleInsertImage() {
    setOpenMenu(null);
    insertImage();
  }

  function toggleBold() {
    if (!editorRef.current) return;

    const textarea = editorRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = markdown.substring(start, end);

    // Trim leading and trailing spaces from selection
    const leadingSpaces = selectedText.length - selectedText.trimStart().length;
    const trailingSpaces = selectedText.length - selectedText.trimEnd().length;
    const trimmedText = selectedText.trim();
    const adjustedStart = start + leadingSpaces;
    const adjustedEnd = end - trailingSpaces;

    // Check if selection is already bold
    const beforeSelection = markdown.substring(Math.max(0, adjustedStart - 2), adjustedStart);
    const afterSelection = markdown.substring(adjustedEnd, adjustedEnd + 2);
    const isBold = beforeSelection === "**" && afterSelection === "**";

    let newMarkdown: string;
    let newCursorStart: number;
    let newCursorEnd: number;

    if (isBold) {
      // Remove bold
      newMarkdown =
        markdown.substring(0, adjustedStart - 2) +
        trimmedText +
        markdown.substring(adjustedEnd + 2);
      newCursorStart = adjustedStart - 2;
      newCursorEnd = adjustedEnd - 2;
    } else if (trimmedText) {
      // Add bold around selection (without leading/trailing spaces)
      newMarkdown =
        markdown.substring(0, adjustedStart) +
        "**" +
        trimmedText +
        "**" +
        markdown.substring(adjustedEnd);
      newCursorStart = adjustedStart + 2;
      newCursorEnd = adjustedEnd + 2;
    } else {
      // No selection, insert bold markers and place cursor between
      newMarkdown =
        markdown.substring(0, start) + "****" + markdown.substring(end);
      newCursorStart = start + 2;
      newCursorEnd = start + 2;
    }

    setMarkdownWithHistory(newMarkdown);

    // Restore cursor position after state update
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorStart, newCursorEnd);
    });
  }

  function toggleItalic() {
    if (!editorRef.current) return;

    const textarea = editorRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = markdown.substring(start, end);

    // Trim leading and trailing spaces from selection
    const leadingSpaces = selectedText.length - selectedText.trimStart().length;
    const trailingSpaces = selectedText.length - selectedText.trimEnd().length;
    const trimmedText = selectedText.trim();
    const adjustedStart = start + leadingSpaces;
    const adjustedEnd = end - trailingSpaces;

    // Check if selection is already italic (but not bold)
    const charBefore = markdown.substring(adjustedStart - 1, adjustedStart);
    const charAfter = markdown.substring(adjustedEnd, adjustedEnd + 1);
    const twoBefore = markdown.substring(Math.max(0, adjustedStart - 2), adjustedStart);
    const twoAfter = markdown.substring(adjustedEnd, adjustedEnd + 2);
    const isItalic = charBefore === "*" && charAfter === "*" && twoBefore !== "**" && twoAfter !== "**";

    let newMarkdown: string;
    let newCursorStart: number;
    let newCursorEnd: number;

    if (isItalic) {
      // Remove italic
      newMarkdown =
        markdown.substring(0, adjustedStart - 1) +
        trimmedText +
        markdown.substring(adjustedEnd + 1);
      newCursorStart = adjustedStart - 1;
      newCursorEnd = adjustedEnd - 1;
    } else if (trimmedText) {
      // Add italic around selection (without leading/trailing spaces)
      newMarkdown =
        markdown.substring(0, adjustedStart) +
        "*" +
        trimmedText +
        "*" +
        markdown.substring(adjustedEnd);
      newCursorStart = adjustedStart + 1;
      newCursorEnd = adjustedEnd + 1;
    } else {
      // No selection, insert italic markers and place cursor between
      newMarkdown =
        markdown.substring(0, start) + "**" + markdown.substring(end);
      newCursorStart = start + 1;
      newCursorEnd = start + 1;
    }

    setMarkdownWithHistory(newMarkdown);

    // Restore cursor position after state update
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorStart, newCursorEnd);
    });
  }

  function toggleUnderline() {
    if (!editorRef.current) return;

    const textarea = editorRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = markdown.substring(start, end);

    const leadingSpaces = selectedText.length - selectedText.trimStart().length;
    const trailingSpaces = selectedText.length - selectedText.trimEnd().length;
    const trimmedText = selectedText.trim();
    const adjustedStart = start + leadingSpaces;
    const adjustedEnd = end - trailingSpaces;

    const beforeSelection = markdown.substring(Math.max(0, adjustedStart - 3), adjustedStart);
    const afterSelection = markdown.substring(adjustedEnd, adjustedEnd + 4);
    const isUnderline = beforeSelection === "<u>" && afterSelection === "</u>";

    let newMarkdown: string;
    let newCursorStart: number;
    let newCursorEnd: number;

    if (isUnderline) {
      newMarkdown =
        markdown.substring(0, adjustedStart - 3) +
        trimmedText +
        markdown.substring(adjustedEnd + 4);
      newCursorStart = adjustedStart - 3;
      newCursorEnd = adjustedEnd - 3;
    } else if (trimmedText) {
      newMarkdown =
        markdown.substring(0, adjustedStart) +
        "<u>" +
        trimmedText +
        "</u>" +
        markdown.substring(adjustedEnd);
      newCursorStart = adjustedStart + 3;
      newCursorEnd = adjustedEnd + 3;
    } else {
      newMarkdown =
        markdown.substring(0, start) + "<u></u>" + markdown.substring(end);
      newCursorStart = start + 3;
      newCursorEnd = start + 3;
    }

    setMarkdownWithHistory(newMarkdown);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorStart, newCursorEnd);
    });
  }

  function toggleStrikethrough() {
    if (!editorRef.current) return;

    const textarea = editorRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = markdown.substring(start, end);

    const leadingSpaces = selectedText.length - selectedText.trimStart().length;
    const trailingSpaces = selectedText.length - selectedText.trimEnd().length;
    const trimmedText = selectedText.trim();
    const adjustedStart = start + leadingSpaces;
    const adjustedEnd = end - trailingSpaces;

    const beforeSelection = markdown.substring(Math.max(0, adjustedStart - 2), adjustedStart);
    const afterSelection = markdown.substring(adjustedEnd, adjustedEnd + 2);
    const isStrikethrough = beforeSelection === "~~" && afterSelection === "~~";

    let newMarkdown: string;
    let newCursorStart: number;
    let newCursorEnd: number;

    if (isStrikethrough) {
      newMarkdown =
        markdown.substring(0, adjustedStart - 2) +
        trimmedText +
        markdown.substring(adjustedEnd + 2);
      newCursorStart = adjustedStart - 2;
      newCursorEnd = adjustedEnd - 2;
    } else if (trimmedText) {
      newMarkdown =
        markdown.substring(0, adjustedStart) +
        "~~" +
        trimmedText +
        "~~" +
        markdown.substring(adjustedEnd);
      newCursorStart = adjustedStart + 2;
      newCursorEnd = adjustedEnd + 2;
    } else {
      newMarkdown =
        markdown.substring(0, start) + "~~~~" + markdown.substring(end);
      newCursorStart = start + 2;
      newCursorEnd = start + 2;
    }

    setMarkdownWithHistory(newMarkdown);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorStart, newCursorEnd);
    });
  }

  function toggleCode() {
    if (!editorRef.current) return;

    const textarea = editorRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = markdown.substring(start, end);

    const leadingSpaces = selectedText.length - selectedText.trimStart().length;
    const trailingSpaces = selectedText.length - selectedText.trimEnd().length;
    const trimmedText = selectedText.trim();
    const adjustedStart = start + leadingSpaces;
    const adjustedEnd = end - trailingSpaces;

    const charBefore = markdown.substring(adjustedStart - 1, adjustedStart);
    const charAfter = markdown.substring(adjustedEnd, adjustedEnd + 1);
    const isCode = charBefore === "`" && charAfter === "`";

    let newMarkdown: string;
    let newCursorStart: number;
    let newCursorEnd: number;

    if (isCode) {
      newMarkdown =
        markdown.substring(0, adjustedStart - 1) +
        trimmedText +
        markdown.substring(adjustedEnd + 1);
      newCursorStart = adjustedStart - 1;
      newCursorEnd = adjustedEnd - 1;
    } else if (trimmedText) {
      newMarkdown =
        markdown.substring(0, adjustedStart) +
        "`" +
        trimmedText +
        "`" +
        markdown.substring(adjustedEnd);
      newCursorStart = adjustedStart + 1;
      newCursorEnd = adjustedEnd + 1;
    } else {
      newMarkdown =
        markdown.substring(0, start) + "``" + markdown.substring(end);
      newCursorStart = start + 1;
      newCursorEnd = start + 1;
    }

    setMarkdownWithHistory(newMarkdown);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorStart, newCursorEnd);
    });
  }

  function insertComment() {
    if (!editorRef.current) return;

    const textarea = editorRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = markdown.substring(start, end);

    const trimmedText = selectedText.trim();

    const adjustedStart = start + (selectedText.length - selectedText.trimStart().length);
    const adjustedEnd = end - (selectedText.length - selectedText.trimEnd().length);

    const beforeSelection = markdown.substring(Math.max(0, adjustedStart - 5), adjustedStart);
    const afterSelection = markdown.substring(adjustedEnd, adjustedEnd + 4);
    const isComment = beforeSelection === "<!-- " && afterSelection === " -->";

    let newMarkdown: string;
    let newCursorStart: number;
    let newCursorEnd: number;

    if (isComment) {
      newMarkdown =
        markdown.substring(0, adjustedStart - 5) +
        trimmedText +
        markdown.substring(adjustedEnd + 4);
      newCursorStart = adjustedStart - 5;
      newCursorEnd = adjustedEnd - 5;
    } else if (trimmedText) {
      newMarkdown =
        markdown.substring(0, adjustedStart) +
        "<!-- " +
        trimmedText +
        " -->" +
        markdown.substring(adjustedEnd);
      newCursorStart = adjustedStart + 5;
      newCursorEnd = adjustedEnd + 5;
    } else {
      newMarkdown =
        markdown.substring(0, start) + "<!--  -->" + markdown.substring(end);
      newCursorStart = start + 5;
      newCursorEnd = start + 5;
    }

    setMarkdownWithHistory(newMarkdown);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorStart, newCursorEnd);
    });
  }

  function insertLink() {
    if (!editorRef.current) return;

    const textarea = editorRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = markdown.substring(start, end).trim();

    let newMarkdown: string;
    let newCursorStart: number;
    let newCursorEnd: number;

    if (selectedText) {
      newMarkdown =
        markdown.substring(0, start) +
        "[" + selectedText + "](url)" +
        markdown.substring(end);
      // Select "url" placeholder
      newCursorStart = start + selectedText.length + 3;
      newCursorEnd = start + selectedText.length + 6;
    } else {
      newMarkdown =
        markdown.substring(0, start) + "[texte](url)" + markdown.substring(end);
      // Select "texte" placeholder
      newCursorStart = start + 1;
      newCursorEnd = start + 6;
    }

    setMarkdownWithHistory(newMarkdown);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorStart, newCursorEnd);
    });
  }

  function insertImage() {
    if (!editorRef.current) return;

    const textarea = editorRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = markdown.substring(start, end).trim();

    let newMarkdown: string;
    let newCursorStart: number;
    let newCursorEnd: number;

    if (selectedText) {
      newMarkdown =
        markdown.substring(0, start) +
        "![" + selectedText + "](url \"légende\")" +
        markdown.substring(end);
      // Select "url" placeholder
      newCursorStart = start + selectedText.length + 4;
      newCursorEnd = start + selectedText.length + 7;
    } else {
      newMarkdown =
        markdown.substring(0, start) +
        "![description](url \"légende\")" +
        markdown.substring(end);
      // Select "description" placeholder
      newCursorStart = start + 2;
      newCursorEnd = start + 13;
    }

    setMarkdownWithHistory(newMarkdown);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorStart, newCursorEnd);
    });
  }

  function toggleHeading(level: number) {
    if (!editorRef.current) return;

    const textarea = editorRef.current;
    const cursorPos = textarea.selectionStart;
    const lines = markdown.split("\n");

    let charCount = 0;
    let lineIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (charCount + lines[i].length >= cursorPos) {
        lineIndex = i;
        break;
      }
      charCount += lines[i].length + 1;
    }

    const currentLine = lines[lineIndex];
    const headingMatch = currentLine.match(/^(#{1,6})\s+(.*)$/);
    const prefix = "#".repeat(level) + " ";

    let newLine: string;
    if (headingMatch) {
      const currentLevel = headingMatch[1].length;
      const content = headingMatch[2];
      if (currentLevel === level) {
        newLine = content;
      } else {
        newLine = prefix + content;
      }
    } else {
      newLine = prefix + currentLine;
    }

    lines[lineIndex] = newLine;
    const newMarkdown = lines.join("\n");

    const lineStart = charCount;
    const newCursorPos = lineStart + newLine.length;

    setMarkdownWithHistory(newMarkdown);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    });
  }

  function handleToggleHeading(level: number) {
    setOpenMenu(null);
    toggleHeading(level);
  }

  function changeHeadingLevel(delta: number) {
    if (!editorRef.current) return;

    const textarea = editorRef.current;
    const cursorPos = textarea.selectionStart;
    const lines = markdown.split("\n");

    let charCount = 0;
    let lineIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (charCount + lines[i].length >= cursorPos) {
        lineIndex = i;
        break;
      }
      charCount += lines[i].length + 1;
    }

    const currentLine = lines[lineIndex];
    const headingMatch = currentLine.match(/^(#{1,6})\s+(.*)$/);

    if (!headingMatch) return;

    const currentLevel = headingMatch[1].length;
    const content = headingMatch[2];
    const newLevel = Math.max(1, Math.min(6, currentLevel + delta));

    if (newLevel === currentLevel) return;

    const newLine = "#".repeat(newLevel) + " " + content;
    lines[lineIndex] = newLine;
    const newMarkdown = lines.join("\n");

    const lineStart = charCount;
    const newCursorPos = lineStart + newLine.length;

    setMarkdownWithHistory(newMarkdown);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    });
  }

  function handleIncreaseHeadingLevel() {
    setOpenMenu(null);
    changeHeadingLevel(-1);
  }

  function handleDecreaseHeadingLevel() {
    setOpenMenu(null);
    changeHeadingLevel(1);
  }

  const headings = useMemo<Heading[]>(() => {
    const result: Heading[] = [];
    const lines = markdown.split("\n");
    const re = /^(#{1,6})\s+(.+)$/;
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(re);
      if (match) {
        result.push({ level: match[1].length, text: match[2], lineIndex: i });
      }
    }
    return result;
  }, [markdown]);

  function navigateToHeading(heading: Heading) {
    const textarea = editorRef.current;
    if (!textarea) return;

    const lines = markdown.split("\n");
    let charPos = 0;
    for (let i = 0; i < heading.lineIndex; i++) {
      charPos += lines[i].length + 1;
    }

    textarea.focus();
    textarea.setSelectionRange(charPos, charPos);

    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 22.4;
    const targetScroll = heading.lineIndex * lineHeight - textarea.clientHeight / 3;
    textarea.scrollTop = Math.max(0, targetScroll);
  }

  const htmlContent = useMemo(() => {
    return marked(markdown, { async: false }) as string;
  }, [markdown]);

  const showEditor = viewMode === "editor" || viewMode === "split";
  const showPreview = viewMode === "preview" || viewMode === "split";

  const fileName = currentFile ? currentFile.split(/[/\\]/).pop() : null;

  return (
    <div className="app-container">
      <div className="toolbar">
        <div className="toolbar-left">
          <button
            className="sidebar-toggle-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            title="Plan du document"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/>
            </svg>
          </button>
          <div className="menu-bar" ref={menuBarRef}>
            <div className="menu-container">
              <button
                className={`menu-button ${openMenu === "file" ? "active" : ""}`}
                onClick={() => setOpenMenu(openMenu === "file" ? null : "file")}
              >
                Fichier
              </button>
              {openMenu === "file" && (
                <div className="menu-dropdown">
                  <button className="menu-item" onClick={handleOpenFile}>
                    <span className="menu-item-label">Ouvrir...</span>
                    <span className="menu-item-shortcut">Ctrl+O</span>
                  </button>
                  <div className="menu-separator" />
                  <button className="menu-item" onClick={handleSaveFile}>
                    <span className="menu-item-label">Enregistrer</span>
                    <span className="menu-item-shortcut">Ctrl+S</span>
                  </button>
                  <button className="menu-item" onClick={handleSaveFileAs}>
                    <span className="menu-item-label">Enregistrer sous...</span>
                    <span className="menu-item-shortcut">Ctrl+Shift+S</span>
                  </button>
                  <div className="menu-separator" />
                  <div className="menu-submenu">
                    <button className="menu-item has-submenu">
                      <span className="menu-item-label">Importer</span>
                      <span className="menu-item-arrow">▶</span>
                    </button>
                    <div className="submenu-dropdown">
                      <button className="menu-item" onClick={handleImportWord}>
                        <span className="menu-item-label">Word (.docx)</span>
                      </button>
                      <button className="menu-item" onClick={() => handleImportPandoc("HTML", ["html", "htm"], "html")}>
                        <span className="menu-item-label">HTML (.html)</span>
                      </button>
                      <button className="menu-item" onClick={() => handleImportPandoc("LaTeX", ["tex", "latex"], "latex")}>
                        <span className="menu-item-label">LaTeX (.tex)</span>
                      </button>
                      <button className="menu-item" onClick={() => handleImportPandoc("EPUB", ["epub"], "epub")}>
                        <span className="menu-item-label">EPUB (.epub)</span>
                      </button>
                      <button className="menu-item" onClick={() => handleImportPandoc("reStructuredText", ["rst"], "rst")}>
                        <span className="menu-item-label">reStructuredText (.rst)</span>
                      </button>
                      <button className="menu-item" onClick={() => handleImportPandoc("Org", ["org"], "org")}>
                        <span className="menu-item-label">Org Mode (.org)</span>
                      </button>
                      <button className="menu-item" onClick={() => handleImportPandoc("ODT", ["odt"], "odt")}>
                        <span className="menu-item-label">LibreOffice (.odt)</span>
                      </button>
                      <button className="menu-item" onClick={() => handleImportPandoc("CSV", ["csv"], "csv")}>
                        <span className="menu-item-label">CSV (.csv)</span>
                      </button>
                      <button className="menu-item" onClick={() => handleImportPandoc("Textile", ["textile"], "textile")}>
                        <span className="menu-item-label">Textile (.textile)</span>
                      </button>
                      <button className="menu-item" onClick={() => handleImportPandoc("MediaWiki", ["wiki"], "mediawiki")}>
                        <span className="menu-item-label">MediaWiki (.wiki)</span>
                      </button>
                    </div>
                  </div>
                  <div className="menu-submenu">
                    <button className="menu-item has-submenu">
                      <span className="menu-item-label">Exporter</span>
                      <span className="menu-item-arrow">▶</span>
                    </button>
                    <div className="submenu-dropdown">
                      <button className="menu-item" onClick={() => handleExportPandoc("Word", "docx", "docx")}>
                        <span className="menu-item-label">Word (.docx)</span>
                      </button>
                      <button className="menu-item" onClick={handleExportPdf}>
                        <span className="menu-item-label">PDF (.pdf)</span>
                      </button>
                      <button className="menu-item" onClick={() => handleExportPandoc("HTML", "html", "html")}>
                        <span className="menu-item-label">HTML (.html)</span>
                      </button>
                      <button className="menu-item" onClick={() => handleExportPandoc("LaTeX", "tex", "latex")}>
                        <span className="menu-item-label">LaTeX (.tex)</span>
                      </button>
                      <button className="menu-item" onClick={() => handleExportPandoc("EPUB", "epub", "epub")}>
                        <span className="menu-item-label">EPUB (.epub)</span>
                      </button>
                      <button className="menu-item" onClick={() => handleExportPandoc("reStructuredText", "rst", "rst")}>
                        <span className="menu-item-label">reStructuredText (.rst)</span>
                      </button>
                      <button className="menu-item" onClick={() => handleExportPandoc("Org", "org", "org")}>
                        <span className="menu-item-label">Org Mode (.org)</span>
                      </button>
                      <button className="menu-item" onClick={() => handleExportPandoc("ODT", "odt", "odt")}>
                        <span className="menu-item-label">LibreOffice (.odt)</span>
                      </button>
                      <button className="menu-item" onClick={() => handleExportPandoc("Textile", "textile", "textile")}>
                        <span className="menu-item-label">Textile (.textile)</span>
                      </button>
                      <button className="menu-item" onClick={() => handleExportPandoc("MediaWiki", "wiki", "mediawiki")}>
                        <span className="menu-item-label">MediaWiki (.wiki)</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="menu-container">
              <button
                className={`menu-button ${openMenu === "edit" ? "active" : ""}`}
                onClick={() => setOpenMenu(openMenu === "edit" ? null : "edit")}
              >
                Edition
              </button>
              {openMenu === "edit" && (
                <div className="menu-dropdown">
                  <button className="menu-item" onClick={handleUndo}>
                    <span className="menu-item-label">Annuler</span>
                    <span className="menu-item-shortcut">Ctrl+Z</span>
                  </button>
                  <button className="menu-item" onClick={handleRedo}>
                    <span className="menu-item-label">Rétablir</span>
                    <span className="menu-item-shortcut">Ctrl+Y</span>
                  </button>
                  <div className="menu-separator" />
                  <button className="menu-item" onClick={handleCut}>
                    <span className="menu-item-label">Couper</span>
                    <span className="menu-item-shortcut">Ctrl+X</span>
                  </button>
                  <button className="menu-item" onClick={handleCopy}>
                    <span className="menu-item-label">Copier</span>
                    <span className="menu-item-shortcut">Ctrl+C</span>
                  </button>
                  <button className="menu-item" onClick={handlePaste}>
                    <span className="menu-item-label">Coller</span>
                    <span className="menu-item-shortcut">Ctrl+V</span>
                  </button>
                </div>
              )}
            </div>
            <div className="menu-container">
              <button
                className={`menu-button ${openMenu === "format" ? "active" : ""}`}
                onClick={() => setOpenMenu(openMenu === "format" ? null : "format")}
              >
                Format
              </button>
              {openMenu === "format" && (
                <div className="menu-dropdown">
                  <button className="menu-item" onClick={handleToggleBold}>
                    <span className="menu-item-label">Gras</span>
                    <span className="menu-item-shortcut">Ctrl+B</span>
                  </button>
                  <button className="menu-item" onClick={handleToggleItalic}>
                    <span className="menu-item-label">Italique</span>
                    <span className="menu-item-shortcut">Ctrl+I</span>
                  </button>
                  <button className="menu-item" onClick={handleToggleUnderline}>
                    <span className="menu-item-label">Souligné</span>
                    <span className="menu-item-shortcut">Ctrl+U</span>
                  </button>
                  <button className="menu-item" onClick={handleToggleStrikethrough}>
                    <span className="menu-item-label">Barré</span>
                    <span className="menu-item-shortcut">Ctrl+D</span>
                  </button>
                  <button className="menu-item" onClick={handleToggleCode}>
                    <span className="menu-item-label">Code</span>
                    <span className="menu-item-shortcut">Ctrl+E</span>
                  </button>
                  <div className="menu-separator" />
                  <button className="menu-item" onClick={handleInsertComment}>
                    <span className="menu-item-label">Commentaire</span>
                  </button>
                  <button className="menu-item" onClick={handleInsertLink}>
                    <span className="menu-item-label">Lien</span>
                    <span className="menu-item-shortcut">Ctrl+K</span>
                  </button>
                  <button className="menu-item" onClick={handleInsertImage}>
                    <span className="menu-item-label">Image</span>
                  </button>
                </div>
              )}
            </div>
            <div className="menu-container">
              <button
                className={`menu-button ${openMenu === "paragraph" ? "active" : ""}`}
                onClick={() => setOpenMenu(openMenu === "paragraph" ? null : "paragraph")}
              >
                Paragraphe
              </button>
              {openMenu === "paragraph" && (
                <div className="menu-dropdown">
                  <button className="menu-item" onClick={() => handleToggleHeading(1)}>
                    <span className="menu-item-label">Titre 1</span>
                  </button>
                  <button className="menu-item" onClick={() => handleToggleHeading(2)}>
                    <span className="menu-item-label">Titre 2</span>
                  </button>
                  <button className="menu-item" onClick={() => handleToggleHeading(3)}>
                    <span className="menu-item-label">Titre 3</span>
                  </button>
                  <button className="menu-item" onClick={() => handleToggleHeading(4)}>
                    <span className="menu-item-label">Titre 4</span>
                  </button>
                  <button className="menu-item" onClick={() => handleToggleHeading(5)}>
                    <span className="menu-item-label">Titre 5</span>
                  </button>
                  <button className="menu-item" onClick={() => handleToggleHeading(6)}>
                    <span className="menu-item-label">Titre 6</span>
                  </button>
                  <div className="menu-separator" />
                  <button className="menu-item" onClick={handleIncreaseHeadingLevel}>
                    <span className="menu-item-label">Augmenter le niveau de titre</span>
                  </button>
                  <button className="menu-item" onClick={handleDecreaseHeadingLevel}>
                    <span className="menu-item-label">Réduire le niveau de titre</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="toolbar-title">
            {fileName ? fileName : "OhMyMarkdown"}
          </div>
        </div>
        <div className="view-buttons">
          <button
            className={`view-btn ${viewMode === "editor" ? "active" : ""}`}
            onClick={() => setViewMode("editor")}
            title="Éditeur uniquement"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M14.06 9.02l.92.92L5.92 19H5v-.92l9.06-9.06M17.66 3c-.25 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.2-.2-.45-.29-.71-.29zm-3.6 3.19L3 17.25V21h3.75L17.81 9.94l-3.75-3.75z"/>
            </svg>
          </button>
          <button
            className={`view-btn ${viewMode === "split" ? "active" : ""}`}
            onClick={() => setViewMode("split")}
            title="Vue partagée"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M3 5v14h18V5H3zm8 12H5V7h6v10zm8 0h-6V7h6v10z"/>
            </svg>
          </button>
          <button
            className={`view-btn ${viewMode === "preview" ? "active" : ""}`}
            onClick={() => setViewMode("preview")}
            title="Prévisualisation uniquement"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
            </svg>
          </button>
        </div>
      </div>
      <div className="main-content">
        <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="sidebar-header">
            <span>Plan</span>
          </div>
          <nav className="sidebar-nav">
            {headings.map((h, i) => (
              <button
                key={i}
                className={`sidebar-item sidebar-level-${h.level}`}
                onClick={() => navigateToHeading(h)}
              >
                {h.text}
              </button>
            ))}
            {headings.length === 0 && (
              <span className="sidebar-empty">Aucun titre</span>
            )}
          </nav>
        </aside>
        <div className={`editor-container ${viewMode}`}>
        {showEditor && (
          <div className="editor-pane">
            <div className="pane-header">
              <span className="pane-title">Éditeur</span>
              <div className="format-buttons">
                <button
                  className="format-btn"
                  onClick={toggleBold}
                  title="Gras (Ctrl+B)"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/>
                  </svg>
                </button>
                <button
                  className="format-btn"
                  onClick={toggleItalic}
                  title="Italique (Ctrl+I)"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4h-8z"/>
                  </svg>
                </button>
              </div>
            </div>
            <textarea
              ref={editorRef}
              className="editor-textarea"
              value={markdown}
              onChange={(e) => handleMarkdownChange(e.target.value)}
              onScroll={handleEditorScroll}
              placeholder="Écrivez votre Markdown ici..."
              spellCheck={false}
            />
          </div>
        )}
        {showEditor && showPreview && <div className="divider" />}
        {showPreview && (
          <div className="preview-pane">
            <div className="pane-header">
              <span className="pane-title">Prévisualisation</span>
            </div>
            <div
              ref={previewRef}
              className="preview-content"
              onScroll={handlePreviewScroll}
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
