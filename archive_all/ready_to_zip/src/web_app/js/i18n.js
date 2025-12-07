/**
 * Lightweight UI i18n helper for Korean UI text.
 * All code stays in English; only user-facing strings are localized.
 */

const staticTextTargets = [
  ["#session-title", "세션을 불러와 시작하세요"],
  ["#streak-counter", "연속 0"],
  [".controls .badge", "Enter: 채우고 자동 이동"],
  [".controls .hint.emphasis", "Ctrl+Enter: 전체 채점 / Shift+Enter: 현재만 채점 (모드 3)"],
  ["#review-badge", "복습 0"],
  ["#blank-nav .nav-title", "빈칸 목록"],
  ["#blank-nav .nav-sub", "상태: 미답 / 정답 / 힌트 사용 / 오답"],
  ["#btn-show-nav", "목록"],
  ["#btn-toggle-nav", "목록 닫기"],
  [".toolbar .badge", "문제 코드"],
  [".toolbar-left .hint", "빈칸 자동 번호 + 코드 복사"],
  [".toolbar-right .hint", "Ctrl+L: AI 패널 토글"],
  [".answer-panel summary", "정답 / 해설 보기"],
  ["#btn-explain-selection", "선택 코드 설명"],
];

function setText(selector, text) {
  const elements = document.querySelectorAll(selector);
  elements.forEach((el) => {
    el.textContent = text;
  });
}

function applyStaticTexts() {
  staticTextTargets.forEach(([selector, text]) => setText(selector, text));
}

function patchLearningStats() {
  const stats = typeof LearningStats !== "undefined" ? LearningStats : globalThis.LearningStats;
  if (!stats) return;

  stats.showStreakNotification = function () {
    const streak = this.correctStreak;
    const message = streak >= 10 ? "연속 10문제 정답! 대단해요!" : "연속 5문제 정답! 잘하고 있어요!";
    const notification = document.createElement("div");
    notification.className = "streak-notification";
    notification.textContent = message;
    document.body.appendChild(notification);
    requestAnimationFrame(() => notification.classList.add("show"));
    setTimeout(() => {
      notification.classList.remove("show");
      setTimeout(() => notification.remove(), 300);
    }, 2000);
  };

  stats.updateUI = function () {
    const streakEl = document.getElementById("streak-counter");
    if (streakEl) {
      streakEl.textContent = `연속 ${this.correctStreak}`;
      streakEl.style.display = this.correctStreak > 0 ? "inline-block" : "none";
    }
  };
}

function patchStudyTimer() {
  const timer = typeof StudyTimer !== "undefined" ? StudyTimer : globalThis.StudyTimer;
  if (!timer) return;

  timer.updateUI = function () {
    const timerEl = document.getElementById("study-timer");
    if (timerEl) {
      const mins = Math.floor(this.seconds / 60);
      const secs = this.seconds % 60;
      timerEl.textContent = `타이머 ${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
      timerEl.title = "학습 타이머";
    }
  };

  timer.showBreakReminder = function () {
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
    requestAnimationFrame(() => reminder.classList.add("show"));
    setTimeout(() => reminder.remove(), 10000);
  };
}

export function applyKoreanUI() {
  patchLearningStats();
  patchStudyTimer();
}

// Expose static text helper for manual calls
export { applyStaticTexts };
