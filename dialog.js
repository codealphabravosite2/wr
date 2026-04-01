export class DialogManager {
  constructor() {
    this.init();
  }

  init() {
    const style = document.createElement('style');
    style.textContent = `
      .dialog-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.85); /* Darker overlay */
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        opacity: 0;
        transition: opacity 0.2s ease-in-out;
      }

      .dialog-overlay.visible {
        opacity: 1;
      }

      .dialog-container {
        background: #0f172a; /* Dark background */
        border-radius: 8px;
        padding: 24px;
        max-width: 400px;
        width: 90%;
        transform: translateY(-20px);
        transition: transform 0.2s ease-in-out;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.9); /* Stronger shadow */
      }

      .dialog-overlay.visible .dialog-container {
        transform: translateY(0);
      }

      .dialog-title {
        font-size: 1.2em;
        font-weight: 600;
        margin: 0 0 12px 0;
        color: #ecf0f1; /* Light text for dark mode */
      }

      .dialog-message {
        margin: 0 0 24px 0;
        color: #bdc3c7; /* Subtle light gray text */
        line-height: 1.5;
      }

      .dialog-buttons {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }

      .dialog-btn {
        padding: 8px 16px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
      }

      .dialog-btn:hover {
        transform: translateY(-1px);
      }

      .dialog-btn-confirm {
        background-color: #e74c3c; /* Confirm button */
        color: #ecf0f1; /* Light text */
      }

      .dialog-btn-confirm:hover {
        background-color: #c0392b; /* Darker red for hover */
      }

      .dialog-btn-cancel {
        background-color: #34495e; /* Dark button */
        color: #ecf0f1; /* Light text */
      }

      .dialog-btn-cancel:hover {
        background-color: #2c3e50; /* Slightly darker on hover */
      }
    `;
    document.head.appendChild(style);
  }

  confirm(options = {}) {
    const {
      title = 'Confirm',
      message = 'Are you sure?',
      confirmText = 'Confirm',
      cancelText = 'Cancel',
      type = 'danger' // or 'info', 'warning'
    } = options;

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'dialog-overlay';
      
      overlay.innerHTML = `
        <div class="dialog-container">
          <h3 class="dialog-title">${title}</h3>
          <p class="dialog-message">${message}</p>
          <div class="dialog-buttons">
            <button class="dialog-btn dialog-btn-cancel">${cancelText}</button>
            <button class="dialog-btn dialog-btn-confirm">${confirmText}</button>
          </div>
        </div>
      `;

      const closeDialog = (result) => {
        overlay.classList.remove('visible');
        setTimeout(() => {
          overlay.remove();
          resolve(result);
        }, 200);
      };

      overlay.querySelector('.dialog-btn-confirm').addEventListener('click', () => closeDialog(true));
      overlay.querySelector('.dialog-btn-cancel').addEventListener('click', () => closeDialog(false));
      
      document.body.appendChild(overlay);
      // Trigger reflow to ensure transition works
      overlay.offsetHeight;
      overlay.classList.add('visible');
    });
  }
}
