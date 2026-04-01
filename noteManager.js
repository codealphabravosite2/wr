import { StorageManager } from './storage.js';

export class NoteManager {
  constructor() {
    this.notes = StorageManager.load('notes', []);
  }

  createNote() {
    const initialToggles = Array.from({ length: 3 }, (_, i) => ({
      id: Date.now() + i,
      title: `Section ${i + 1}`,
      content: '',
      isOpen: i === 0,
      highlights: []
    }));

    const note = {
      id: Date.now(),
      title: '',
      toggles: initialToggles,
      created: new Date().toISOString(),
      updated: new Date().toISOString()
    };
    
    this.notes.unshift(note);
    this.saveNotes();
    return note;
  }

  updateNote(note) {
    note.updated = new Date().toISOString();
    const index = this.notes.findIndex(n => n.id === note.id);
    if (index !== -1) {
      this.notes[index] = JSON.parse(JSON.stringify(note));
      this.saveNotes();
    }
  }

  deleteNote(noteId) {
    this.notes = this.notes.filter(note => note.id !== noteId);
    this.saveNotes();
  }

  getNotes(searchTerm = '') {
    return this.notes.filter(note => {
      const titleMatch = note.title.toLowerCase().includes(searchTerm);
      const contentMatch = note.toggles.some(toggle => 
        toggle.title.toLowerCase().includes(searchTerm) ||
        toggle.content.toLowerCase().includes(searchTerm)
      );
      return titleMatch || contentMatch;
    });
  }

  // --- MODIFIED: Methods now handle a SINGLE note ---

  /**
   * Returns a single note object as a JSON string for export.
   * @param {object} noteObject The note to be exported.
   * @returns {string|null} The note formatted as a JSON string, or null if invalid.
   */
  exportSingleNote(noteObject) {
    if (!noteObject || typeof noteObject.id === 'undefined') {
        console.error("Invalid note object provided for export.");
        return null;
    }
    return JSON.stringify(noteObject, null, 2);
  }
  
  /**
   * Imports a single note from a JSON string and adds it to the list.
   * Does not overwrite. If the imported note has an ID that already exists,
   * it's re-created as a new note with a new unique ID.
   * @param {string} jsonString The JSON string of the note to import.
   * @returns {boolean} True if import was successful, false otherwise.
   */
  importSingleNote(jsonString) {
    try {
      const importedNote = JSON.parse(jsonString);

      if (!this._validateSingleNoteData(importedNote)) {
        console.error('Import validation failed. The file is not a valid note.');
        return false;
      }
      
      const existingIds = new Set(this.notes.map(note => note.id));
      let noteToAdd = { ...importedNote };

      if (existingIds.has(noteToAdd.id)) {
        // CONFLICT: The imported note's ID already exists.
        noteToAdd.id = Date.now();
        noteToAdd.title = noteToAdd.title ? `${noteToAdd.title} (Imported)` : 'Untitled Note (Imported)';
        noteToAdd.toggles = noteToAdd.toggles.map((toggle, i) => ({
          ...toggle,
          id: noteToAdd.id + i + 1
        }));
      }
      
      this.notes.unshift(noteToAdd); 
      this.saveNotes();
      return true;

    } catch (error) {
      console.error('Failed to parse or import note:', error);
      return false;
    }
  }

  /**
   * Validates the structure of a single note object.
   * @private
   * @param {any} note The potential note object parsed from the JSON file.
   * @returns {boolean} True if the data is a valid note, false otherwise.
   */
  _validateSingleNoteData(note) {
    if (!note || typeof note !== 'object' || Array.isArray(note)) {
        console.error('Validation Error: Imported data is not a single object.');
        return false;
    }

    const hasBaseKeys = 'id' in note && 'title' in note && 'toggles' in note && 'created' in note && 'updated' in note;
    if (!hasBaseKeys || !Array.isArray(note.toggles)) {
      console.error('Validation Error: The note is missing required keys or `toggles` is not an array.', note);
      return false;
    }
    
    for(const toggle of note.toggles) {
       const hasToggleKeys = 'id' in toggle && 'title' in toggle && 'content' in toggle && 'isOpen' in toggle;
       if (!hasToggleKeys) {
          console.error('Validation Error: A toggle is missing required keys.', toggle);
          return false;
       }
    }

    return true;
  }
  
  // --- END OF MODIFIED METHODS ---

  saveNotes() {
    StorageManager.save('notes', this.notes);
  }
}
