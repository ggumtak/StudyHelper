/**
 * Keyboard Shortcuts Module
 */

import { $, $$ } from "../core/utils.js";
import { togglePanel, closePanel } from "../core/ui.js";
import { AppState } from "../core/state.js";

export const KeyboardShortcuts = {
  enabled: true,

  init() {
    document.addEventListener("keydown", (e) => {
      if (!this.enabled) return;

      const inInput = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);

      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        document.getElementById("btn-check")?.click();
        return;
      }

      if (e.ctrlKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        togglePanel("ai-panel");
        return;
      }

      if (inInput) return;

      switch (e.key.toLowerCase()) {
        case "n":
          e.preventDefault();
          this.focusNextUnanswered();
          break;
        case "arrowup":
          e.preventDefault();
          this.navigateQuestion(-1);
          break;
        case "arrowdown":
          e.preventDefault();
          this.navigateQuestion(1);
          break;
        case "a":
          e.preventDefault();
          togglePanel("ai-panel");
          break;
        case "s":
          e.preventDefault();
          document.getElementById("btn-shuffle")?.click();
          break;
        case "c":
          e.preventDefault();
          document.getElementById("btn-check")?.click();
          break;
        case "v":
          e.preventDefault();
          document.getElementById("btn-reveal")?.click();
          break;
        case "r":
          e.preventDefault();
          document.getElementById("btn-reset")?.click();
          break;
        case "escape":
          document.activeElement?.blur();
          closePanel("ai-panel");
          break;
        case "?":
          e.preventDefault();
          this.showHelp();
          break;
      }
    });
  },

  focusNextUnanswered() {
    const inputs = [...$$("input.blank, input.mode1-input, input.blank-card-input, textarea.challenge-input")];
    const unanswered = inputs.find(
      (inp) => !inp.classList.contains("correct") && !inp.classList.contains("revealed") && !inp.value.trim()
    );
    if (unanswered) {
      unanswered.focus();
      unanswered.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  },

  navigateQuestion(direction) {
    const inputs = [...$$("input.blank, input.mode1-input, input.blank-card-input")];
    const currentIdx = inputs.indexOf(document.activeElement);
    const nextIdx = currentIdx + direction;

    if (nextIdx >= 0 && nextIdx < inputs.length) {
      inputs[nextIdx].focus();
      inputs[nextIdx].scrollIntoView({ behavior: "smooth", block: "center" });
    }
  },

  showHelp() {
    document.querySelector(".shortcuts-modal")?.remove();

    const modal = document.createElement("div");
    modal.className = "shortcuts-modal modal";
    modal.style.display = "flex";
    modal.innerHTML = `
      <div class="shortcuts-content modal-content">
        <h3>Keyboard Shortcuts</h3>
        <div class="shortcut-list">
          <div><kbd>N</kbd> Next unanswered</div>
          <div><kbd>↑</kbd><kbd>↓</kbd> Previous/next question</div>
          <div><kbd>A</kbd> or <kbd>Ctrl+L</kbd> Toggle AI panel</div>
          <div><kbd>S</kbd> Shuffle questions</div>
          <div><kbd>C</kbd> or <kbd>Ctrl+Enter</kbd> Grade all</div>
          <div><kbd>V</kbd> Show answers</div>
          <div><kbd>R</kbd> Reset</div>
          <div><kbd>Esc</kbd> Blur input / close panel</div>
          <div><kbd>?</kbd> Show this help</div>
        </div>
        <button onclick="this.closest('.shortcuts-modal').remove()">Close</button>
      </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });
  },
};
