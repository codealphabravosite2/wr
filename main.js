import { StorageManager } from './storage.js';
import { HistoryManager } from './history.js';
import { NoteManager } from './noteManager.js';
import { UIManager } from './uiManager.js';

const noteManager = new NoteManager();
const uiManager = new UIManager(noteManager);

// Initialize the app
uiManager.initialize();