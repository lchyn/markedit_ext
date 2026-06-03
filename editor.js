(function () {
  'use strict';

  // ─── State ───────────────────────────────────────────────────────────
  let tabs = [];
  let activeTabId = null;
  let tabCounter = 0;
  let fontSize = 16;
  let currentView = 'split';
  let outlineCollapsed = false;
  let undoStacks = {};
  let redoStacks = {};
  let lastSavedContent = {};
  let mermaidIdCounter = 0;

  const DEFAULT_CONTENT = `# Welcome to MD Editor

A powerful Markdown editor with **Mermaid** and **LaTeX** support.

## Features

- Three view modes: Edit, Preview, Split
- Toolbar with common formatting tools
- Mermaid diagrams and LaTeX math rendering
- Multiple tabs for editing multiple files
- Collapsible document outline
- Light and dark themes
- Adjustable font size
- Open and save local Markdown files

## Mermaid Example

\`\`\`mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action]
    B -->|No| D[End]
    C --> D
\`\`\`

## LaTeX Example

Inline: $E = mc^2$

Block:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

## Code

\`\`\`javascript
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

> "The best way to predict the future is to invent it." — Alan Kay
`;

  // ─── DOM Refs ────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const editor = $('#editor');
  const preview = $('#preview');
  const previewPane = $('#preview-pane');
  const editorPane = $('#editor-pane');
  const splitHandle = $('#split-handle');
  const editorArea = $('#editor-area');
  const tabsContainer = $('#tabs-container');
  const outlineTree = $('#outline-tree');
  const fileInput = $('#file-input');

  // ─── Tab Management ──────────────────────────────────────────────────
  function createTab(name, content, filePath, fileHandle) {
    const id = ++tabCounter;
    const tab = {
      id,
      name: name || 'Untitled.md',
      content: content !== undefined ? content : DEFAULT_CONTENT,
      filePath: filePath || null,
      fileHandle: fileHandle || null,
      scrollPos: 0,
      cursorPos: null,
    };
    tabs.push(tab);
    undoStacks[id] = [];
    redoStacks[id] = [];
    lastSavedContent[id] = tab.content;
    renderTabs();
    switchTab(id);
    return id;
  }

  function switchTab(id) {
    if (activeTabId !== null) {
      const prev = getTab(activeTabId);
      if (prev) {
        prev.content = editor.value;
        prev.scrollPos = editor.scrollTop;
        prev.cursorPos = { start: editor.selectionStart, end: editor.selectionEnd };
      }
    }
    activeTabId = id;
    const tab = getTab(id);
    if (tab) {
      editor.value = tab.content;
      editor.scrollTop = tab.scrollPos;
      if (tab.cursorPos) {
        editor.selectionStart = tab.cursorPos.start;
        editor.selectionEnd = tab.cursorPos.end;
      }
      renderPreview();
      renderOutline();
    }
    renderTabs();
    editor.focus();
  }

  function closeTab(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    tabs.splice(idx, 1);
    delete undoStacks[id];
    delete redoStacks[id];
    delete lastSavedContent[id];
    if (tabs.length === 0) {
      createTab('Untitled.md', DEFAULT_CONTENT);
      return;
    }
    if (activeTabId === id) {
      const newIdx = Math.min(idx, tabs.length - 1);
      switchTab(tabs[newIdx].id);
    } else {
      renderTabs();
    }
  }

  function getTab(id) {
    return tabs.find(t => t.id === id);
  }

  function getActiveTab() {
    return getTab(activeTabId);
  }

  function isModified(tab) {
    return tab.content !== (lastSavedContent[tab.id] ?? '');
  }

  // ─── Render Tabs ─────────────────────────────────────────────────────
  function renderTabs() {
    tabsContainer.innerHTML = '';
    tabs.forEach(tab => {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
      el.innerHTML = `
        <span class="tab-name">${escapeHtml(tab.name)}</span>
        ${isModified(tab) ? '<span class="tab-modified">\u25CF</span>' : ''}
        <span class="tab-close" title="Close">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </span>
      `;
      el.querySelector('.tab-name').addEventListener('click', () => switchTab(tab.id));
      el.querySelector('.tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(tab.id);
      });
      el.addEventListener('click', () => switchTab(tab.id));
      tabsContainer.appendChild(el);
    });
  }

  // ─── Preview Rendering ───────────────────────────────────────────────
  function renderPreview() {
    const tab = getActiveTab();
    if (!tab) return;
    const html = renderMarkdown(tab.content);
    preview.innerHTML = html;
    renderMermaidDiagrams();
  }

  function renderMarkdown(content) {
    const mermaidBlocks = [];
    let processed = content;

    // Extract mermaid blocks before marked processes them
    processed = processed.replace(/```mermaid\s*\n([\s\S]*?)```/g, (_match, code) => {
      const id = 'mermaid-' + (++mermaidIdCounter);
      mermaidBlocks.push({ id, code: code.trim() });
      return `<div class="mermaid-container"><div id="${id}" data-mermaid="${encodeURIComponent(code.trim())}" class="mermaid-awaiting"></div></div>`;
    });

    // Handle LaTeX before marked - block math $$...$$
    processed = processed.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_match, math) => {
      try {
        const html = katex.renderToString(math.trim(), { displayMode: true, throwOnError: false });
        return `<div class="math-block">${html}</div>`;
      } catch (_e) {
        return `<div class="math-block">${escapeHtml(math)}</div>`;
      }
    });

    // Inline math: $...$
    processed = processed.replace(/\$([^\$\n]+?)\$/g, (_match, math) => {
      try {
        const html = katex.renderToString(math, { displayMode: false, throwOnError: false });
        return `<span class="math-inline">${html}</span>`;
      } catch (_e) {
        return _match;
      }
    });

    // Configure marked
    const renderer = new marked.Renderer();

    renderer.code = function (token) {
      const text = typeof token === 'object' ? token.text : token;
      const lang = typeof token === 'object' ? token.lang : arguments[1];

      if (lang && hljs.getLanguage(lang)) {
        try {
          const highlighted = hljs.highlight(text, { language: lang }).value;
          return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
        } catch (_e) { /* fallback */ }
      }
      const escaped = escapeHtml(text);
      return `<pre><code class="hljs">${escaped}</code></pre>`;
    };

    marked.setOptions({
      renderer,
      gfm: true,
      breaks: true,
    });

    return marked.parse(processed);
  }

  async function renderMermaidDiagrams() {
    const elements = document.querySelectorAll('.mermaid-awaiting');
    if (elements.length === 0) return;

    for (const el of elements) {
      try {
        const code = decodeURIComponent(el.getAttribute('data-mermaid'));
        const id = el.id;
        const { svg } = await mermaid.render(id + '-svg', code);
        el.innerHTML = svg;
        el.classList.remove('mermaid-awaiting');
        el.removeAttribute('data-mermaid');
      } catch (e) {
        el.innerHTML = `<pre style="color:#e55;white-space:pre-wrap;">${escapeHtml(e.message || String(e))}</pre>`;
        el.classList.remove('mermaid-awaiting');
        el.removeAttribute('data-mermaid');
      }
    }
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ─── Outline ─────────────────────────────────────────────────────────
  function renderOutline() {
    const tab = getActiveTab();
    if (!tab) return;

    const headings = [];
    const lines = tab.content.split('\n');
    lines.forEach((line, idx) => {
      const match = line.match(/^(#{1,6})\s+(.+)/);
      if (match) {
        headings.push({
          level: match[1].length,
          text: match[2].replace(/[#*`~]/g, '').trim(),
          line: idx,
        });
      }
    });

    outlineTree.innerHTML = '';
    if (headings.length === 0) {
      outlineTree.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:12px;">No headings found</div>';
      return;
    }

    headings.forEach(h => {
      const btn = document.createElement('button');
      btn.className = 'outline-item';
      btn.setAttribute('data-level', h.level);
      btn.textContent = h.text;
      btn.title = h.text;
      btn.addEventListener('click', () => scrollToLine(h.line));
      outlineTree.appendChild(btn);
    });
  }

  function scrollToLine(line) {
    const lines = editor.value.split('\n');
    let pos = 0;
    for (let i = 0; i < line && i < lines.length; i++) {
      pos += lines[i].length + 1;
    }
    editor.selectionStart = pos;
    editor.selectionEnd = pos;

    const mirror = document.createElement('div');
    const cs = getComputedStyle(editor);
    mirror.style.cssText =
      'position:absolute;top:-99999px;left:-99999px;visibility:hidden;' +
      'white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;' +
      'font:' + cs.font + ';' +
      'line-height:' + cs.lineHeight + ';' +
      'letter-spacing:' + cs.letterSpacing + ';' +
      'padding:' + cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft + ';' +
      'box-sizing:border-box;' +
      'width:' + editor.clientWidth + 'px;';
    mirror.textContent = editor.value.substring(0, pos) + '\n';
    document.body.appendChild(mirror);
    const scrollTarget = mirror.clientHeight - editor.clientHeight / 3;
    document.body.removeChild(mirror);

    editor.scrollTop = Math.max(0, scrollTarget);
    editor.focus();
  }

  // ─── Undo/Redo ──────────────────────────────────────────────────────
  function pushUndo(action) {
    const id = activeTabId;
    if (!undoStacks[id]) undoStacks[id] = [];
    undoStacks[id].push(action);
    if (undoStacks[id].length > 200) undoStacks[id].shift();
    redoStacks[id] = [];
  }

  function doUndo() {
    const id = activeTabId;
    const stack = undoStacks[id];
    if (!stack || stack.length === 0) return;
    const action = stack.pop();
    editor.value = action.before;
    editor.selectionStart = action.selBefore?.start ?? 0;
    editor.selectionEnd = action.selBefore?.end ?? 0;
    if (!redoStacks[id]) redoStacks[id] = [];
    redoStacks[id].push(action);
    onEditorChange();
  }

  function doRedo() {
    const id = activeTabId;
    const stack = redoStacks[id];
    if (!stack || stack.length === 0) return;
    const action = stack.pop();
    editor.value = action.after;
    editor.selectionStart = action.selAfter?.start ?? 0;
    editor.selectionEnd = action.selAfter?.end ?? 0;
    if (!undoStacks[id]) undoStacks[id] = [];
    undoStacks[id].push(action);
    onEditorChange();
  }

  // ─── Toolbar Actions ─────────────────────────────────────────────────
  function wrapSelection(before, after) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const sel = editor.value.substring(start, end);
    const snapshot = { before: editor.value, selBefore: { start, end } };

    editor.value = editor.value.substring(0, start) + before + sel + after + editor.value.substring(end);
    if (start === end) {
      editor.selectionStart = start + before.length;
      editor.selectionEnd = start + before.length;
    } else {
      editor.selectionStart = start + before.length;
      editor.selectionEnd = start + before.length + sel.length;
    }

    snapshot.after = editor.value;
    snapshot.selAfter = { start: editor.selectionStart, end: editor.selectionEnd };
    pushUndo(snapshot);
    editor.focus();
    onEditorChange();
  }

  function insertAtCursor(text) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const snapshot = { before: editor.value, selBefore: { start, end } };

    editor.value = editor.value.substring(0, start) + text + editor.value.substring(end);
    editor.selectionStart = start + text.length;
    editor.selectionEnd = start + text.length;

    snapshot.after = editor.value;
    snapshot.selAfter = { start: editor.selectionStart, end: editor.selectionEnd };
    pushUndo(snapshot);
    editor.focus();
    onEditorChange();
  }

  function insertLinePrefix(prefix) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const val = editor.value;
    const snapshot = { before: val, selBefore: { start, end } };

    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = val.indexOf('\n', end);
    const actualEnd = lineEnd === -1 ? val.length : lineEnd;

    const lines = val.substring(lineStart, actualEnd).split('\n');
    const newLines = lines.map(l => prefix + l);
    const replacement = newLines.join('\n');

    editor.value = val.substring(0, lineStart) + replacement + val.substring(actualEnd);
    editor.selectionStart = lineStart;
    editor.selectionEnd = lineStart + replacement.length;

    snapshot.after = editor.value;
    snapshot.selAfter = { start: editor.selectionStart, end: editor.selectionEnd };
    pushUndo(snapshot);
    editor.focus();
    onEditorChange();
  }

  function insertBlock(before, after, placeholder) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const sel = editor.value.substring(start, end) || placeholder;
    const snapshot = { before: editor.value, selBefore: { start, end } };

    const insert = before + sel + after;
    editor.value = editor.value.substring(0, start) + insert + editor.value.substring(end);

    if (editor.value.substring(start, end).length === 0) {
      editor.selectionStart = start + before.length;
      editor.selectionEnd = start + before.length + placeholder.length;
    } else {
      editor.selectionStart = start + before.length;
      editor.selectionEnd = start + before.length + sel.length;
    }

    snapshot.after = editor.value;
    snapshot.selAfter = { start: editor.selectionStart, end: editor.selectionEnd };
    pushUndo(snapshot);
    editor.focus();
    onEditorChange();
  }

  function handleAction(action) {
    const actions = {
      bold: () => wrapSelection('**', '**'),
      italic: () => wrapSelection('*', '*'),
      strikethrough: () => wrapSelection('~~', '~~'),
      code: () => wrapSelection('`', '`'),
      h1: () => insertLinePrefix('# '),
      h2: () => insertLinePrefix('## '),
      h3: () => insertLinePrefix('### '),
      h4: () => insertLinePrefix('#### '),
      h5: () => insertLinePrefix('##### '),
      h6: () => insertLinePrefix('###### '),
      quote: () => insertLinePrefix('> '),
      ul: () => insertLinePrefix('- '),
      ol: () => insertLinePrefix('1. '),
      tasklist: () => insertLinePrefix('- [ ] '),
      link: () => insertBlock('[', '](url)', 'link text'),
      image: () => insertBlock('![', '](url)', 'alt text'),
      hr: () => insertAtCursor('\n---\n'),
      codeblock: () => insertBlock('\n```\n', '\n```\n', 'code here'),
      table: () => insertAtCursor('\n| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell 1 | Cell 2 | Cell 3 |\n| Cell 4 | Cell 5 | Cell 6 |\n'),
      mermaid: () => insertAtCursor('\n```mermaid\ngraph TD\n    A[Start] --> B[End]\n```\n'),
      latex: () => insertBlock('$$\n', '\n$$', 'E = mc^2'),
      undo: () => doUndo(),
      redo: () => doRedo(),
      open: () => openFile(),
      save: () => saveFile(),
      saveas: () => saveAsFile(),
    };

    if (actions[action]) actions[action]();
  }

  // ─── File Operations ─────────────────────────────────────────────────
  async function openFile() {
    try {
      if (window.showOpenFilePicker) {
        const [handle] = await window.showOpenFilePicker({
          types: [
            {
              description: 'Markdown and Text Files',
              accept: { 'text/markdown': ['.md', '.markdown'], 'text/plain': ['.txt'] },
            },
          ],
          multiple: false,
        });

        const opts = { mode: 'readwrite' };
        if ((await handle.queryPermission(opts)) !== 'granted') {
          await handle.requestPermission(opts);
        }

        const file = await handle.getFile();
        const content = await file.text();
        createTab(handle.name, content, handle.name, handle);
      } else {
        fileInput.click();
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error opening file:', err);
      }
    }
  }

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      createTab(file.name, ev.target.result, file.name);
    };
    reader.readAsText(file);
    fileInput.value = '';
  });

  async function writeFile(handle, content) {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async function saveFile() {
    const tab = getActiveTab();
    if (!tab) return;

    if (tab.fileHandle) {
      const opts = { mode: 'readwrite' };
      if ((await tab.fileHandle.queryPermission(opts)) !== 'granted') {
        await tab.fileHandle.requestPermission(opts);
      }
      await writeFile(tab.fileHandle, tab.content);
    } else {
      await saveAsFile();
      return;
    }

    lastSavedContent[tab.id] = tab.content;
    renderTabs();
  }

  async function saveAsFile() {
    const tab = getActiveTab();
    if (!tab) return;

    try {
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: tab.name,
          types: [
            {
              description: 'Markdown and Text Files',
              accept: { 'text/markdown': ['.md', '.markdown'], 'text/plain': ['.txt'] },
            },
          ],
        });

        tab.fileHandle = handle;
        tab.name = handle.name;
        tab.filePath = handle.name;

        await writeFile(handle, tab.content);
        lastSavedContent[tab.id] = tab.content;
        renderTabs();
      } else {
        const name = prompt('Save as:', tab.name);
        if (!name) return;
        tab.name = name;
        tab.filePath = name;
        lastSavedContent[tab.id] = tab.content;
        const blob = new Blob([tab.content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
        renderTabs();
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error saving file:', err);
      }
    }
  }

  // ─── View Mode ───────────────────────────────────────────────────────
  function setViewMode(mode) {
    currentView = mode;
    editorArea.className = 'view-' + mode;
    $$('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === mode);
    });

    if (mode === 'edit') {
      editorPane.style.display = 'flex';
      splitHandle.style.display = 'none';
      previewPane.style.display = 'none';
    } else if (mode === 'preview') {
      editorPane.style.display = 'none';
      splitHandle.style.display = 'none';
      previewPane.style.display = 'block';
      renderPreview();
    } else {
      editorPane.style.display = 'flex';
      splitHandle.style.display = 'block';
      previewPane.style.display = 'block';
      editorPane.style.flex = '';
      previewPane.style.flex = '';
      renderPreview();
    }
  }

  // ─── Theme ───────────────────────────────────────────────────────────
  function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    html.setAttribute('data-theme', next);
    localStorage.setItem('md-editor-theme', next);
    updateHljsTheme(next);
    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({
        startOnLoad: false,
        theme: next === 'dark' ? 'dark' : 'default',
        securityLevel: 'loose',
      });
    }
    renderPreview();
  }

  function updateHljsTheme(theme) {
    const lightSheet = document.getElementById('hljs-theme-light');
    const darkSheet = document.getElementById('hljs-theme-dark');
    if (theme === 'dark') {
      lightSheet.disabled = true;
      darkSheet.disabled = false;
    } else {
      lightSheet.disabled = false;
      darkSheet.disabled = true;
    }
  }

  // ─── Font Size ───────────────────────────────────────────────────────
  function changeFontSize(delta) {
    fontSize = Math.max(10, Math.min(28, fontSize + delta));
    document.documentElement.style.setProperty('--font-size', fontSize + 'px');
    $('#font-size-label').textContent = fontSize + 'px';
    localStorage.setItem('md-editor-font-size', fontSize);
  }

  // ─── Split Handle Drag ───────────────────────────────────────────────
  let isDragging = false;

  splitHandle.addEventListener('mousedown', (e) => {
    isDragging = true;
    splitHandle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const rect = editorArea.getBoundingClientRect();
    const outlineEl = $('#outline-panel');
    const outlineWidth = outlineEl.classList.contains('collapsed') ? 0 : outlineEl.offsetWidth;
    const offset = e.clientX - rect.left - outlineWidth;
    const totalWidth = rect.width - outlineWidth;
    const ratio = Math.max(0.15, Math.min(0.85, offset / totalWidth));

    editorPane.style.flex = ratio.toString();
    previewPane.style.flex = (1 - ratio).toString();
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      splitHandle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });

  // ─── Outline Toggle ─────────────────────────────────────────────────
  $('#outline-toggle').addEventListener('click', () => {
    outlineCollapsed = !outlineCollapsed;
    const panel = $('#outline-panel');
    panel.classList.toggle('collapsed', outlineCollapsed);
  });

  // ─── Editor Input ─────────────────────────────────────────────────────
  let debounceTimer = null;

  editor.addEventListener('input', () => {
    const tab = getActiveTab();
    if (tab) tab.content = editor.value;
    renderTabs();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      renderPreview();
      renderOutline();
    }, 300);
  });

  function onEditorChange() {
    const tab = getActiveTab();
    if (tab) tab.content = editor.value;
    renderTabs();
    clearTimeout(debounceTimer);
    renderPreview();
    renderOutline();
  }

  // ─── Keyboard Shortcuts ────────────────────────────────────────────────
  editor.addEventListener('keydown', (e) => {
    // Tab key
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const val = editor.value;

      if (e.shiftKey) {
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = val.indexOf('\n', end);
        const actualEnd = lineEnd === -1 ? val.length : lineEnd;
        const selectedText = val.substring(lineStart, actualEnd);
        const lines = selectedText.split('\n');
        const newLines = lines.map(l => l.startsWith('    ') ? l.substring(4) : l.startsWith('\t') ? l.substring(1) : l);
        const replacement = newLines.join('\n');
        const diff = selectedText.length - replacement.length;
        editor.value = val.substring(0, lineStart) + replacement + val.substring(actualEnd);
        editor.selectionStart = start;
        editor.selectionEnd = end - diff;
      } else {
        if (start === end) {
          editor.value = val.substring(0, start) + '    ' + val.substring(end);
          editor.selectionStart = editor.selectionEnd = start + 4;
        } else {
          const lineStart = val.lastIndexOf('\n', start - 1) + 1;
          const lineEnd = val.indexOf('\n', end);
          const actualEnd = lineEnd === -1 ? val.length : lineEnd;
          const selectedText = val.substring(lineStart, actualEnd);
          const lines = selectedText.split('\n');
          const newLines = lines.map(l => '    ' + l);
          const replacement = newLines.join('\n');
          editor.value = val.substring(0, lineStart) + replacement + val.substring(actualEnd);
          editor.selectionStart = start + 4;
          editor.selectionEnd = end + (newLines.length * 4);
        }
      }
      onEditorChange();
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'b') { e.preventDefault(); handleAction('bold'); }
      else if (e.key === 'i') { e.preventDefault(); handleAction('italic'); }
      else if (e.key === 'k') { e.preventDefault(); handleAction('link'); }
      else if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if (e.key === 'z' && e.shiftKey) { e.preventDefault(); doRedo(); }
      else if (e.key === 'y') { e.preventDefault(); doRedo(); }
      else if (e.key === 's') { e.preventDefault(); saveFile().catch(err => console.error(err)); }
    }

    // Enter: auto-continue lists
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      const pos = editor.selectionStart;
      const val = editor.value;
      const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
      const currentLine = val.substring(lineStart, pos);

      const listMatch = currentLine.match(/^(\s*)(- \[[ x]\] |- |\* |\d+\. )/);
      const quoteMatch = currentLine.match(/^(\s*>+)/);

      if (listMatch) {
        // If list item is empty, remove it
        if (currentLine.trim().length <= listMatch[0].trim().length) {
          e.preventDefault();
          editor.value = val.substring(0, lineStart) + val.substring(pos);
          editor.selectionStart = editor.selectionEnd = lineStart;
          onEditorChange();
          return;
        }
        e.preventDefault();
        let prefix = listMatch[1];
        const listPrefix = listMatch[2];
        if (listPrefix.match(/^\d+\./)) {
          const num = parseInt(listPrefix) + 1;
          prefix += num + '. ';
        } else if (listPrefix.includes('[ ] ') || listPrefix.includes('[x] ')) {
          prefix += '- [ ] ';
        } else {
          prefix += listPrefix;
        }
        const insert = '\n' + prefix;
        editor.value = val.substring(0, pos) + insert + val.substring(pos);
        editor.selectionStart = editor.selectionEnd = pos + insert.length;
        onEditorChange();
      } else if (quoteMatch) {
        // If empty quoted line, end blockquote
        if (currentLine.trim() === '' || currentLine.trim() === '>') {
          e.preventDefault();
          editor.value = val.substring(0, lineStart) + val.substring(pos);
          editor.selectionStart = editor.selectionEnd = lineStart;
          onEditorChange();
          return;
        }
        e.preventDefault();
        const insert = '\n' + quoteMatch[0] + ' ';
        editor.value = val.substring(0, pos) + insert + val.substring(pos);
        editor.selectionStart = editor.selectionEnd = pos + insert.length;
        onEditorChange();
      }
    }
  });

  // ─── Sync Scroll ─────────────────────────────────────────────────────
  editor.addEventListener('scroll', () => {
    if (currentView !== 'split') return;
    const ratio = editor.scrollTop / (editor.scrollHeight - editor.clientHeight || 1);
    previewPane.scrollTop = ratio * (previewPane.scrollHeight - previewPane.clientHeight);
  });

  // ─── Toolbar Event Handlers ───────────────────────────────────────────
  $$('.tool-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleAction(btn.dataset.action));
  });

  $$('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view) setViewMode(btn.dataset.view);
    });
  });

  // Heading dropdown
  const headingDropdown = $('#heading-dropdown');
  headingDropdown.querySelector('.tool-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    headingDropdown.classList.toggle('open');
  });

  $$('#heading-dropdown .dropdown-item').forEach(item => {
    item.addEventListener('click', () => {
      handleAction(item.dataset.action);
      headingDropdown.classList.remove('open');
    });
  });

  document.addEventListener('click', () => {
    headingDropdown.classList.remove('open');
  });

  // Theme toggle
  $('#theme-toggle-btn').addEventListener('click', toggleTheme);

  // Font size
  $('#font-decrease-btn').addEventListener('click', () => changeFontSize(-1));
  $('#font-increase-btn').addEventListener('click', () => changeFontSize(1));

  // New tab
  $('#new-tab-btn').addEventListener('click', () => createTab('Untitled.md', ''));

  // Drag and drop file
  editor.addEventListener('dragover', (e) => { e.preventDefault(); });
  editor.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.md') || file.name.endsWith('.markdown') || file.name.endsWith('.txt'))) {
      const reader = new FileReader();
      reader.onload = (ev) => createTab(file.name, ev.target.result, file.name);
      reader.readAsText(file);
    }
  });

  // ─── Init ─────────────────────────────────────────────────────────────
  function init() {
    // Load theme
    const savedTheme = localStorage.getItem('md-editor-theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateHljsTheme(savedTheme);

    // Load font size
    const savedFontSize = localStorage.getItem('md-editor-font-size');
    if (savedFontSize) {
      fontSize = parseInt(savedFontSize);
      document.documentElement.style.setProperty('--font-size', fontSize + 'px');
      $('#font-size-label').textContent = fontSize + 'px';
    }

    // Init mermaid
    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({
        startOnLoad: false,
        theme: savedTheme === 'dark' ? 'dark' : 'default',
        securityLevel: 'loose',
      });
    }

    // Set initial view mode
    setViewMode('split');

    // Create initial tab
    createTab('Welcome.md', DEFAULT_CONTENT);
  }

  init();
})();