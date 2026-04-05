import { HistoryManager } from './history.js';
import { DialogManager } from './dialog.js';
import { StorageManager } from './storage.js';

const dialog = new DialogManager();

export class UIManager {
  constructor(noteManager) {
    this.noteManager = noteManager;
    this.currentNote = null;
    this.autoSaveTimeout = null;
    this.lastKnownScrollPosition = 0;
    this.lastActiveToggleId = null;
    this.lastCaretPosition = null;
    this.savedToggleStates = null;
    this.editorStateKey = 'editor-states';
    this.isRestoring = false;
    this.toggleDebounce = null;
    this.scrollRestoreTimeout = null;

    // ── Unified scroll tracking ──────────────────────────────────────────────
    // Single source of truth for every section's scrollTop.
    // Works regardless of whether the section is a view-div or a textarea.
    this._scrollTops = {};        // live: toggleId → scrollTop
    this._savedScrollTops = {};   // snapshot for undo/redo restore

    // ── Highlight feature ────────────────────────────────────────────────────
    this._activePopup = null;
    this._popupDismissListener = null;

    this.history = new HistoryManager(({ canUndo, canRedo }) => {
      this.undoButton.disabled = !canUndo;
      this.redoButton.disabled = !canRedo;
    });

    this.initializeElements();
    this.attachEventListeners();
  }

  // ── Unified scroll helpers ─────────────────────────────────────────────────

  _getSectionEl(toggleId) {
    return (
      document.querySelector(`.view-content[data-toggle-id="${toggleId}"]`) ||
      document.querySelector(`textarea[data-toggle-id="${toggleId}"]`)
    );
  }

  _captureAllScrollTops() {
    if (!this.currentNote) return;
    this.currentNote.toggles.forEach(t => {
      const el = this._getSectionEl(t.id);
      if (el) this._scrollTops[t.id] = el.scrollTop;
    });
  }

  _applyAllScrollTops() {
    if (!this.currentNote) return;
    this.currentNote.toggles.forEach(t => {
      const saved = this._scrollTops[t.id];
      if (saved === undefined) return;
      const el = this._getSectionEl(t.id);
      if (el) el.scrollTop = saved;
    });
  }

  _trackScroll(el, toggleId) {
    el.addEventListener('scroll', () => {
      this._scrollTops[toggleId] = el.scrollTop;
    }, { passive: true });
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  initializeElements() {
    this.notesList            = document.getElementById('notes-list');
    this.editor               = document.getElementById('editor');
    this.searchInput          = document.getElementById('search');
    this.noteTitle            = document.getElementById('note-title');
    this.togglesContainer     = document.getElementById('toggles-container');
    this.undoButton           = document.getElementById('undo-button');
    this.redoButton           = document.getElementById('redo-button');
    this.importButton         = document.getElementById('import-note');
    this.importFileInput      = document.getElementById('import-file-input');
    this.exportCurrentNoteButton = document.getElementById('export-current-note');
  }

  attachEventListeners() {
    document.getElementById('new-note').addEventListener('click', () => this.createNewNote());
    document.getElementById('back-button').addEventListener('click', () => this.closeEditor());
    document.getElementById('delete-button').addEventListener('click', () => this.deleteCurrentNote());
    document.getElementById('add-toggle').addEventListener('click', () => this.addNewToggle());
    this.undoButton.addEventListener('click', () => this.handleUndo());
    this.redoButton.addEventListener('click', () => this.handleRedo());
    this.searchInput.addEventListener('input', () => this.filterNotes());
    this.noteTitle.addEventListener('input', (e) => this.handleNoteChange(e));
    this.importButton.addEventListener('click', () => this.handleImportClick());
    this.importFileInput.addEventListener('change', (e) => this.handleFileSelect(e));
    this.exportCurrentNoteButton.addEventListener('click', () => this.handleExportCurrentNote());

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        e.shiftKey ? this.handleRedo() : this.handleUndo();
      }
    });

    window.addEventListener('storage', (e) => {
      if (e.key === 'notes') this.renderNotesList();
    });

    // Mobile: save when app is backgrounded or screen locks
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.currentNote) this.saveEditorStateToStorage();
    });

    // Mobile: more reliable than unload on iOS
    window.addEventListener('pagehide', () => {
      if (this.currentNote) this.saveEditorStateToStorage();
    });
  }

  initialize() {
    this.renderNotesList();
  }

  // ── Editor open/close ──────────────────────────────────────────────────────

  createNewNote() {
    const note = this.noteManager.createNote();
    this.openEditor(note);
  }

  openEditor(note) {
    this._scrollTops = {};
    this.currentNote = JSON.parse(JSON.stringify(note));
    this.editor.classList.remove('hidden');
    document.getElementById('notes-list-view').classList.add('hidden');
    this.history.clear();
    this.renderEditor();
    this.loadEditorStateFromStorage();
  }

  closeEditor() {
    this._captureAllScrollTops();
    this.saveEditorStateToStorage();
    this._dismissPopup();
    this.editor.classList.add('hidden');
    document.getElementById('notes-list-view').classList.remove('hidden');
    this.currentNote = null;
    this._scrollTops = {};
    this.history.clear();
    this.renderNotesList();
  }

  // ── Scroll persistence (cross-session) ────────────────────────────────────

  saveEditorStateToStorage() {
    if (!this.currentNote) return;
    this._captureAllScrollTops();

    const states = StorageManager.load(this.editorStateKey, {});
    const editorContent = document.querySelector('.editor-content');

    states[this.currentNote.id] = {
      scrollTops: { ...this._scrollTops },
      editorScrollTop: editorContent ? editorContent.scrollTop : 0,
      lastActiveToggleId: this.lastActiveToggleId,
      timestamp: Date.now()
    };

    StorageManager.save(this.editorStateKey, states);
  }

  loadEditorStateFromStorage() {
    if (!this.currentNote) return;

    const states = StorageManager.load(this.editorStateKey, {});
    const savedState = states[this.currentNote.id];
    if (!savedState) return;

    if (savedState.scrollTops) {
      this._scrollTops = { ...savedState.scrollTops };
    }

    requestAnimationFrame(() => {
      this._applyAllScrollTops();

      const editorContent = document.querySelector('.editor-content');
      if (editorContent && savedState.editorScrollTop) {
        editorContent.scrollTop = savedState.editorScrollTop;
      }

      setTimeout(() => this._applyAllScrollTops(), 80);
    });
  }

  // ── Scroll persistence (in-session, for undo/redo) ────────────────────────

  saveEditorState() {
    this._captureAllScrollTops();
    this._savedScrollTops = { ...this._scrollTops };

    const editorContent = document.querySelector('.editor-content');
    if (editorContent) this.lastKnownScrollPosition = editorContent.scrollTop;
  }

  restoreEditorState() {
    if (this._savedScrollTops) this._scrollTops = { ...this._savedScrollTops };

    requestAnimationFrame(() => {
      this._applyAllScrollTops();
      const editorContent = document.querySelector('.editor-content');
      if (editorContent) editorContent.scrollTop = this.lastKnownScrollPosition;
      setTimeout(() => this._applyAllScrollTops(), 80);
    });
  }

  // ── Note actions ───────────────────────────────────────────────────────────

  async deleteCurrentNote() {
    if (!this.currentNote) return;

    const confirmed = await dialog.confirm({
      title: 'Delete Note',
      message: 'Are you sure?',
      confirmText: 'Delete',
      cancelText: 'Cancel'
    });

    if (confirmed) {
      try {
        this.noteManager.deleteNote(this.currentNote.id);
        this.closeEditor();
      } catch (error) {
        console.error('Failed to delete note:', error);
      }
    }
  }

  handleExportCurrentNote() {
    if (!this.currentNote) return;

    const dataStr = this.noteManager.exportSingleNote(this.currentNote);
    if (!dataStr) { alert('Could not export note.'); return; }

    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const a = document.createElement('a');
    a.href = url;
    const fileName = (this.currentNote.title || 'Untitled Note')
      .replace(/[^a-z0-9]/gi, '_').toLowerCase();
    a.download = `${fileName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  handleImportClick() {
    this.importFileInput.click();
  }

  async handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const confirmed = await dialog.confirm({
      title: 'Import Note?',
      message: 'This will add the note from the file to your list. Continue?',
      confirmText: 'Yes, Import',
      cancelText: 'Cancel'
    });

    if (confirmed) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const success = this.noteManager.importSingleNote(e.target.result);
        if (success) {
          this.renderNotesList();
        } else {
          alert('Import failed. The file may be corrupted or not a valid note file.');
        }
      };
      reader.onerror = () => alert('Error reading the file.');
      reader.readAsText(file);
    }

    event.target.value = null;
  }

  // ── Note/toggle change handlers ───────────────────────────────────────────

  handleNoteChange(e) {
    if (!this.currentNote) return;
    if (this.autoSaveTimeout) clearTimeout(this.autoSaveTimeout);

    const previousState = JSON.parse(JSON.stringify(this.currentNote));
    if (e.target === this.noteTitle) this.currentNote.title = e.target.value;

    this.autoSaveTimeout = setTimeout(() => {
      if (JSON.stringify(previousState) !== JSON.stringify(this.currentNote)) {
        this.history.push(previousState);
        this.noteManager.updateNote(this.currentNote);
      }
    }, 500);
  }

  handleUndo() {
    this.saveEditorState();
    const previousState = this.history.undo(this.currentNote);
    if (previousState) {
      this.currentNote = previousState;
      this.noteManager.updateNote(this.currentNote);
      this.renderEditor(true);
    }
  }

  handleRedo() {
    this.saveEditorState();
    const nextState = this.history.redo(this.currentNote);
    if (nextState) {
      this.currentNote = nextState;
      this.noteManager.updateNote(this.currentNote);
      this.renderEditor(true);
    }
  }

  addNewToggle() {
    if (!this.currentNote) return;
    this.saveEditorState();

    const previousState = JSON.parse(JSON.stringify(this.currentNote));
    const newToggle = {
      id: Date.now(),
      title: `Section ${this.currentNote.toggles.length + 1}`,
      content: '',
      isOpen: true,
      highlights: []
    };

    this.currentNote.toggles.push(newToggle);
    this.history.push(previousState);
    this.noteManager.updateNote(this.currentNote);
    this.renderEditor(true);
  }

  updateToggleTitle(toggleId, newTitle) {
    if (!this.currentNote) return;
    const previousState = JSON.parse(JSON.stringify(this.currentNote));
    const toggle = this.currentNote.toggles.find(t => t.id === toggleId);
    if (toggle) {
      toggle.title = newTitle;
      this.history.push(previousState);
      this.noteManager.updateNote(this.currentNote);
    }
  }

  updateToggleContent(toggleId, newContent) {
    if (!this.currentNote) return;
    const previousState = JSON.parse(JSON.stringify(this.currentNote));
    const toggle = this.currentNote.toggles.find(t => t.id === toggleId);
    if (toggle) {
      toggle.content = newContent;
      this.history.push(previousState);
      this.noteManager.updateNote(this.currentNote);
    }
  }

  // ── Section toggle (open/close) ───────────────────────────────────────────

  toggleSection(toggleId) {
    if (!this.currentNote) return;

    if (this.toggleDebounce) { clearTimeout(this.toggleDebounce); this.toggleDebounce = null; }
    if (this.scrollRestoreTimeout) {
      clearTimeout(this.scrollRestoreTimeout);
      this.scrollRestoreTimeout = null;
      this.isRestoring = false;
    }

    this.toggleDebounce = setTimeout(() => this._handleToggleSection(toggleId), 50);
  }

  _handleToggleSection(toggleId) {
    if (this.isRestoring || !this.currentNote) return;
    this.isRestoring = true;

    try {
      this._captureAllScrollTops();

      const editorContent = document.querySelector('.editor-content');
      const editorScrollTop = editorContent ? editorContent.scrollTop : 0;

      const previousState = JSON.parse(JSON.stringify(this.currentNote));
      const toggle = this.currentNote.toggles.find(t => t.id === toggleId);
      if (!toggle) throw new Error('Toggle not found');

      toggle.isOpen = !toggle.isOpen;
      this.history.push(previousState);
      this.noteManager.updateNote(this.currentNote);
      this.renderEditor(false);

      // Auto-switch to edit when a section is opened
      if (toggle.isOpen) {
        requestAnimationFrame(() => this._switchToEditMode(toggleId));
      }

      requestAnimationFrame(() => {
        if (editorContent) editorContent.scrollTop = editorScrollTop;
        this._applyAllScrollTops();

        this.scrollRestoreTimeout = setTimeout(() => {
          this._applyAllScrollTops();
          this.isRestoring = false;
        }, 100);
      });

    } catch (error) {
      console.error('Toggle section failed:', error);
      this.isRestoring = false;
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  filterNotes() {
    this.renderNotesList(this.searchInput.value.toLowerCase());
  }

  renderNotesList(searchTerm = '') {
    const filteredNotes = this.noteManager.getNotes(searchTerm);
    const fragment = document.createDocumentFragment();

    if (filteredNotes.length) {
      filteredNotes.forEach(note => fragment.appendChild(this.createNoteCardElement(note)));
    } else {
      const emptyState = document.createElement('p');
      emptyState.className = 'empty-state';
      emptyState.textContent = 'No notes found';
      fragment.appendChild(emptyState);
    }

    this.notesList.innerHTML = '';
    this.notesList.appendChild(fragment);

    document.querySelectorAll('.note-card').forEach(card => {
      card.addEventListener('click', () => {
        const noteId = parseInt(card.dataset.noteId);
        const note = this.noteManager.notes.find(n => n.id === noteId);
        if (note) this.openEditor(note);
      });
    });
  }

  createNoteCardElement(note) {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.dataset.noteId = note.id;

    const title   = this.escapeHtml(note.title) || 'Untitled Note';
    const content = this.escapeHtml(note.toggles.map(t => t.content).join(' ').slice(0, 150)) || 'No content';
    const date    = new Date(note.updated).toLocaleDateString();

    card.innerHTML = `
      <h2>${title}</h2>
      <p>${content}</p>
      <div class="note-meta">Last updated: ${date}</div>
    `;
    return card;
  }

  renderEditor(shouldRestoreState = false) {
    if (!this.currentNote) return;
    if (!shouldRestoreState) this.saveEditorState();

    this.noteTitle.value = this.escapeHtml(this.currentNote.title);

    const togglesHtml = this.currentNote.toggles.map(toggle => {
      const escapedTitle = this.escapeHtml(toggle.title);
      return `
        <div class="toggle-section">
          <div class="toggle-header" data-toggle-id="${toggle.id}">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 class="toggle-icon ${toggle.isOpen ? 'open' : ''}">
              <path d="M9 18l6-6-6-6" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <input type="text" class="toggle-title" value="${escapedTitle}"
                   data-toggle-id="${toggle.id}" />
          </div>
          <div class="toggle-content ${toggle.isOpen ? 'open' : ''}">
            <div class="view-content" data-toggle-id="${toggle.id}">${this._renderHighlightedContent(toggle)}</div>
          </div>
        </div>
      `;
    }).join('');

    this.togglesContainer.innerHTML = togglesHtml;
    this.attachToggleEventListeners();

    if (shouldRestoreState) this.restoreEditorState();
  }

  attachToggleEventListeners() {
    document.querySelectorAll('.toggle-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (!e.target.classList.contains('toggle-title')) {
          this.toggleSection(parseInt(header.dataset.toggleId));
        }
      });
    });

    document.querySelectorAll('.toggle-title').forEach(input => {
      input.addEventListener('input', (e) => {
        this.updateToggleTitle(parseInt(e.target.dataset.toggleId), e.target.value);
      });
      input.addEventListener('click', (e) => e.stopPropagation());
    });

    document.querySelectorAll('.view-content').forEach(viewDiv => {
      const toggleId = parseInt(viewDiv.dataset.toggleId);
      this._trackScroll(viewDiv, toggleId);
      this._attachViewModeListeners(viewDiv, toggleId);
    });
  }

  escapeHtml(unsafe) {
    if (!unsafe) return '';
    const div = document.createElement('div');
    div.textContent = unsafe;
    return div.innerHTML;
  }

  // ── Highlight feature ──────────────────────────────────────────────────────

  _escapeText(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  _renderHighlightedContent(toggle) {
    const content = toggle.content || '';
    const highlights = ((toggle.highlights || [])
      .filter(h => h.start >= 0 && h.end <= content.length && h.start < h.end))
      .slice()
      .sort((a, b) => a.start - b.start);

    if (!content) return '<span class="hl-placeholder">Start writing...</span>';

    let html = '';
    let pos = 0;

    for (const hl of highlights) {
      if (hl.start < pos) continue;
      if (hl.start > pos) html += this._escapeText(content.slice(pos, hl.start));
      html += `<mark class="hl-${hl.color}" data-hl-start="${hl.start}" data-hl-end="${hl.end}">${this._escapeText(content.slice(hl.start, hl.end))}</mark>`;
      pos = hl.end;
    }

    if (pos < content.length) html += this._escapeText(content.slice(pos));
    return html || '<span class="hl-placeholder">Start writing...</span>';
  }

  _attachViewModeListeners(viewDiv, toggleId) {
    // Desktop
    viewDiv.addEventListener('mouseup', () => {
      setTimeout(() => this._checkSelectionInDiv(viewDiv, toggleId), 10);
    });

    // Mobile: selectionchange fires after selection is finalized
    let selChangeTimer = null;
    const onSelectionChange = () => {
      clearTimeout(selChangeTimer);
      selChangeTimer = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!viewDiv.contains(range.commonAncestorContainer)) return;
        this._checkSelectionInDiv(viewDiv, toggleId);
      }, 300);
    };

    viewDiv.addEventListener('touchstart', () => {
      document.addEventListener('selectionchange', onSelectionChange);
    }, { passive: true });

    viewDiv.addEventListener('touchend', () => {
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          document.removeEventListener('selectionchange', onSelectionChange);
        }
      }, 350);
    }, { passive: true });

    viewDiv.addEventListener('click', (e) => {
      if (e.target.tagName === 'MARK') {
        this._removeHighlight(
          toggleId,
          parseInt(e.target.dataset.hlStart),
          parseInt(e.target.dataset.hlEnd)
        );
        return;
      }
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      this._dismissPopup();
      document.removeEventListener('selectionchange', onSelectionChange);
      this._switchToEditMode(toggleId);
    });
  }

  _checkSelectionInDiv(viewDiv, toggleId) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!viewDiv.contains(range.commonAncestorContainer)) return;
    const selectedText = sel.toString();
    if (!selectedText.trim()) return;
    const start = this._getTextOffset(viewDiv, range.startContainer, range.startOffset);
    const end   = this._getTextOffset(viewDiv, range.endContainer,   range.endOffset);
    if (start >= end) return;
    this._showHighlightPopup(toggleId, start, end, selectedText, range);
  }

  _switchToEditMode(toggleId) {
    try {
      const viewDiv = document.querySelector(`.view-content[data-toggle-id="${toggleId}"]`);
      if (!viewDiv) return;
      const toggle = this.currentNote && this.currentNote.toggles.find(t => t.id === toggleId);
      if (!toggle) return;

      // Capture view-div scroll before replacing
      this._scrollTops[toggleId] = viewDiv.scrollTop;

      const textarea = document.createElement('textarea');
      textarea.dataset.toggleId = toggleId;
      textarea.placeholder = 'Start writing...';
      textarea.spellcheck = false;
      textarea.value = toggle.content;

      viewDiv.parentNode.replaceChild(textarea, viewDiv);

      // Restore scroll + focus after paint
      requestAnimationFrame(() => {
        if (this._scrollTops[toggleId] !== undefined) {
          textarea.scrollTop = this._scrollTops[toggleId];
        }
        textarea.focus();
      });

      this._trackScroll(textarea, toggleId);

      textarea.addEventListener('input', (e) => {
        this.updateToggleContent(toggleId, e.target.value);
      });

      textarea.addEventListener('blur', () => this._switchToViewMode(toggleId));

      textarea.addEventListener('focus', () => {
        this.lastActiveToggleId = toggleId;
      });

    } catch (err) {
      console.error('[Highlight] _switchToEditMode failed:', err);
    }
  }

  _switchToViewMode(toggleId) {
    const textarea = document.querySelector(`textarea[data-toggle-id="${toggleId}"]`);
    if (!textarea) return;
    const toggle = this.currentNote && this.currentNote.toggles.find(t => t.id === toggleId);
    if (!toggle) return;

    // Capture textarea scroll before replacing
    this._scrollTops[toggleId] = textarea.scrollTop;

    const newContent = textarea.value;
    toggle.highlights = this._reconcileHighlights(toggle.highlights || [], newContent);
    toggle.content = newContent;

    const viewDiv = document.createElement('div');
    viewDiv.className = 'view-content';
    viewDiv.dataset.toggleId = toggleId;
    viewDiv.innerHTML = this._renderHighlightedContent(toggle);

    textarea.parentNode.replaceChild(viewDiv, textarea);

    // Restore scroll into view-div after paint
    requestAnimationFrame(() => {
      if (this._scrollTops[toggleId] !== undefined) {
        viewDiv.scrollTop = this._scrollTops[toggleId];
      }
    });

    this._trackScroll(viewDiv, toggleId);
    this._attachViewModeListeners(viewDiv, toggleId);
    this.noteManager.updateNote(this.currentNote);

    // Persist so refresh restores the same position
    this.saveEditorStateToStorage();
  }

  // ── Highlight popup ────────────────────────────────────────────────────────

  _showHighlightPopup(toggleId, start, end, selectedText, range) {
    this._dismissPopup();

    const popup = document.createElement('div');
    popup.className = 'hl-popup';

    ['yellow', 'blue', 'green'].forEach(color => {
      const btn = document.createElement('button');
      btn.className = `hl-popup-btn hl-popup-${color}`;
      btn.title = color.charAt(0).toUpperCase() + color.slice(1);

      const apply = (e) => {
        e.preventDefault();
        this._addHighlight(toggleId, start, end, color, selectedText);
        this._dismissPopup();
      };
      btn.addEventListener('mousedown', apply);
      btn.addEventListener('touchend', apply);
      popup.appendChild(btn);
    });

    document.body.appendChild(popup);

    const rect = range.getBoundingClientRect();
    const pr   = popup.getBoundingClientRect();
    let top  = rect.top  - pr.height - 10;
    let left = rect.left + rect.width / 2 - pr.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
    if (top < 8) top = rect.bottom + 10;
    popup.style.top  = top  + 'px';
    popup.style.left = left + 'px';

    this._activePopup = popup;
    setTimeout(() => {
      this._popupDismissListener = (e) => {
        if (!popup.contains(e.target)) this._dismissPopup();
      };
      document.addEventListener('mousedown', this._popupDismissListener);
      document.addEventListener('touchstart', this._popupDismissListener, { passive: true });
    }, 0);
  }

  _dismissPopup() {
    if (this._activePopup) { this._activePopup.remove(); this._activePopup = null; }
    if (this._popupDismissListener) {
      document.removeEventListener('mousedown', this._popupDismissListener);
      document.removeEventListener('touchstart', this._popupDismissListener);
      this._popupDismissListener = null;
    }
  }

  _addHighlight(toggleId, start, end, color, text) {
    const toggle = this.currentNote.toggles.find(t => t.id === toggleId);
    if (!toggle) return;
    if ((toggle.highlights || []).some(h => h.start < end && h.end > start)) return;

    const previousState = JSON.parse(JSON.stringify(this.currentNote));
    if (!toggle.highlights) toggle.highlights = [];
    toggle.highlights.push({ start, end, color, text });

    this.history.push(previousState);
    this.noteManager.updateNote(this.currentNote);

    const viewDiv = document.querySelector(`.view-content[data-toggle-id="${toggleId}"]`);
    if (viewDiv) {
      const scrollTop = viewDiv.scrollTop;
      viewDiv.innerHTML = this._renderHighlightedContent(toggle);
      viewDiv.scrollTop = scrollTop;
      window.getSelection().removeAllRanges();
    }
  }

  _removeHighlight(toggleId, start, end) {
    const toggle = this.currentNote.toggles.find(t => t.id === toggleId);
    if (!toggle) return;

    const previousState = JSON.parse(JSON.stringify(this.currentNote));
    toggle.highlights = (toggle.highlights || []).filter(h => !(h.start === start && h.end === end));

    this.history.push(previousState);
    this.noteManager.updateNote(this.currentNote);

    const viewDiv = document.querySelector(`.view-content[data-toggle-id="${toggleId}"]`);
    if (viewDiv) {
      const scrollTop = viewDiv.scrollTop;
      viewDiv.innerHTML = this._renderHighlightedContent(toggle);
      viewDiv.scrollTop = scrollTop;
    }
  }

  _reconcileHighlights(highlights, newContent) {
    if (!highlights || !highlights.length) return [];
    return highlights.reduce((kept, hl) => {
      if (newContent.slice(hl.start, hl.end) === hl.text) {
        kept.push(hl);
      } else {
        const idx = newContent.indexOf(hl.text);
        if (idx !== -1) kept.push({ ...hl, start: idx, end: idx + hl.text.length });
      }
      return kept;
    }, []);
  }

  _getTextOffset(container, targetNode, targetOffset) {
    let total = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node === targetNode) return total + targetOffset;
      total += node.textContent.length;
    }
    return total + targetOffset;
  }

  // ── Misc helpers ───────────────────────────────────────────────────────────

  _hashContent(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) - hash) + content.charCodeAt(i);
      hash = hash & hash;
    }
    return hash;
  }

  _resetScrollPositions() {
    const editorContent = document.querySelector('.editor-content');
    if (editorContent) editorContent.scrollTop = 0;
    document.querySelectorAll('textarea, .view-content').forEach(el => { el.scrollTop = 0; });
    this._scrollTops = {};
  }

  cleanupOldEditorStates() {
    const states = StorageManager.load(this.editorStateKey, {});
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

    const updatedStates = Object.entries(states).reduce((acc, [id, state]) => {
      if (state.timestamp && state.timestamp > oneWeekAgo) acc[id] = state;
      return acc;
    }, {});

    StorageManager.save(this.editorStateKey, updatedStates);
  }
}
