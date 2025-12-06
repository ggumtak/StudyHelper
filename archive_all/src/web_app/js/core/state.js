/**
 * Global State Management
 * Centralized state for the entire application
 */

import { Storage } from "./utils.js";

// ========== APPLICATION STATE ==========
export const AppState = {
  session: null,
  mode: 0,
  inputs: [],
  answerKeyMap: {},
  reviewQueue: new Set(),
  challengeReviewQueue: new Set(),
  hideCompletedNav: false,
  isShuffled: false,
  modeStates: {
    1: null,
    2: null,
    3: null,
    4: null,
    5: null,
    6: null,
    7: null,
  },
};

// ========== LEARNING STATISTICS ==========
export const LearningStats = {
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
    const data = Storage.get(this.STORAGE_KEY, {});
    this.maxStreak = data.maxStreak || 0;
  },

  recordAnswer(isCorrect) {
    this.totalAnswered++;
    if (isCorrect) {
      this.totalCorrect++;
      this.correctStreak++;
      this.maxStreak = Math.max(this.maxStreak, this.correctStreak);

      if (this.correctStreak === 5 || this.correctStreak === 10) {
        this.showStreakNotification(this.correctStreak === 5 ? "🔥 5-correct streak!" : "🌟 10-correct streak!");
      }
    } else {
      this.correctStreak = 0;
    }
    this.save();
    this.updateUI();
  },

  showStreakNotification(message) {
    const notification = document.createElement("div");
    notification.className = "streak-notification";
    notification.textContent = message;
    document.body.appendChild(notification);
    requestAnimationFrame(() => notification.classList.add("show"));
    setTimeout(() => {
      notification.classList.remove("show");
      setTimeout(() => notification.remove(), 300);
    }, 2000);
  },

  updateUI() {
    const el = document.getElementById("streak-counter");
    if (el) {
      el.textContent = `Streak ${this.correctStreak}`;
      el.style.display = this.correctStreak > 0 ? "inline-block" : "none";
    }
  },

  save() {
    Storage.set(this.STORAGE_KEY, {
      maxStreak: this.maxStreak,
      totalAnswered: this.totalAnswered,
      totalCorrect: this.totalCorrect,
      lastSession: Date.now(),
    });
  },

  getAccuracy() {
    return this.totalAnswered > 0 ? Math.round((this.totalCorrect / this.totalAnswered) * 100) : 0;
  },
};

// ========== STUDY TIMER ==========
export const StudyTimer = {
  seconds: 0,
  intervalId: null,
  isRunning: false,

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalId = setInterval(() => {
      this.seconds++;
      this.updateUI();
      if (this.seconds > 0 && this.seconds % (25 * 60) === 0) {
        this.showBreakReminder();
      }
    }, 1000);
  },

  pause() {
    this.isRunning = false;
    clearInterval(this.intervalId);
  },

  reset() {
    this.pause();
    this.seconds = 0;
    this.updateUI();
  },

  updateUI() {
    const el = document.getElementById("study-timer");
    if (el) {
      const mins = Math.floor(this.seconds / 60);
      const secs = this.seconds % 60;
      el.textContent = `Timer ${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
  },

  showBreakReminder() {
    if (Notification.permission === "granted") {
      new Notification("Break time!", {
        body: "You studied for 25 minutes. Take a short break!",
        icon: "/icon-192.png",
      });
    }
  },
};

// ========== SESSION SAVER ==========
export const SessionSaver = {
  STORAGE_KEY: "quiz_session_progress",

  save() {
    if (!AppState.session) return;

    const answers = {};
    AppState.inputs.forEach((input, i) => {
      if (input.value) {
        answers[input.dataset.key || i] = input.value;
      }
    });

    Storage.set(this.STORAGE_KEY, {
      sessionId: AppState.session.title,
      mode: AppState.mode,
      answers,
      timestamp: Date.now(),
    });
  },

  restore() {
    const data = Storage.get(this.STORAGE_KEY);
    if (!data || !AppState.session) return;

    if (data.sessionId !== AppState.session.title) return;

    AppState.inputs.forEach((input, i) => {
      const key = input.dataset.key || i;
      if (data.answers[key]) {
        input.value = data.answers[key];
      }
    });
  },

  clear() {
    Storage.remove(this.STORAGE_KEY);
  },
};
