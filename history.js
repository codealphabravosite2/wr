export class HistoryManager {
  constructor(onChange, maxSize = 100) {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = onChange;
    this.maxSize = maxSize;
    this.lastPushTime = 0;
    this.debounceTime = 250; // Minimum time between pushes in milliseconds
  }

  validateState(state) {
    try {
      // Basic type checks
      if (!state || typeof state !== 'object') return false;
      if (!Array.isArray(state.toggles)) return false;
      if (typeof state.id !== 'number') return false;
      if (typeof state.title !== 'string') return false;

      // Validate each toggle in the toggles array
      for (const toggle of state.toggles) {
        if (!this.validateToggle(toggle)) return false;
      }

      return true;
    } catch (error) {
      console.error('State validation failed:', error);
      return false;
    }
  }

  validateToggle(toggle) {
    return (
      toggle &&
      typeof toggle === 'object' &&
      typeof toggle.id === 'number' &&
      typeof toggle.title === 'string' &&
      typeof toggle.content === 'string' &&
      typeof toggle.isOpen === 'boolean'
    );
  }

  createHistoryItem(state) {
    return {
      state: JSON.parse(JSON.stringify(state)), // Deep clone to prevent reference issues
      timestamp: Date.now()
    };
  }

  shouldPushState(newState) {
    if (this.undoStack.length === 0) return true;

    const lastState = this.undoStack[this.undoStack.length - 1].state;
    const now = Date.now();

    // Check if enough time has passed since last push
    const timeDiff = now - this.lastPushTime;
    if (timeDiff < this.debounceTime) return false;

    // Compare states to see if there are meaningful changes
    return JSON.stringify(lastState) !== JSON.stringify(newState);
  }

  push(state) {
    if (!this.validateState(state)) {
      console.error('Invalid state pushed to history:', state);
      return;
    }

    // Check if we should actually push this state
    if (!this.shouldPushState(state)) {
      return;
    }

    // Maintain max size of undo stack
    if (this.undoStack.length >= this.maxSize) {
      this.undoStack.shift(); // Remove oldest state
    }

    this.undoStack.push(this.createHistoryItem(state));
    this.redoStack = []; // Clear redo stack on new change
    this.lastPushTime = Date.now();
    this.updateButtons();
  }

  undo(currentState) {
    if (this.undoStack.length === 0) return null;
    
    try {
      // Save current state to redo stack if valid
      if (currentState && this.validateState(currentState)) {
        this.redoStack.push(this.createHistoryItem(currentState));
      }

      const previousItem = this.undoStack.pop();
      const previousState = previousItem.state;

      if (!this.validateState(previousState)) {
        throw new Error('Invalid state found in history');
      }

      this.updateButtons();
      return previousState;
    } catch (error) {
      console.error('Error during undo:', error);
      // Remove the invalid state from the stack
      if (this.undoStack.length > 0) {
        this.undoStack.pop();
      }
      this.updateButtons();
      return null;
    }
  }

  redo(currentState) {
    if (this.redoStack.length === 0) return null;
    
    try {
      // Save current state to undo stack if valid
      if (currentState && this.validateState(currentState)) {
        this.undoStack.push(this.createHistoryItem(currentState));
      }

      const nextItem = this.redoStack.pop();
      const nextState = nextItem.state;

      if (!this.validateState(nextState)) {
        throw new Error('Invalid state found in redo history');
      }

      this.updateButtons();
      return nextState;
    } catch (error) {
      console.error('Error during redo:', error);
      // Remove the invalid state from the stack
      if (this.redoStack.length > 0) {
        this.redoStack.pop();
      }
      this.updateButtons();
      return null;
    }
  }

  updateButtons() {
    if (this.onChange) {
      this.onChange({
        canUndo: this.undoStack.length > 0,
        canRedo: this.redoStack.length > 0,
        undoStackSize: this.undoStack.length,
        redoStackSize: this.redoStack.length
      });
    }
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.lastPushTime = 0;
    this.updateButtons();
  }

  getHistorySize() {
    return {
      undo: this.undoStack.length,
      redo: this.redoStack.length,
      maxSize: this.maxSize
    };
  }

  setMaxSize(newSize) {
    if (typeof newSize !== 'number' || newSize < 1) {
      throw new Error('Max size must be a positive number');
    }
    
    this.maxSize = newSize;
    
    // Trim undo stack if necessary
    while (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
    
    this.updateButtons();
  }

  // Debug method to help track down history issues
  debugHistory() {
    return {
      undoStack: this.undoStack.map(item => ({
        timestamp: new Date(item.timestamp).toISOString(),
        stateSnapshot: {
          id: item.state.id,
          title: item.state.title,
          toggleCount: item.state.toggles.length
        }
      })),
      redoStack: this.redoStack.map(item => ({
        timestamp: new Date(item.timestamp).toISOString(),
        stateSnapshot: {
          id: item.state.id,
          title: item.state.title,
          toggleCount: item.state.toggles.length
        }
      })),
      maxSize: this.maxSize,
      lastPushTime: new Date(this.lastPushTime).toISOString()
    };
  }
      }
