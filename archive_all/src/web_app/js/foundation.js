// Legacy foundations extracted from app.js for gradual modularization.

// ========== DISABLE BROWSER AUTOCOMPLETE ==========
(function disableAutocomplete() {
  function applyAutocompleteOff() {
    document.querySelectorAll("input, textarea").forEach((el) => {
      el.setAttribute("autocomplete", "off");
      el.setAttribute("autocorrect", "off");
      el.setAttribute("autocapitalize", "off");
      el.setAttribute("spellcheck", "false");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyAutocompleteOff);
  } else {
    applyAutocompleteOff();
  }

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) {
          if (node.tagName === "INPUT" || node.tagName === "TEXTAREA") {
            node.setAttribute("autocomplete", "off");
            node.setAttribute("autocorrect", "off");
            node.setAttribute("autocapitalize", "off");
            node.setAttribute("spellcheck", "false");
          }
          node.querySelectorAll?.("input, textarea").forEach((el) => {
            el.setAttribute("autocomplete", "off");
            el.setAttribute("autocorrect", "off");
            el.setAttribute("autocapitalize", "off");
            el.setAttribute("spellcheck", "false");
          });
        }
      });
    });
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
})();

// ========== LEARNING STATISTICS ==========
const LearningStats = (window.LearningStats = {
  sessionStart: Date.now(),
  correctStreak: 0,
  maxStreak: 0,
  totalAnswered: 0,
  totalCorrect: 0,
  STORAGE_KEY: "quiz_learning_stats",

  init() {
    this.sessionStart = Date.now();
    this.correctStreak = 0;
    this.totalAnswered = 0;
    this.totalCorrect = 0;
    this.loadFromStorage();
  },

  recordAnswer(isCorrect) {
    this.totalAnswered++;
    if (isCorrect) {
      this.totalCorrect++;
      this.correctStreak++;
      if (this.correctStreak > this.maxStreak) {
        this.maxStreak = this.correctStreak;
      }
      if (this.correctStreak === 5) {
        this.showStreakNotification("연속 5문제 정답!");
      } else if (this.correctStreak === 10) {
        this.showStreakNotification("연속 10문제 정답! 계속하세요!");
      }
    } else {
      this.correctStreak = 0;
    }
    this.saveToStorage();
    this.updateUI();
  },

  showStreakNotification(message) {
    const notification = document.createElement("div");
    notification.className = "streak-notification";
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.classList.add("show"), 10);
    setTimeout(() => {
      notification.classList.remove("show");
      setTimeout(() => notification.remove(), 300);
    }, 2000);
  },

  updateUI() {
    const streakEl = document.getElementById("streak-counter");
    if (streakEl) {
      streakEl.textContent = `연속 ${this.correctStreak}`;
      streakEl.style.display = this.correctStreak > 0 ? "inline-block" : "none";
    }
  },

  saveToStorage() {
    const data = {
      maxStreak: this.maxStreak,
      totalAnswered: this.totalAnswered,
      totalCorrect: this.totalCorrect,
      lastSession: Date.now(),
    };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
  },

  loadFromStorage() {
    try {
      const data = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || "{}");
      this.maxStreak = data.maxStreak || 0;
    } catch (e) {
      /* ignore */
    }
  },

  getAccuracy() {
    return this.totalAnswered > 0 ? Math.round((this.totalCorrect / this.totalAnswered) * 100) : 0;
  },
});

// ========== API RATE LIMITER ==========
const APIRateLimiter = (window.APIRateLimiter = {
  lastCall: 0,
  minInterval: 500,
  queue: [],

  async throttle(fn) {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCall;
    if (timeSinceLastCall < this.minInterval) {
      await new Promise((r) => setTimeout(r, this.minInterval - timeSinceLastCall));
    }
    this.lastCall = Date.now();
    return fn();
  },
});

// ========== ERROR RETRY LOGIC ==========
window.withRetry = async function withRetry(fn, maxRetries = 2, delay = 1000) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries) throw err;
      console.warn(`Retry ${i + 1}/${maxRetries}:`, err.message);
      await new Promise((r) => setTimeout(r, delay * (i + 1)));
    }
  }
};

// ========== DEBOUNCE UTILITY ==========
window.debounce = function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

// ========== STUDY TIMER (Pomodoro-style) ==========
const StudyTimer = (window.StudyTimer = {
  seconds: 0,
  intervalId: null,
  isRunning: false,

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalId = setInterval(() => {
      this.seconds++;
      this.updateUI();
      if (this.seconds === 25 * 60) {
        this.showBreakReminder();
      }
    }, 1000);
  },

  pause() {
    if (!this.isRunning) return;
    this.isRunning = false;
    clearInterval(this.intervalId);
  },

  reset() {
    this.pause();
    this.seconds = 0;
    this.updateUI();
  },

  updateUI() {
    const timerEl = document.getElementById("study-timer");
    if (timerEl) {
      const mins = Math.floor(this.seconds / 60);
      const secs = this.seconds % 60;
      timerEl.textContent = `타이머 ${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
  },

  showBreakReminder() {
    if (Notification.permission === "granted") {
      new Notification("휴식 알림", {
        body: "25분 집중했습니다. 5분 동안 스트레칭하세요.",
        icon: "/icon-192.png",
      });
    }
    const reminder = document.createElement("div");
    reminder.className = "break-reminder";
    reminder.innerHTML = `
      <div class="break-content">
        <span class="break-icon">☕</span>
        <strong>25분 집중 완료!</strong>
        <p>5분만 가볍게 쉬고 돌아오세요.</p>
        <button type="button" class="break-dismiss">닫기</button>
      </div>
    `;
    reminder.querySelector(".break-dismiss")?.addEventListener("click", () => reminder.remove());
    document.body.appendChild(reminder);
    setTimeout(() => reminder.classList.add("show"), 10);
  },
});

// ========== SESSION PROGRESS SAVER ==========
const SessionSaver = (window.SessionSaver = {
  STORAGE_KEY: "quiz_session_progress",

  save() {
    if (!window.currentSession) return;
    const progress = {
      timestamp: Date.now(),
      session: {
        title: window.currentSession.title,
        mode: window.currentSession.mode,
      },
      answers: this.collectAnswers(),
      score: window.sessionScore?.textContent || "0 / 0",
    };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(progress));
  },

  collectAnswers() {
    const answers = {};
    document
      .querySelectorAll("input.blank, textarea.definition-input, textarea.challenge-input, textarea.vocab-input")
      .forEach((el) => {
        if (el.dataset.key && el.value) {
          answers[el.dataset.key] = el.value;
        }
      });
    return answers;
  },

  restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || "{}");
      if (!saved.answers) return;
      if (Date.now() - saved.timestamp > 30 * 60 * 1000) return;
      Object.entries(saved.answers).forEach(([key, value]) => {
        const el = document.querySelector(`[data-key="${key}"]`);
        if (el && !el.value) el.value = value;
      });
    } catch (e) {
      /* ignore */
    }
  },

  clear() {
    localStorage.removeItem(this.STORAGE_KEY);
  },
});

// Auto-save every 30 seconds
setInterval(() => SessionSaver.save(), 30000);

// ========== GLOBAL KEYBOARD SHORTCUTS ==========
const KeyboardShortcuts = (window.KeyboardShortcuts = {
  enabled: true,

  init() {
    document.addEventListener("keydown", (e) => {
      if (!this.enabled) return;

      const key = (e.key || "").toLowerCase();
      const inInput = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");

      // Core grading shortcut
      if ((e.ctrlKey || e.metaKey) && key === "enter") {
        e.preventDefault();
        if (typeof checkAll === "function") checkAll();
        return;
      }

      // AI panel toggle should work even while typing
      if ((e.ctrlKey || e.metaKey) && key === "l") {
        e.preventDefault();
        if (typeof toggleAIPanel === "function") toggleAIPanel();
        return;
      }

      if (inInput) {
        if (key === "escape") {
          e.target.blur();
          if (typeof closeAIPanel === "function") closeAIPanel();
        }
        // Prevent stealing plain typing shortcuts while focused
        return;
      }

      switch (key) {
        case "a":
          if (typeof toggleAIPanel === "function") toggleAIPanel();
          break;
        case "r":
          if (e.ctrlKey || e.metaKey) return;
          document.getElementById("btn-reset")?.click();
          break;
        case "s":
          document.getElementById("btn-shuffle")?.click();
          break;
        case "k":
          if (e.ctrlKey || e.metaKey) return;
          document.getElementById("btn-check")?.click();
          break;
        case "n":
          this.focusNextUnanswered();
          break;
        case "?":
          this.showHelp();
          break;
        case "arrowdown":
          e.preventDefault();
          this.navigateQuestion(1);
          break;
        case "arrowup":
          e.preventDefault();
          this.navigateQuestion(-1);
          break;
      }
    });
  },

  focusNextUnanswered() {
    const inputs = document.querySelectorAll(
      "input.blank:not(.correct):not(.wrong), textarea.definition-input:not(:disabled), textarea.challenge-input:not(:disabled)"
    );
    for (const input of inputs) {
      if (!input.value.trim()) {
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        input.focus();
        return;
      }
    }
  },

  navigateQuestion(direction) {
    const cards = document.querySelectorAll(
      ".definition-card, .challenge-card, .vocab-card, .blank-card, .mc-question"
    );
    if (!cards.length) return;

    const currentFocused = document.activeElement?.closest(
      ".definition-card, .challenge-card, .vocab-card, .blank-card, .mc-question"
    );
    let currentIdx = Array.from(cards).indexOf(currentFocused);

    if (currentIdx === -1) currentIdx = direction > 0 ? -1 : cards.length;
    const nextIdx = Math.max(0, Math.min(cards.length - 1, currentIdx + direction));

    const nextCard = cards[nextIdx];
    nextCard.scrollIntoView({ behavior: "smooth", block: "center" });
    const input = nextCard.querySelector("input, textarea");
    if (input) input.focus();
  },

  showHelp() {
    const existing = document.querySelector(".shortcuts-modal");
    if (existing) {
      existing.remove();
      return;
    }

    const modal = document.createElement("div");
    modal.className = "shortcuts-modal";
    modal.innerHTML = `
      <div class="shortcuts-content">
        <h3>키보드 단축키</h3>
        <div class="shortcut-list">
          <div><kbd>N</kbd> 다음 미답 문제로 이동</div>
          <div><kbd>↑</kbd><kbd>↓</kbd> 이전/다음 문제</div>
          <div><kbd>A</kbd> AI 패널 토글</div>
          <div><kbd>S</kbd> 문제 섞기</div>
          <div><kbd>C</kbd> 전체 채점</div>
          <div><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 전체 채점 (입력 중)</div>
          <div><kbd>R</kbd> 초기화</div>
          <div><kbd>Esc</kbd> 입력 포커스 해제</div>
          <div><kbd>?</kbd> 이 도움말</div>
        </div>
        <button type="button" class="shortcuts-close">닫기</button>
      </div>
    `;
    modal.querySelector(".shortcuts-close")?.addEventListener("click", () => modal.remove());
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add("show"), 10);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });
  },
});

// ========== SOUND EFFECTS (disabled by default) ==========
const SoundEffects = (window.SoundEffects = {
  enabled: false,

  play(type) {
    if (!this.enabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "correct") {
        osc.frequency.value = 800;
        gain.gain.value = 0.1;
      } else if (type === "wrong") {
        osc.frequency.value = 300;
        gain.gain.value = 0.1;
      }

      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {
      /* ignore */
    }
  },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem("sound_effects", this.enabled);
    return this.enabled;
  },
});

// Initialize keyboard shortcuts and shortcut button
KeyboardShortcuts.init();
const btnShortcuts = document.getElementById("btn-shortcuts");
if (btnShortcuts) {
  btnShortcuts.addEventListener("click", () => KeyboardShortcuts.showHelp());
}
