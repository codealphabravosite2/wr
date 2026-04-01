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
    
    this._activePopup = null;
    this._popupDismissListener = null;

    this.history = new HistoryManager(({ canUndo, canRedo }) => {
      this.undoButton.disabled = !canUndo;
      this.redoButton.disabled = !canRedo;
    });

    this.initializeElements();
    this.attachEventListeners();
  }

  initializeElements() {
    this.notesList = document.getElementById('notes-list');
    this.editor = document.getElementById('editor');
    this.searchInput = document.getElementById('search');
    this.noteTitle = document.getElementById('note-title');
    this.togglesContainer = document.getElementById('toggles-container');
    this.undoButton = document.getElementById('undo-button');
    this.redoButton = document.getElementById('redo-button');

    // MODIFIED: Point to the new/re-purposed buttons
    this.importButton = document.getElementById('import-note');
    this.importFileInput = document.getElementById('import-file-input');
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
    
    // MODIFIED: Attach listeners for the new button setup
    this.importButton.addEventListener('click', () => this.handleImportClick());
    this.importFileInput.addEventListener('change', (e) => this.handleFileSelect(e));
    this.exportCurrentNoteButton.addEventListener('click', () => this.handleExportCurrentNote());

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          this.handleRedo();
        } else {
          this.handleUndo();
        }
      }
    });

    window.addEventListener('storage', (e) => {
      if (e.key === 'notes') {
        this.renderNotesList();
      }
    });
  }

  initialize() {
    this.renderNotesList();
  }

  createNewNote() {
    const note = this.noteManager.createNote();
    this.openEditor(note);
  }

  openEditor(note) {
    this.currentNote = JSON.parse(JSON.stringify(note));
    this.editor.classList.remove('hidden');
    document.getElementById('notes-list-view').classList.add('hidden');
    this.history.clear();
    this.renderEditor();
    this.loadEditorStateFromStorage();
  }

  closeEditor() {
    this.saveEditorStateToStorage();
    this.editor.classList.add('hidden');
    document.getElementById('notes-list-view').classList.remove('hidden');
    this.currentNote = null;
    this.history.clear();
    this.renderNotesList();
  }

  saveEditorStateToStorage() {
    if (!this.currentNote) return;
    
    const states = StorageManager.load(this.editorStateKey, {});
    
    const toggleStates = this.currentNote.toggles.map(toggle => {
        const textarea = document.querySelector(`textarea[data-toggle-id="${toggle.id}"]`);
        if (textarea) {
            return {
                id: toggle.id,
                scrollTop: textarea.scrollTop,
                scrollHeight: textarea.scrollHeight,
                selectionStart: textarea.selectionStart,
                selectionEnd: textarea.selectionEnd
            };
        }
        return null;
    }).filter(Boolean);

    const editorContent = document.querySelector('.editor-content');
    const editorScrollTop = editorContent ? editorContent.scrollTop : 0;

    states[this.currentNote.id] = {
        toggleStates,
        editorScrollTop,
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

    requestAnimationFrame(() => {
        if (savedState.toggleStates) {
            savedState.toggleStates.forEach(state => {
                const textarea = document.querySelector(`textarea[data-toggle-id="${state.id}"]`);
                if (textarea) {
                    textarea.scrollTop = state.scrollTop;
                }
            });
        }

        const editorContent = document.querySelector('.editor-content');
        if (editorContent && savedState.editorScrollTop) {
            editorContent.scrollTop = savedState.editorScrollTop;
        }

        setTimeout(() => {
            if (savedState.toggleStates) {
                savedState.toggleStates.forEach(state => {
                    const textarea = document.querySelector(`textarea[data-toggle-id="${state.id}"]`);
                    if (textarea && textarea.scrollTop !== state.scrollTop) {
                        textarea.scrollTop = state.scrollTop;
                    }
                });
            }
        }, 50);
    });
  }

  async deleteCurrentNote() {
    if (!this.currentNote) {
        console.warn('Attempted to delete non-existent note');
        return;
    }

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

  // MODIFIED: Replaced old import/export handlers with new ones

  handleExportCurrentNote() {
    if (!this.currentNote) return; // Safety check

    const dataStr = this.noteManager.exportSingleNote(this.currentNote);
    if (!dataStr) {
        alert('Could not export note. See console for details.');
        return;
    }

    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const a = document.createElement('a');
    a.href = url;
    // Use the note's title for the filename for better UX
    const fileName = (this.currentNote.title || 'Untitled Note').replace(/[^a-z0-9]/gi, '_').toLowerCase();
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

    // The confirmation dialog is still a good idea
    const confirmed = await dialog.confirm({
      title: 'Import Note?',
      message: 'This will add the note from the file to your list. Continue?',
      confirmText: 'Yes, Import',
      cancelText: 'Cancel'
    });
    
    if (confirmed) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const jsonString = e.target.result;
        
        // Call the new single-note import method
        const success = this.noteManager.importSingleNote(jsonString);
        
        if (success) {
          this.renderNotesList();
         // alert('Note imported successfully!');
        } else {
          alert('Import failed. The file may be corrupted or not a valid note file. See console for details.');
        }
      };

      reader.onerror = () => {
        alert('Error reading the file.');
      };
      
      reader.readAsText(file);
    }
    
    event.target.value = null;
  }

  handleNoteChange(e) {
    if (!this.currentNote) return;
    
    if (this.autoSaveTimeout) {
      clearTimeout(this.autoSaveTimeout);
    }
    
    const previousState = JSON.parse(JSON.stringify(this.currentNote));
    
    if (e.target === this.noteTitle) {
      this.currentNote.title = e.target.value;
    }
    
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

  saveEditorState() {
    this.savedToggleStates = this.currentNote.toggles.map(toggle => {
      const textarea = document.querySelector(`textarea[data-toggle-id="${toggle.id}"]`);
      if (textarea) {
        return {
          id: toggle.id,
          scrollTop: textarea.scrollTop,
          scrollHeight: textarea.scrollHeight,
          selectionStart: textarea.selectionStart,
          selectionEnd: textarea.selectionEnd,
          isFocused: document.activeElement === textarea
        };
      }
      return null;
    }).filter(Boolean);

    const editorContent = document.querySelector('.editor-content');
    if (editorContent) {
      this.lastKnownScrollPosition = editorContent.scrollTop;
    }
  }

  restoreEditorState() {
    requestAnimationFrame(() => {
      if (this.savedToggleStates) {
        this.savedToggleStates.forEach(state => {
          const textarea = document.querySelector(`textarea[data-toggle-id="${state.id}"]`);
          if (textarea) {
            textarea.scrollTop = state.scrollTop;
          }
        });
      }

      const editorContent = document.querySelector('.editor-content');
      if (editorContent) {
        editorContent.scrollTop = this.lastKnownScrollPosition;
      }

      setTimeout(() => {
        if (this.savedToggleStates) {
          this.savedToggleStates.forEach(state => {
            const textarea = document.querySelector(`textarea[data-toggle-id="${state.id}"]`);
            if (textarea && textarea.scrollTop !== state.scrollTop) {
              textarea.scrollTop = state.scrollTop;
            }
          });
        }
      }, 50);
    });
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

    toggleSection(toggleId) {
        if (!this.currentNote) return;
        
        if (this.toggleDebounce) {
            clearTimeout(this.toggleDebounce);
            this.toggleDebounce = null;
        }
        
        if (this.scrollRestoreTimeout) {
            clearTimeout(this.scrollRestoreTimeout);
            this.scrollRestoreTimeout = null;
        }
        
        this.toggleDebounce = setTimeout(() => {
            this._handleToggleSection(toggleId);
        }, 50);
    }

  _handleToggleSection(toggleId) {
    if (this.isRestoring || !this.currentNote) return;
    
    this.isRestoring = true;
    
    try {
        const editorContent = document.querySelector('.editor-content');
        const editorScrollTop = editorContent ? editorContent.scrollTop : 0;
        
        const scrollPositions = new Map();
        
        this.currentNote.toggles.forEach(toggle => {
            const textarea = document.querySelector(`textarea[data-toggle-id="${toggle.id}"]`);
            if (textarea) {
                const state = {
                    scrollTop: textarea.scrollTop,
                    scrollHeight: textarea.scrollHeight,
                    content: textarea.value,
                    contentHash: this._hashContent(textarea.value)
                };
                scrollPositions.set(toggle.id, state);
            }
        });
        
        const previousState = JSON.parse(JSON.stringify(this.currentNote));
        const toggle = this.currentNote.toggles.find(t => t.id === toggleId);
        
        if (!toggle) {
            throw new Error('Toggle not found');
        }
        
        const toggleScrollState = scrollPositions.get(toggleId);
        
        toggle.isOpen = !toggle.isOpen;
        this.history.push(previousState);
        this.noteManager.updateNote(this.currentNote);
        
        this.renderEditor(false);
        
        requestAnimationFrame(() => {
            try {
                if (editorContent) {
                    editorContent.scrollTop = editorScrollTop;
                }
                
                scrollPositions.forEach((state, id) => {
                    const textarea = document.querySelector(`textarea[data-toggle-id="${id}"]`);
                    if (textarea && this._hashContent(textarea.value) === state.contentHash) {
                        if (id === toggleId && toggle.isOpen) {
                            requestAnimationFrame(() => {
                                if (state.scrollHeight !== textarea.scrollHeight) {
                                    const ratio = textarea.scrollHeight / state.scrollHeight;
                                    textarea.scrollTop = Math.round(state.scrollTop * ratio);
                                } else {
                                    textarea.scrollTop = state.scrollTop;
                                }
                            });
                        } else if (id !== toggleId) {
                            if (state.scrollHeight !== textarea.scrollHeight) {
                                const ratio = textarea.scrollHeight / state.scrollHeight;
                                textarea.scrollTop = Math.round(state.scrollTop * ratio);
                            } else {
                                textarea.scrollTop = state.scrollTop;
                            }
                        }
                    }
                });
                
                this.scrollRestoreTimeout = setTimeout(() => {
                    try {
                        if (toggle.isOpen && toggleScrollState) {
                            const textarea = document.querySelector(`textarea[data-toggle-id="${toggleId}"]`);
                            if (textarea && this._hashContent(textarea.value) === toggleScrollState.contentHash) {
                                textarea.scrollTop = toggleScrollState.scrollTop;
                            }
                        }
                        
                        scrollPositions.forEach((state, id) => {
                            if (id !== toggleId) {
                                const textarea = document.querySelector(`textarea[data-toggle-id="${id}"]`);
                                if (textarea && this._hashContent(textarea.value) === state.contentHash) {
                                    textarea.scrollTop = state.scrollTop;
                                }
                            }
                        });
                    } catch (error) {
                        console.error('Final scroll check failed:', error);
                        this._resetScrollPositions();
                    } finally {
                        scrollPositions.clear();
                        this.isRestoring = false;
                    }
                }, 100);
                
            } catch (error) {
                console.error('Initial scroll restoration failed:', error);
                this._resetScrollPositions();
                this.isRestoring = false;
            }
        });
        
    } catch (error) {
        console.error('Toggle section failed:', error);
        this.isRestoring = false;
    }
  }

  _restoreTextareaState(textarea, state) {
    requestAnimationFrame(() => {
        if (state.scrollHeight !== textarea.scrollHeight) {
            const ratio = textarea.scrollHeight / state.scrollHeight;
            textarea.scrollTop = Math.round(state.scrollTop * ratio);
        } else {
            textarea.scrollTop = state.scrollTop;
        }
    });
  }
  
    _hashContent(content) {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            hash = ((hash << 5) - hash) + content.charCodeAt(i);
            hash = hash & hash;
        }
        return hash;
    }

    _captureToggleState(toggleId) {
        const textarea = document.querySelector(`textarea[data-toggle-id="${toggleId}"]`);
        if (!textarea) return null;
        
        return {
            scrollTop: textarea.scrollTop,
            scrollHeight: textarea.scrollHeight,
            content: textarea.value,
            contentHash: this._hashContent(textarea.value)
        };
    }

    _restoreScrollPositions(editorContent, editorScrollTop, scrollPositions, toggle, targetScrollState, toggleId) {
        if (editorContent) {
            editorContent.scrollTop = editorScrollTop;
        }
        
        scrollPositions.forEach((state, id) => {
            const textarea = document.querySelector(`textarea[data-toggle-id="${id}"]`);
            if (textarea && this._hashContent(textarea.value) === state.contentHash) {
                this._restoreTextareaState(textarea, state);
            }
        });
        
        if (toggle.isOpen && targetScrollState) {
            const newTextarea = document.querySelector(`textarea[data-toggle-id="${toggleId}"]`);
            if (newTextarea && this._hashContent(newTextarea.value) === targetScrollState.contentHash) {
                this._restoreTextareaState(newTextarea, targetScrollState);
            }
        }
    }

    _restoreTextareaState(textarea, state) {
        if (state.scrollHeight !== textarea.scrollHeight) {
            const ratio = textarea.scrollHeight / state.scrollHeight;
            textarea.scrollTop = Math.round(state.scrollTop * ratio);
        } else {
            textarea.scrollTop = state.scrollTop;
        }
        
        if (state.isFocused) {
            textarea.focus();
            textarea.setSelectionRange(state.selectionStart, state.selectionEnd);
        }
    }

    _finalScrollCheck(editorContent, editorScrollTop, scrollPositions, toggle, targetScrollState, toggleId) {
        if (editorContent && editorContent.scrollTop !== editorScrollTop) {
            editorContent.scrollTop = editorScrollTop;
        }
        
        scrollPositions.forEach((state, id) => {
            const textarea = document.querySelector(`textarea[data-toggle-id="${id}"]`);
            if (textarea && this._hashContent(textarea.value) === state.contentHash) {
                this._restoreTextareaState(textarea, state);
            }
        });
        
        if (toggle.isOpen && targetScrollState) {
            const newTextarea = document.querySelector(`textarea[data-toggle-id="${toggleId}"]`);
            if (newTextarea && this._hashContent(newTextarea.value) === targetScrollState.contentHash) {
                this._restoreTextareaState(newTextarea, targetScrollState);
            }
        }
    }

    _resetScrollPositions() {
        const editorContent = document.querySelector('.editor-content');
        if (editorContent) editorContent.scrollTop = 0;
        
        document.querySelectorAll('textarea').forEach(textarea => {
            textarea.scrollTop = 0;
        });
    }

  filterNotes() {
    const searchTerm = this.searchInput.value.toLowerCase();
    this.renderNotesList(searchTerm);
  }

  renderNotesList(searchTerm = '') {
    const filteredNotes = this.noteManager.getNotes(searchTerm);
    const fragment = document.createDocumentFragment();
    
    if (filteredNotes.length) {
      filteredNotes.forEach(note => {
        const noteElement = this.createNoteCardElement(note);
        fragment.appendChild(noteElement);
      });
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

    const title = this.escapeHtml(note.title) || 'Untitled Note';
    const content = this.escapeHtml(note.toggles.map(t => t.content).join(' ').slice(0, 150)) || 'No content';
    const date = new Date(note.updated).toLocaleDateString();

    card.innerHTML = `
      <h2>${title}</h2>
      <p>${content}</p>
      <div class="note-meta">
        Last updated: ${date}
      </div>
    `;

    return card;
  }

  renderEditor(shouldRestoreState = false) {
    if (!this.currentNote) return;

    if (!shouldRestoreState) {
      this.saveEditorState();
    }

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

  if (shouldRestoreState) {
      this.restoreEditorState();
    }
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
      this._attachViewModeListeners(viewDiv, parseInt(viewDiv.dataset.toggleId));
    });
  }

  escapeHtml(unsafe) {
    if (!unsafe) return '';
    const div = document.createElement('div');
    div.textContent = unsafe;
    return div.innerHTML;
  }

  // ─── Highlight feature ─────────────────────────────────────────────────────

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

    if (!content) {
      return '<span class="hl-placeholder">Start writing...</span>';
    }

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
    const checkSelection = () => {
      setTimeout(() => {
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
      }, 10);
    };

    viewDiv.addEventListener('mouseup', checkSelection);
    viewDiv.addEventListener('touchend', checkSelection);

    viewDiv.addEventListener('click', (e) => {
      if (e.target.tagName === 'MARK') {
        this._removeHighlight(toggleId, parseInt(e.target.dataset.hlStart), parseInt(e.target.dataset.hlEnd));
        return;
      }
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      this._dismissPopup();
      this._switchToEditMode(toggleId);
    });
  }

  _switchToEditMode(toggleId) {
    const viewDiv = document.querySelector(`.view-content[data-toggle-id="${toggleId}"]`);
    if (!viewDiv) return;
    const toggle = this.currentNote.toggles.find(t => t.id === toggleId);
    if (!toggle) return;

    const textarea = document.createElement('textarea');
    textarea.dataset.toggleId = toggleId;
    textarea.placeholder = 'Start writing...';
    textarea.spellcheck = false;
    textarea.style.cssText = 'min-height: 100px; resize: vertical;';
    textarea.value = toggle.content;

    viewDiv.parentNode.replaceChild(textarea, viewDiv);

    textarea.style.height = 'auto';
    textarea.style.height = (textarea.scrollHeight || 100) + 'px';

    textarea.addEventListener('input', (e) => {
      e.target.style.height = 'auto';
      e.target.style.height = e.target.scrollHeight + 'px';
      this.updateToggleContent(toggleId, e.target.value);
    });

    textarea.addEventListener('blur', () => {
      this._switchToViewMode(toggleId);
    });

    textarea.addEventListener('focus', () => {
      this.lastActiveToggleId = toggleId;
    });

    textarea.focus();
  }

  _switchToViewMode(toggleId) {
    const textarea = document.querySelector(`textarea[data-toggle-id="${toggleId}"]`);
    if (!textarea) return;
    const toggle = this.currentNote.toggles.find(t => t.id === toggleId);
    if (!toggle) return;

    const newContent = textarea.value;
    toggle.highlights = this._reconcileHighlights(toggle.highlights || [], newContent);
    toggle.content = newContent;

    const viewDiv = document.createElement('div');
    viewDiv.className = 'view-content';
    viewDiv.dataset.toggleId = toggleId;
    viewDiv.innerHTML = this._renderHighlightedContent(toggle);

    textarea.parentNode.replaceChild(viewDiv, textarea);
    this._attachViewModeListeners(viewDiv, toggleId);
    this.noteManager.updateNote(this.currentNote);
  }

  _showHighlightPopup(toggleId, start, end, selectedText, range) {
    this._dismissPopup();

    const popup = document.createElement('div');
    popup.className = 'hl-popup';

    ['yellow', 'blue', 'green'].forEach(color => {
      const btn = document.createElement('button');
      btn.className = `hl-popup-btn hl-popup-${color}`;
      btn.title = color.charAt(0).toUpperCase() + color.slice(1);
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._addHighlight(toggleId, start, end, color, selectedText);
        this._dismissPopup();
      });
      popup.appendChild(btn);
    });

    document.body.appendChild(popup);

    const rect = range.getBoundingClientRect();
    const pr   = popup.getBoundingClientRect();
    let top  = rect.top  - pr.height - 8;
    let left = rect.left + rect.width / 2 - pr.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
    if (top < 8) top = rect.bottom + 8;
    popup.style.top  = top  + 'px';
    popup.style.left = left + 'px';

    this._activePopup = popup;
    setTimeout(() => {
      this._popupDismissListener = (e) => {
        if (!popup.contains(e.target)) this._dismissPopup();
      };
      document.addEventListener('mousedown', this._popupDismissListener);
    }, 0);
  }

  _dismissPopup() {
    if (this._activePopup) { this._activePopup.remove(); this._activePopup = null; }
    if (this._popupDismissListener) {
      document.removeEventListener('mousedown', this._popupDismissListener);
      this._popupDismissListener = null;
    }
  }

  _addHighlight(toggleId, start, end, color, text) {
    const toggle = this.currentNote.toggles.find(t => t.id === toggleId);
    if (!toggle) return;
    const overlaps = (toggle.highlights || []).some(h => h.start < end && h.end > start);
    if (overlaps) return;

    const previousState = JSON.parse(JSON.stringify(this.currentNote));
    if (!toggle.highlights) toggle.highlights = [];
    toggle.highlights.push({ start, end, color, text });

    this.history.push(previousState);
    this.noteManager.updateNote(this.currentNote);

    const viewDiv = document.querySelector(`.view-content[data-toggle-id="${toggleId}"]`);
    if (viewDiv) {
      viewDiv.innerHTML = this._renderHighlightedContent(toggle);
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
    if (viewDiv) viewDiv.innerHTML = this._renderHighlightedContent(toggle);
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

  // ─── End highlight feature ──────────────────────────────────────────────────

  cleanupOldEditorStates() {
    const states = StorageManager.load(this.editorStateKey, {});
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    const updatedStates = Object.entries(states).reduce((acc, [id, state]) => {
        if (state.timestamp && state.timestamp > oneWeekAgo) {
            acc[id] = state;
        }
        return acc;
    }, {});
    
    StorageManager.save(this.editorStateKey, updatedStates);
  }
}
