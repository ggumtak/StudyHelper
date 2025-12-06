// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('Service Worker registered'))
      .catch(err => console.log('SW registration failed:', err));
  });
}

// ========== DISABLE BROWSER AUTOCOMPLETE ==========
// Disable autocomplete on all inputs globally
(function disableAutocomplete() {
  // Apply to existing inputs
  function applyAutocompleteOff() {
    document.querySelectorAll('input, textarea').forEach(el => {
      el.setAttribute('autocomplete', 'off');
      el.setAttribute('autocorrect', 'off');
      el.setAttribute('autocapitalize', 'off');
      el.setAttribute('spellcheck', 'false');
    });
  }

  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAutocompleteOff);
  } else {
    applyAutocompleteOff();
  }

  // Watch for dynamically added inputs
  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
            node.setAttribute('autocomplete', 'off');
            node.setAttribute('autocorrect', 'off');
            node.setAttribute('autocapitalize', 'off');
            node.setAttribute('spellcheck', 'false');
          }
          node.querySelectorAll?.('input, textarea').forEach(el => {
            el.setAttribute('autocomplete', 'off');
            el.setAttribute('autocorrect', 'off');
            el.setAttribute('autocapitalize', 'off');
            el.setAttribute('spellcheck', 'false');
          });
        }
      });
    });
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });
})();

// ========== LEARNING STATISTICS ==========
const LearningStats = {
  // 세션 통계
  sessionStart: Date.now(),
  correctStreak: 0,
  maxStreak: 0,
  totalAnswered: 0,
  totalCorrect: 0,

  // LocalStorage 키
  STORAGE_KEY: 'quiz_learning_stats',

  // 통계 초기화
  init() {
    this.sessionStart = Date.now();
    this.correctStreak = 0;
    this.totalAnswered = 0;
    this.totalCorrect = 0;
    this.loadFromStorage();
  },

  // 정답 기록
  recordAnswer(isCorrect) {
    this.totalAnswered++;
    if (isCorrect) {
      this.totalCorrect++;
      this.correctStreak++;
      if (this.correctStreak > this.maxStreak) {
        this.maxStreak = this.correctStreak;
      }
      // 5연속 정답 시 축하 메시지
      if (this.correctStreak === 5) {
        this.showStreakNotification('🔥 5연속 정답!');
      } else if (this.correctStreak === 10) {
        this.showStreakNotification('🌟 10연속 정답! 대단해요!');
      }
    } else {
      this.correctStreak = 0;
    }
    this.saveToStorage();
    this.updateUI();
  },

  // 스트릭 알림
  showStreakNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'streak-notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.classList.add('show'), 10);
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 2000);
  },

  // UI 업데이트
  updateUI() {
    const streakEl = document.getElementById('streak-counter');
    if (streakEl) {
      streakEl.textContent = `🔥 ${this.correctStreak}`;
      streakEl.style.display = this.correctStreak > 0 ? 'inline-block' : 'none';
    }
  },

  // 저장/불러오기
  saveToStorage() {
    const data = {
      maxStreak: this.maxStreak,
      totalAnswered: this.totalAnswered,
      totalCorrect: this.totalCorrect,
      lastSession: Date.now()
    };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
  },

  loadFromStorage() {
    try {
      const data = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '{}');
      this.maxStreak = data.maxStreak || 0;
    } catch (e) { }
  },

  // 정확도
  getAccuracy() {
    return this.totalAnswered > 0
      ? Math.round((this.totalCorrect / this.totalAnswered) * 100)
      : 0;
  }
};

// ========== API RATE LIMITER ==========
const APIRateLimiter = {
  lastCall: 0,
  minInterval: 500, // 최소 0.5초 간격
  queue: [],

  async throttle(fn) {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCall;

    if (timeSinceLastCall < this.minInterval) {
      await new Promise(r => setTimeout(r, this.minInterval - timeSinceLastCall));
    }

    this.lastCall = Date.now();
    return fn();
  }
};

// ========== ERROR RETRY LOGIC ==========
async function withRetry(fn, maxRetries = 2, delay = 1000) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries) throw err;
      console.warn(`Retry ${i + 1}/${maxRetries}:`, err.message);
      await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
}

// ========== DEBOUNCE UTILITY ==========
function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

// ========== STUDY TIMER (Pomodoro-style) ==========
const StudyTimer = {
  seconds: 0,
  intervalId: null,
  isRunning: false,

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalId = setInterval(() => {
      this.seconds++;
      this.updateUI();
      // 25분마다 휴식 알림
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
    const timerEl = document.getElementById('study-timer');
    if (timerEl) {
      const mins = Math.floor(this.seconds / 60);
      const secs = this.seconds % 60;
      timerEl.textContent = `⏱️ ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
  },

  showBreakReminder() {
    if (Notification.permission === 'granted') {
      new Notification('🍅 25분 학습 완료!', {
        body: '5분 휴식을 권장합니다.',
        icon: '/icon-192.png'
      });
    }
    const reminder = document.createElement('div');
    reminder.className = 'break-reminder';
    reminder.innerHTML = `
      <div class="break-content">
        <span class="break-icon">🍅</span>
        <strong>25분 학습 완료!</strong>
        <p>잠시 휴식하고 오세요</p>
        <button onclick="this.parentElement.parentElement.remove()">확인</button>
      </div>
    `;
    document.body.appendChild(reminder);
    setTimeout(() => reminder.classList.add('show'), 10);
  }
};

// ========== SESSION PROGRESS SAVER ==========
const SessionSaver = {
  STORAGE_KEY: 'quiz_session_progress',

  save() {
    if (!currentSession) return;
    const progress = {
      timestamp: Date.now(),
      session: {
        title: currentSession.title,
        mode: currentSession.mode,
      },
      answers: this.collectAnswers(),
      score: sessionScore?.textContent || '0 / 0'
    };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(progress));
  },

  collectAnswers() {
    const answers = {};
    document.querySelectorAll('input.blank, textarea.definition-input, textarea.challenge-input, textarea.vocab-input').forEach(el => {
      if (el.dataset.key && el.value) {
        answers[el.dataset.key] = el.value;
      }
    });
    return answers;
  },

  restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '{}');
      if (!saved.answers) return;

      // 30분 이내의 저장만 복원
      if (Date.now() - saved.timestamp > 30 * 60 * 1000) return;

      Object.entries(saved.answers).forEach(([key, value]) => {
        const el = document.querySelector(`[data-key="${key}"]`);
        if (el && !el.value) el.value = value;
      });
    } catch (e) { }
  },

  clear() {
    localStorage.removeItem(this.STORAGE_KEY);
  }
};

// Auto-save every 30 seconds
setInterval(() => SessionSaver.save(), 30000);

// ========== GLOBAL KEYBOARD SHORTCUTS ==========
const KeyboardShortcuts = {
  enabled: true,

  init() {
    document.addEventListener('keydown', (e) => {
      if (!this.enabled) return;

      // Ctrl+Enter: 전체 채점 (입력 중에도 작동!)
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (typeof checkAll === 'function') checkAll();
        return;
      }

      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        // Escape: 입력 필드 탈출
        if (e.key === 'Escape') {
          e.target.blur();
          return;
        }
        return; // 다른 단축키는 입력 중에는 무시
      }

      // Global shortcuts
      switch (e.key.toLowerCase()) {
        case 'a':
          // A: AI 패널 토글
          if (typeof toggleAIPanel === 'function') toggleAIPanel();
          break;
        case 'r':
          // R: 리셋
          if (e.ctrlKey || e.metaKey) return; // Ctrl+R 새로고침은 허용
          document.getElementById('btn-reset')?.click();
          break;
        case 's':
          // S: 셔플
          document.getElementById('btn-shuffle')?.click();
          break;
        case 'k':
          if (e.ctrlKey || e.metaKey) return; // 복사 단축키와 충돌 방지
          // K: 전체 채점
          document.getElementById('btn-check')?.click();
          break;
        case 'n':
          // N: 다음 미답 문제로 이동
          this.focusNextUnanswered();
          break;
        case '?':
          // ?: 단축키 도움말
          this.showHelp();
          break;
        case 'arrowdown':
          e.preventDefault();
          this.navigateQuestion(1);
          break;
        case 'arrowup':
          e.preventDefault();
          this.navigateQuestion(-1);
          break;
      }
    });
  },

  focusNextUnanswered() {
    const inputs = document.querySelectorAll('input.blank:not(.correct):not(.wrong), textarea.definition-input:not(:disabled), textarea.challenge-input:not(:disabled)');
    for (const input of inputs) {
      if (!input.value.trim()) {
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus();
        return;
      }
    }
  },

  navigateQuestion(direction) {
    const cards = document.querySelectorAll('.definition-card, .challenge-card, .vocab-card, .blank-card, .mc-question');
    if (!cards.length) return;

    const currentFocused = document.activeElement?.closest('.definition-card, .challenge-card, .vocab-card, .blank-card, .mc-question');
    let currentIdx = Array.from(cards).indexOf(currentFocused);

    if (currentIdx === -1) currentIdx = direction > 0 ? -1 : cards.length;
    const nextIdx = Math.max(0, Math.min(cards.length - 1, currentIdx + direction));

    const nextCard = cards[nextIdx];
    nextCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const input = nextCard.querySelector('input, textarea');
    if (input) input.focus();
  },

  showHelp() {
    const existing = document.querySelector('.shortcuts-modal');
    if (existing) { existing.remove(); return; }

    const modal = document.createElement('div');
    modal.className = 'shortcuts-modal';
    modal.innerHTML = `
      <div class="shortcuts-content">
        <h3>⌨️ 키보드 단축키</h3>
        <div class="shortcut-list">
          <div><kbd>N</kbd> 다음 미답 문제로 이동</div>
          <div><kbd>↑</kbd><kbd>↓</kbd> 이전/다음 문제</div>
          <div><kbd>A</kbd> AI 패널 토글</div>
          <div><kbd>S</kbd> 순서 섞기</div>
          <div><kbd>C</kbd> 전체 채점</div>
          <div><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 전체 채점 (입력 중에도!)</div>
          <div><kbd>R</kbd> 리셋</div>
          <div><kbd>Esc</kbd> 입력 필드 탈출</div>
          <div><kbd>?</kbd> 이 도움말</div>
        </div>
        <button onclick="this.parentElement.parentElement.remove()">닫기</button>
      </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('show'), 10);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }
};

// ========== SOUND EFFECTS (disabled by default) ==========
const SoundEffects = {
  enabled: false,  // 기본값: 사용 안함

  play(type) {
    if (!this.enabled) return;
    // Simple beep using Web Audio API
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'correct') {
        osc.frequency.value = 800;
        gain.gain.value = 0.1;
      } else if (type === 'wrong') {
        osc.frequency.value = 300;
        gain.gain.value = 0.1;
      }

      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) { }
  },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('sound_effects', this.enabled);
    return this.enabled;
  }
};

// Initialize keyboard shortcuts
KeyboardShortcuts.init();

// 단축키 가이드 버튼
const btnShortcuts = document.getElementById("btn-shortcuts");
if (btnShortcuts) {
  btnShortcuts.addEventListener("click", () => KeyboardShortcuts.showHelp());
}

// Core UI refs
const codeArea = document.getElementById("code-area");
const sessionTitle = document.getElementById("session-title");
const sessionLang = document.getElementById("session-lang");
const sessionMode = document.getElementById("session-mode");
const sessionCount = document.getElementById("session-count");
const sessionScore = document.getElementById("session-score");
const sessionProgress = document.querySelector("#session-progress span");
const answerBlock = document.getElementById("answer-block");
const blankList = document.getElementById("blank-list");
const reviewBadge = document.getElementById("review-badge");

// AI Panel refs
const aiPanel = document.getElementById("ai-panel");
const explanationArea = document.getElementById("explanation-area");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const floatingExplain = document.getElementById("floating-explain");
const btnToggleCompleted = document.getElementById("btn-toggle-completed");

let currentSession = null;
let inputs = [];
let answerKeyMap = {};
let reviewQueue = new Set();
let challengeReviewQueue = new Set();
let hasAnswers = false;
let warnedMissingAnswers = false;
let hideCompletedNav = false;

// 사용된 위치 추적 (재생성 시 중복 방지)
let usedPositions = {}; // { "1": 3, "2": 1 } = 위치별 사용 횟수

const placeholderRegexFlex = /_{3,10}/g;
const placeholderRegexIndexed = /__\[(\d+)\]__/g;
const modeLabels = {
  1: "1. OOP 빈칸 채우기",
  2: "2. 자료구조 빈칸",
  3: "3. 백지 연습 (Whiteboard)",
  4: "4. 실전 모의고사",
  5: "5. OOP 정의 퀴즈",
  6: "6. 코드 작성 (전산수학)",
  7: "7. 영단어 훈련",
};

const missingAnswerMessage = "정답 키가 없어 채점할 수 없습니다. 세션을 다시 생성해 주세요.";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
let baseSystemPromptCache = null;

// Initialize learning stats
LearningStats.init();

// ========== API KEY MANAGEMENT ==========
function getApiKey() {
  return (localStorage.getItem("gemini_api_key") || "").trim();
}

function setApiKey(key) {
  localStorage.setItem("gemini_api_key", key);
}

function showApiKeyModal() {
  const modal = document.getElementById("api-key-modal");
  const input = document.getElementById("api-key-input");
  input.value = getApiKey();
  modal.style.display = "flex";
  input.focus();
}

function hideApiKeyModal() {
  document.getElementById("api-key-modal").style.display = "none";
}

// ========== GEMINI API ==========
async function loadBaseSystemPrompt() {
  if (baseSystemPromptCache !== null) return baseSystemPromptCache;
  try {
    const resp = await fetch("/data/gemini_system_prompt.txt?t=" + Date.now());
    if (resp.ok) {
      baseSystemPromptCache = await resp.text();
      return baseSystemPromptCache;
    }
  } catch (err) {
    console.warn("Failed to load base system prompt", err);
  }
  baseSystemPromptCache = "";
  return baseSystemPromptCache;
}

async function callGeminiAPI(prompt, systemInstruction = "", chatHistory = null) {
  const apiKey = getApiKey();
  if (!apiKey) {
    showApiKeyModal();
    throw new Error("API 키가 필요합니다.");
  }

  const basePrompt = await loadBaseSystemPrompt();
  const mergedSystemInstruction = [basePrompt, systemInstruction].filter(Boolean).join("\n\n");

  // 채팅 히스토리가 있으면 multi-turn 대화 구성
  let contents;
  if (chatHistory && chatHistory.length > 0) {
    // 이전 대화 + 현재 메시지
    contents = [
      ...chatHistory,
      { role: "user", parts: [{ text: prompt }] }
    ];
  } else {
    contents = [{ role: "user", parts: [{ text: prompt }] }];
  }

  const body = {
    contents: contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    }
  };

  if (mergedSystemInstruction) {
    body.systemInstruction = { parts: [{ text: mergedSystemInstruction }] };
  }

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "API 호출 실패");
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// ========== AI PANEL ==========
function toggleAIPanel() {
  const isOpen = aiPanel.classList.toggle("open");
  document.body.classList.toggle("panel-open", isOpen);
}

function openAIPanel() {
  aiPanel.classList.add("open");
  document.body.classList.add("panel-open");
}

function closeAIPanel() {
  aiPanel.classList.remove("open");
  document.body.classList.remove("panel-open");
}

// ========== EXPLAIN FEATURE ==========
async function explainBlank(key) {
  const answer = answerKeyMap[key];
  if (!answer) return;

  openAIPanel();

  const lines = (currentSession?.question || "").split("\n");
  const numbered = lines.map((ln, idx) => `${idx + 1}: ${ln}`).join("\n");
  const context = numbered.split("\n").slice(0, 120).join("\n");

  explanationArea.innerHTML = `<div class="explanation-loading">AI가 설명을 생성하고 있습니다...</div>`;

  const prompt = `빈칸 #${key}에 들어갈 답은 "${answer}"야. 아래 코드 맥락을 보고 정말 짧게 핵심만 알려줘.

코드 일부 (앞 120줄):
\`\`\`python
${context}
\`\`\`

형식 예시:
#3번에 뭐가 들어가야해 ?
-> 3번에는 리스트 비었는지 체크해서 빈 리스트면 "(빈 리스트)" 출력하고 종료하는 조건. if start == None:

규칙: 한두 줄, 바로 적용할 수 있는 힌트만. 장황한 설명 금지.`;

  try {
    const response = await callGeminiAPI(prompt, "친근하고 짧은 힌트만 주는 코치처럼, 1-2줄로 핵심만 말해줘.");
    explanationArea.innerHTML = `
      <div class="explanation-content">
        <strong style="color: var(--accent-2);">빈칸 #${key}: <code>${escapeHtml(answer)}</code></strong>
        <hr style="border: none; border-top: 1px solid var(--border); margin: 12px 0;">
        ${formatMarkdown(response)}
      </div>`;
  } catch (err) {
    explanationArea.innerHTML = `<div class="explanation-content" style="color: var(--red);">에러: ${err.message}</div>`;
  }
}

/**
 * Mode 2 빨간 물음표 - 왜 틀렸어요?
 */
async function explainWhyWrongBlank(key) {
  const answer = answerKeyMap[key];
  const input = document.querySelector(`input.blank[data-key="${key}"]`);
  const userAnswer = input?.value || '';

  if (!answer) return;

  openAIPanel();
  explanationArea.innerHTML = `<div class="explanation-loading">❓ 틀린 이유 분석 중...</div>`;

  const prompt = `학생이 빈칸 #${key}에 "${userAnswer}"라고 썼는데 정답은 "${answer}"야.

왜 틀렸는지 간단히 설명해줘:
1. 정답과 학생 답의 차이점
2. 왜 정답이 맞는지 1줄 설명`;

  try {
    const response = await callGeminiAPI(prompt, "차이점을 간결하게 설명해줘.");
    explanationArea.innerHTML = `
      <div class="explanation-content">
        <strong style="color: var(--red);">❓ 왜 틀렸나요?</strong>
        <p style="color: var(--muted); margin: 8px 0;">내 답: <code>${escapeHtml(userAnswer)}</code> → 정답: <code>${escapeHtml(answer)}</code></p>
        <hr style="border: none; border-top: 1px solid var(--border); margin: 12px 0;">
        ${formatMarkdown(response)}
      </div>`;
  } catch (err) {
    explanationArea.innerHTML = `<div class="explanation-content" style="color: var(--red);">에러: ${err.message}</div>`;
  }
}

async function explainSelection(text) {
  if (!text.trim()) return;

  openAIPanel();
  explanationArea.innerHTML = `<div class="explanation-loading">AI가 설명을 생성하고 있습니다...</div>`;

  // Determine language based on current mode
  const isMode1 = mode1State && mode1State.questions && mode1State.questions.length > 0;
  const language = isMode1 ? "C#" : (currentSession?.language || "Python");
  const languageCode = isMode1 ? "csharp" : "python";

  const prompt = `다음 ${language} 코드 조각에 대해 설명해주세요:

\`\`\`${languageCode}
${text}
\`\`\`

다음을 포함해서 설명해주세요:
1. 이 코드가 무엇을 하는지
2. 각 부분이 왜 필요한지
3. 어떤 상황에서 사용되는지`;

  try {
    const tutorContext = isMode1
      ? "당신은 친절한 C# 및 객체지향 프로그래밍 튜터입니다. 초보자가 이해하기 쉽게 설명해주세요."
      : "당신은 친절한 파이썬 프로그래밍 튜터입니다. 초보자가 이해하기 쉽게 설명해주세요.";

    const response = await callGeminiAPI(prompt, tutorContext);
    explanationArea.innerHTML = `
      <div class="explanation-content">
        <strong style="color: var(--accent);">💡 선택한 코드 설명</strong>
        <pre style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; margin: 8px 0; font-size: 12px; overflow-x: auto;">${escapeHtml(text)}</pre>
        <hr style="border: none; border-top: 1px solid var(--border); margin: 12px 0;">
        ${formatMarkdown(response)}
      </div>`;
  } catch (err) {
    explanationArea.innerHTML = `<div class="explanation-content" style="color: var(--red);">❌ 오류: ${err.message}</div>`;
  }
}

// ========== CHAT FEATURE ==========
// 채팅 히스토리 저장 (세션 유지)
let chatHistory = [];

// 새 채팅 세션 시작
function startNewChatSession() {
  chatHistory = [];
  chatMessages.innerHTML = `<div class="chat-message system">🆕 새 대화가 시작되었습니다</div>`;
}

// 채팅 히스토리 보기/숨기기
function toggleChatHistory() {
  if (chatHistory.length === 0) {
    alert('저장된 대화 기록이 없습니다.');
    return;
  }

  // 간단하게 히스토리 개수 표시
  const userMsgs = chatHistory.filter(h => h.role === 'user').length;
  const aiMsgs = chatHistory.filter(h => h.role === 'model').length;
  alert(`📜 대화 기록\n\n사용자 메시지: ${userMsgs}개\nAI 응답: ${aiMsgs}개\n\n총 ${chatHistory.length}개의 메시지가 저장되어 있습니다.`);
}

async function sendChatMessage() {
  const message = chatInput.value.trim();
  if (!message) return;

  // Add user message to UI
  addChatMessage(message, "user");
  chatInput.value = "";

  // Add loading indicator
  const loadingId = Date.now();
  chatMessages.innerHTML += `<div class="chat-message assistant" id="loading-${loadingId}">🤔 생각 중...</div>`;
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Build context with question information (첫 메시지에만)
  let context = "";
  if (chatHistory.length === 0) {
    // If parsed quiz mode, include question list for AI to understand question numbers
    if (currentSession?.answer_key?._questions && currentQuestions.length > 0) {
      const questionList = currentQuestions.map((q, idx) => {
        const displayIdx = idx + 1;  // 현재 표시 순서 (1, 2, 3...)
        const qId = q.id;            // 전역 고유 ID
        const qType = q.type === "short_answer" ? "단답형" :
          q.type === "fill_blank" ? "빈칸" : "객관식";
        const codeSnippet = q.code ? `\n코드: ${q.code.slice(0, 100)}...` : "";
        return `${displayIdx}번 [Q${qId}] ${qType}: ${q.text.slice(0, 80)}${codeSnippet}`;
      }).join("\n");

      context = `현재 문제 목록 (총 ${currentQuestions.length}개):\n---\n${questionList}\n---\n`;
    } else if (currentSession?.question) {
      context = `현재 학습 중인 코드:\n\`\`\`python\n${currentSession.question.slice(0, 2000)}\n\`\`\``;
    }
  }

  // Check if user is asking about a specific question number
  const numMatch = message.match(/(\d+)\s*번/);
  if (numMatch && currentQuestions.length > 0) {
    const qNum = parseInt(numMatch[1]);
    if (qNum >= 1 && qNum <= currentQuestions.length) {
      const targetQ = currentQuestions[qNum - 1];
      context += `\n\n🎯 ${qNum}번 문제 상세:
- 전역 ID: [Q${targetQ.id}]
- 유형: ${targetQ.type}
- 문제: ${targetQ.text}
${targetQ.code ? `- 코드:\n\`\`\`python\n${targetQ.code}\n\`\`\`` : ""}
${targetQ.options ? `- 선지:\n${targetQ.options.map(o => `  ${o.num}. ${o.text}`).join("\n")}` : ""}
${targetQ.correct ? `- 정답: ${targetQ.correct}번` : ""}
`;
    }
  }

  const prompt = context ? `${context}\n\n학생의 질문: ${message}` : message;

  try {
    // 채팅 히스토리와 함께 API 호출 (대화 맥락 유지)
    const response = await callGeminiAPI(prompt, "", chatHistory);

    // 히스토리에 현재 대화 추가
    chatHistory.push({ role: "user", parts: [{ text: prompt }] });
    chatHistory.push({ role: "model", parts: [{ text: response }] });

    // 히스토리가 너무 길면 오래된 것 제거 (최근 20개 유지)
    if (chatHistory.length > 40) {
      chatHistory = chatHistory.slice(-40);
    }

    document.getElementById(`loading-${loadingId}`).outerHTML =
      `<div class="chat-message assistant">${formatMarkdown(response)}</div>`;
  } catch (err) {
    document.getElementById(`loading-${loadingId}`).outerHTML =
      `<div class="chat-message error">❌ ${err.message}</div>`;
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addChatMessage(text, role) {
  const div = document.createElement("div");
  div.className = `chat-message ${role}`;
  div.innerHTML = role === "user" ? escapeHtml(text) : formatMarkdown(text);
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function formatMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre style="background:rgba(0,0,0,0.3);padding:8px;border-radius:6px;overflow-x:auto;font-size:12px;">$2</pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

// ========== REGENERATE BLANKS ==========
// 이전 빈칸 정답들 저장 (중복 체크용)
let previousAnswers = new Set();

async function regenerateBlanks() {
  // Mode 1 (C# OOP 빈칸)인 경우 메시지 표시
  if (mode1State && mode1State.questions && mode1State.questions.length > 0) {
    alert('Mode 1에서는 파일/모드 버튼으로 다시 로드해주세요.');
    return;
  }

  if (!currentSession?.answer) {
    alert("정답 코드가 없어 새 빈칸을 생성할 수 없습니다.");
    return;
  }

  // 모달 요소 찾기
  let modal = document.getElementById("regenerate-modal");

  // 모달이 없으면 동적으로 생성 (방어 코드)
  if (!modal) {
    const modalHtml = `
      <div id="regenerate-modal" class="modal" style="display:none;">
        <div class="modal-content">
          <h3>🔄 새 빈칸 생성</h3>
          <p>생성할 빈칸의 개수를 입력하세요 (10~100)</p>
          <input type="number" id="regen-count-input" value="50" min="10" max="100" />
          <div class="modal-actions">
            <button id="btn-confirm-regen">생성하기</button>
            <button id="btn-cancel-regen">취소</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML("beforeend", modalHtml);
    modal = document.getElementById("regenerate-modal");
  }

  // 이벤트 리스너 연결 (중복 방지 - 한 번만 등록)
  const btnConfirm = document.getElementById("btn-confirm-regen");
  const btnCancel = document.getElementById("btn-cancel-regen");
  const input = document.getElementById("regen-count-input");

  if (btnConfirm && !btnConfirm.dataset.listenerAttached) {
    btnConfirm.dataset.listenerAttached = "true";
    btnConfirm.addEventListener("click", () => {
      const count = parseInt(input.value, 10);
      executeRegenerate(count);
      modal.style.display = "none";
    });
  }

  if (btnCancel && !btnCancel.dataset.listenerAttached) {
    btnCancel.dataset.listenerAttached = "true";
    btnCancel.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  // 모달 열기
  if (modal) {
    modal.style.display = "flex";
    if (input) input.focus();
  }
}

async function executeRegenerate(targetCount) {
  if (isNaN(targetCount) || targetCount < 5) targetCount = 20;
  if (targetCount > 100) targetCount = 100;

  openAIPanel();
  explanationArea.innerHTML = `<div class="explanation-loading">새로운 빈칸 ${targetCount}개를 생성하고 있습니다...</div>`;

  // 현재 정답들을 이전 정답에 저장
  const currentAnswers = new Set(Object.values(answerKeyMap));

  try {
    // 로컬에서 빈칸 생성 (API보다 안정적)
    const result = generateBlanksLocally(currentSession.answer, targetCount, currentAnswers, 5);

    if (result.answerKey && Object.keys(result.answerKey).length > 0) {
      // 이전 정답 업데이트
      previousAnswers = currentAnswers;

      // Update session
      currentSession.question = result.question;
      currentSession.answer_key = result.answerKey;
      answerKeyMap = result.answerKey;

      // Debug logs


      // Re-render
      renderQuestion(result.question, result.answerKey, currentSession.language);

      // Force update session count display
      if (sessionCount) {
        sessionCount.textContent = inputs.length;
      }

      const duplicateCount = result.duplicates;
      explanationArea.innerHTML = `
        <div class="explanation-content">
          <strong style="color: var(--green);">✅ 새 빈칸 ${Object.keys(result.answerKey).length}개 생성!</strong>
          <p>이전 문제와 중복: ${duplicateCount}개</p>
          <p style="color: var(--muted); font-size: 12px;">새로운 위치에 빈칸이 생성되었습니다.</p>
        </div>`;
    } else {
      throw new Error("빈칸 생성 실패");
    }
  } catch (err) {
    console.error("Regenerate error:", err);
    explanationArea.innerHTML = `
      <div class="explanation-content" style="color: var(--red);">
        ❌ ${err.message}
        <p style="color: var(--muted); margin-top: 8px;">다시 시도해주세요.</p>
      </div>`;
  }
}

// 모달 이벤트 리스너 설정
document.addEventListener("DOMContentLoaded", () => {
  const regenModal = document.getElementById("regenerate-modal");
  const btnConfirmRegen = document.getElementById("btn-confirm-regen");
  const btnCancelRegen = document.getElementById("btn-cancel-regen");
  const regenInput = document.getElementById("regen-count-input");

  if (btnConfirmRegen) {
    btnConfirmRegen.addEventListener("click", () => {
      const count = parseInt(regenInput.value, 10);
      executeRegenerate(count);
      regenModal.style.display = "none";
    });
  }

  if (btnCancelRegen) {
    btnCancelRegen.addEventListener("click", () => {
      regenModal.style.display = "none";
    });
  }
});

/**
 * 로컬에서 빈칸 생성 (API 없이)
 * @param {string} code - 정답 코드
 * @param {number} targetCount - 목표 빈칸 수
 * @param {Set} previousAnswers - 이전 정답들 (중복 체크용)
 * @param {number} maxDuplicates - 최대 중복 허용 수
 */
function generateBlanksLocally(code, targetCount, previousAnswers, maxDuplicates) {
  const lines = code.split("\n");
  const answerKey = {};
  let blankCount = 0;
  let duplicateCount = 0;

  // 정답 유효성 검사 함수
  function isValidAnswer(ans) {
    if (!ans || ans.length <= 1) return false;

    // 특수기호만 있으면 제외
    const specialOnly = new Set("()[]{}:,;'\"` ");
    if ([...ans].every(c => specialOnly.has(c))) return false;

    // 따옴표와 공백만 있어도 제외 (예: ' ', "")
    if (/^['\"]\s*['"]?\)?$/.test(ans)) return false;

    // 숫자나 알파벳이 최소 하나는 있어야 함
    if (!/[a-zA-Z0-9_]/.test(ans)) return false;

    return true;
  }

  // 정답 정리 함수 (후행 괄호/쉼표 제거)
  function cleanAnswer(ans) {
    let cleaned = ans.trim();
    while (cleaned.endsWith(')') || cleaned.endsWith(',') || cleaned.endsWith(';')) {
      if (cleaned.endsWith(')')) {
        const openCount = (cleaned.match(/\(/g) || []).length;
        const closeCount = (cleaned.match(/\)/g) || []).length;
        if (closeCount > openCount) {
          cleaned = cleaned.slice(0, -1).trim();
        } else {
          break;
        }
      } else {
        cleaned = cleaned.slice(0, -1).trim();
      }
    }
    return cleaned;
  }

  // 빈칸 후보들을 먼저 수집
  const candidates = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trim();

    // 건너뛸 줄들
    if (!stripped ||
      stripped.startsWith("def ") ||
      stripped.startsWith("class ") ||
      stripped.startsWith("import ") ||
      stripped.startsWith("from ") ||
      stripped.startsWith("#") ||
      stripped.startsWith('"""') ||
      stripped.startsWith("'''")) {
      continue;
    }

    // 대입문 패턴: = 뒤의 값
    const assignMatch = line.match(/=\s*([^#\n=]+)$/);
    if (assignMatch) {
      const rawAns = assignMatch[1].trim();
      const ans = cleanAnswer(rawAns);
      if (isValidAnswer(ans)) {
        candidates.push({
          lineIndex: i,
          answer: ans,
          type: "assign",
          isDuplicate: previousAnswers.has(ans)
        });
      }
    }

    // return 문
    const returnMatch = line.match(/return\s+([^#\n]+)$/);
    if (returnMatch) {
      const rawAns = returnMatch[1].trim();
      const ans = cleanAnswer(rawAns);
      if (isValidAnswer(ans)) {
        candidates.push({
          lineIndex: i,
          answer: ans,
          type: "return",
          isDuplicate: previousAnswers.has(ans)
        });
      }
    }

    // while 조건
    const whileMatch = line.match(/while\s+([^:]+):/);
    if (whileMatch) {
      const ans = whileMatch[1].trim();
      if (isValidAnswer(ans)) {
        candidates.push({
          lineIndex: i,
          answer: ans,
          type: "while",
          isDuplicate: previousAnswers.has(ans)
        });
      }
    }

    // if 조건
    const ifMatch = line.match(/if\s+([^:]+):/);
    if (ifMatch) {
      const ans = ifMatch[1].trim();
      if (isValidAnswer(ans)) {
        candidates.push({
          lineIndex: i,
          answer: ans,
          type: "if",
          isDuplicate: previousAnswers.has(ans)
        });
      }
    }
  }

  // 중복이 아닌 것들 먼저, 그 다음 중복 (최대 maxDuplicates개)
  const nonDuplicates = candidates.filter(c => !c.isDuplicate);
  const duplicates = candidates.filter(c => c.isDuplicate);

  // 셔플 함수
  const shuffle = arr => arr.sort(() => Math.random() - 0.5);

  // 비중복 섞기
  shuffle(nonDuplicates);
  shuffle(duplicates);

  // 선택할 후보들
  const selected = [];
  const usedLines = new Set();

  // 비중복 먼저 추가
  for (const c of nonDuplicates) {
    if (selected.length >= targetCount) break;
    if (usedLines.has(c.lineIndex)) continue; // 한 줄에 하나만
    selected.push(c);
    usedLines.add(c.lineIndex);
  }

  // 부족하면 중복에서 추가 (최대 maxDuplicates개)
  let addedDuplicates = 0;
  for (const c of duplicates) {
    if (selected.length >= targetCount) break;
    if (addedDuplicates >= maxDuplicates) break;
    if (usedLines.has(c.lineIndex)) continue;
    selected.push(c);
    usedLines.add(c.lineIndex);
    addedDuplicates++;
  }

  // 라인 순서대로 정렬
  selected.sort((a, b) => a.lineIndex - b.lineIndex);

  // 빈칸 적용 - __[N]__ 형식으로 생성 (인덱스형 빈칸)
  const newLines = [...lines];
  for (const item of selected) {
    blankCount++;
    const key = String(blankCount);
    answerKey[key] = item.answer;
    if (item.isDuplicate) duplicateCount++;

    // 해당 줄에서 값을 __[N]__로 치환 (인덱스형 빈칸)
    const line = newLines[item.lineIndex];
    const escaped = item.answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blankMarker = `__[${key}]__`;
    newLines[item.lineIndex] = line.replace(new RegExp(escaped), blankMarker);
  }

  return {
    question: newLines.join("\n"),
    answerKey: answerKey,
    duplicates: duplicateCount
  };
}

// ========== TEXT SELECTION FOR EXPLAIN ==========
let lastSelection = "";

document.addEventListener("mouseup", (e) => {
  const selection = window.getSelection();
  const text = selection.toString().trim();

  if (text && text.length > 3 && codeArea.contains(selection.anchorNode)) {
    lastSelection = text;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    floatingExplain.style.left = `${rect.left + window.scrollX}px`;
    floatingExplain.style.top = `${rect.bottom + window.scrollY + 5}px`;
    floatingExplain.style.display = "block";
  } else if (!floatingExplain.contains(e.target)) {
    floatingExplain.style.display = "none";
  }
});

document.addEventListener("mousedown", (e) => {
  if (!floatingExplain.contains(e.target)) {
    floatingExplain.style.display = "none";
  }
});

// ========== EVENT LISTENERS (Initialization) ==========
// These run immediately - essential for file loading

// File upload button
const btnUpload = document.getElementById("btn-upload");
if (btnUpload) {
  btnUpload.addEventListener("click", () => {
    document.getElementById("file-input").click();
  });
}

const fileInput = document.getElementById("file-input");
if (fileInput) {
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        setSession(data);
      } catch (err) {
        alert("JSON 파싱 실패: " + err.message);
      }
    };
    reader.readAsText(file, "utf-8");
  });
}

// Control buttons - with null checks for safety
const btnCheck = document.getElementById("btn-check");
if (btnCheck) btnCheck.addEventListener("click", () => checkAll());

const btnReveal = document.getElementById("btn-reveal");
if (btnReveal) btnReveal.addEventListener("click", () => revealAll());

const btnReset = document.getElementById("btn-reset");
if (btnReset) btnReset.addEventListener("click", () => resetInputs());

const btnReview = document.getElementById("btn-review");
if (btnReview) btnReview.addEventListener("click", () => startReviewCycle());

if (btnToggleCompleted) {
  btnToggleCompleted.addEventListener("click", () => {
    hideCompletedNav = !hideCompletedNav;
    btnToggleCompleted.textContent = hideCompletedNav ? "완료 보이기" : "완료 숨기기";
    applyNavFilter();
  });
}

const btnRegenerate = document.getElementById("btn-regenerate");
if (btnRegenerate) btnRegenerate.addEventListener("click", () => regenerateBlanks());

const btnShuffle = document.getElementById("btn-shuffle");
if (btnShuffle) btnShuffle.addEventListener("click", () => toggleShuffle());

// 모드별로 노출할 컨트롤 버튼 매핑
const controlButtonsByMode = {
  1: ["btn-check", "btn-reveal", "btn-reset", "btn-review", "btn-toggle-completed", "btn-regenerate", "btn-shuffle"],
  2: ["btn-check", "btn-reveal", "btn-reset", "btn-review", "btn-toggle-completed", "btn-regenerate", "btn-shuffle"],
  3: ["btn-check", "btn-reveal", "btn-reset", "btn-review", "btn-toggle-completed"],
  4: ["btn-shuffle"],
  5: ["btn-check", "btn-reset", "btn-review", "btn-shuffle"],
  6: [],
  7: ["btn-check", "btn-reset", "btn-shuffle"],
};

function updateControlButtonsForMode(mode) {
  const controlIds = [
    "btn-check",
    "btn-reveal",
    "btn-reset",
    "btn-review",
    "btn-toggle-completed",
    "btn-regenerate",
    "btn-shuffle",
  ];
  const allowed = new Set(controlButtonsByMode[mode] || controlIds);
  controlIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = allowed.has(id) ? "" : "none";
  });
}

const btnScrollTop = document.getElementById("btn-scroll-top");
if (btnScrollTop) {
  btnScrollTop.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

// API Key modal - with null checks
const btnApiKey = document.getElementById("btn-api-key");
if (btnApiKey) btnApiKey.addEventListener("click", showApiKeyModal);

const btnShutdown = document.getElementById("btn-shutdown");
if (btnShutdown) {
  btnShutdown.addEventListener("click", async () => {
    if (!confirm("서버를 종료할까요? (브라우저만 닫아도 서버는 계속 실행됩니다)")) return;
    btnShutdown.disabled = true;
    btnShutdown.textContent = "종료 요청...";
    try {
      await fetch("/shutdown", { method: "POST" });
      btnShutdown.textContent = "서버 종료됨";
    } catch (e) {
      alert("서버 종료 요청 실패: " + e.message);
      btnShutdown.disabled = false;
      btnShutdown.textContent = "⛔ 서버 종료";
    }
  });
}

const btnSaveApiKey = document.getElementById("btn-save-api-key");
if (btnSaveApiKey) {
  btnSaveApiKey.addEventListener("click", async () => {
    const key = document.getElementById("api-key-input").value.trim();
    if (key) {
      // 로컬 저장
      setApiKey(key);

      // 서버에 영구 저장 (키 파일에 기록)
      try {
        const response = await fetch('/api/save-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: key })
        });
        const result = await response.json();
        if (result.success) {
          alert('✅ API 키가 서버에 저장되었습니다.\n다음 실행에서도 자동 적용됩니다.');
        } else {
          console.warn('서버 저장 실패:', result.error);
        }
      } catch (err) {
        console.warn('서버 저장 오류:', err);
      }

      hideApiKeyModal();
    }
  });
}

const btnCancelApiKey = document.getElementById("btn-cancel-api-key");
if (btnCancelApiKey) btnCancelApiKey.addEventListener("click", hideApiKeyModal);

// 모바일 AI 토글 버튼
const aiToggleBtn = document.getElementById("btn-ai-toggle");
if (aiToggleBtn) {
  aiToggleBtn.addEventListener("click", () => {
    toggleAIPanel();
    aiToggleBtn.classList.toggle("panel-open", aiPanel.classList.contains("open"));
  });
}

// Scroll button visibility
window.addEventListener("scroll", () => {
  const btn = document.getElementById("btn-scroll-top");
  if (!btn) return;
  if (window.scrollY > 120) btn.classList.add("show");
  else btn.classList.remove("show");
});

// AI Panel close button - with null check
const btnClosePanel = document.getElementById("btn-close-panel");
if (btnClosePanel) btnClosePanel.addEventListener("click", closeAIPanel);

// Ctrl+L keyboard shortcut for AI panel
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "l") {
    e.preventDefault();
    toggleAIPanel();
  }
});

// Chat input - with null checks
const btnSendChat = document.getElementById("btn-send-chat");
if (btnSendChat) btnSendChat.addEventListener("click", sendChatMessage);

if (chatInput) {
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
}

// Floating explain button - with null check
const btnExplainSelection = document.getElementById("btn-explain-selection");
if (btnExplainSelection) {
  btnExplainSelection.addEventListener("click", () => {
    floatingExplain.style.display = "none";
    explainSelection(lastSelection);
  });
}

// ========== UTILITY FUNCTIONS ==========
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pickFirstCodeBlock(text) {
  if (!text) return "";
  const match = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (match) return match[1].trim();
  return text.trim();
}

function flattenAnswerKey(rawKey) {
  if (!rawKey || typeof rawKey !== "object") return {};
  if ("answer_key" in rawKey && typeof rawKey.answer_key === "object") {
    rawKey = rawKey.answer_key;
  }
  const normalized = {};
  Object.entries(rawKey).forEach(([k, v]) => {
    // 숫자 키 또는 _로 시작하는 특수 키 유지
    if (/^\d+$/.test(k) || k.startsWith("_")) {
      normalized[String(k)] = v;
    }
  });
  return normalized;
}

function extractAnswerKeyFromMarkdown(text) {
  if (!text) return {};
  const jsonBlocks = text.match(/```json\s*([\s\S]*?)\s*```/g) || [];
  for (const block of jsonBlocks) {
    const jsonContent = block.replace(/```json\s*/g, '').replace(/\s*```/g, '');
    try {
      const parsed = JSON.parse(jsonContent);
      const keys = Object.keys(parsed);
      if (keys.length > 0 && keys.every(k => /^\d+$/.test(k) || k === "answer_key")) {
        if (parsed.answer_key) {
          return flattenAnswerKey(parsed.answer_key);
        }
        return flattenAnswerKey(parsed);
      }
    } catch (e) {
      continue;
    }
  }
  return {};
}

function deriveAnswerKeyFromAnswer(question, answer) {
  if (!question || !answer || answer.includes("Parsing failed")) return {};
  const keys = [];
  let seqCounter = 0;
  const escapeForRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patternParts = [];
  let lastIndex = 0;
  const regex = /__\[(\d+)\]__|_{3,10}/g;
  let match;
  while ((match = regex.exec(question)) !== null) {
    const [fullMatch, idx] = match;
    patternParts.push(escapeForRegex(question.slice(lastIndex, match.index)));
    if (idx !== undefined) {
      keys.push(String(idx));
    } else {
      seqCounter += 1;
      keys.push(String(seqCounter));
    }
    patternParts.push("(.+?)");
    lastIndex = regex.lastIndex;
  }
  patternParts.push(escapeForRegex(question.slice(lastIndex)));
  const pattern = "^" + patternParts.join("") + "$";
  try {
    const compiled = new RegExp(pattern, "s");
    const found = answer.match(compiled);
    if (!found) return {};
    const derived = {};
    keys.forEach((key, i) => {
      if (!(key in derived)) {
        derived[key] = (found[i + 1] || "").trim();
      }
    });
    return derived;
  } catch (e) {
    return {};
  }
}

function countPlaceholders(questionText) {
  if (!questionText) return 0;
  placeholderRegexFlex.lastIndex = 0;
  placeholderRegexIndexed.lastIndex = 0;
  const seqCount = (questionText.match(placeholderRegexFlex) || []).length;
  const idxCount = (questionText.match(placeholderRegexIndexed) || []).length;
  return seqCount + idxCount;
}

function reconstructAnswer(question, answerKey) {
  if (!question || !answerKey || Object.keys(answerKey).length === 0) return "";
  let counter = 0;
  let reconstructed = question.replace(/__\[(\d+)\]__|_{3,10}/g, (match, idx) => {
    let key;
    if (idx !== undefined) {
      key = String(idx);
    } else {
      counter += 1;
      key = String(counter);
    }
    return answerKey[key] !== undefined ? answerKey[key] : match;
  });
  return reconstructed;
}

function normalizeSession(session) {
  let questionRaw = session.question ?? session.question_text ?? session.questionText ?? "";
  const questionCode = pickFirstCodeBlock(questionRaw);
  let answerRaw = session.answer ?? session.answer_text ?? session.answerText ?? "";
  let answerKey = flattenAnswerKey(session.answer_key || session.answerKey || {});

  if (Object.keys(answerKey).length === 0) {
    const extracted = extractAnswerKeyFromMarkdown(session.question_text || session.questionText || "");
    if (Object.keys(extracted).length > 0) {
      answerKey = extracted;
    }
  }

  let answerCode = pickFirstCodeBlock(answerRaw);
  if (!answerCode || answerCode.includes("Parsing failed")) {
    if (questionCode && Object.keys(answerKey).length > 0) {
      answerCode = reconstructAnswer(questionCode, answerKey);
    }
  }

  if (Object.keys(answerKey).length === 0 && answerCode && !answerCode.includes("Parsing failed")) {
    const derived = deriveAnswerKeyFromAnswer(questionCode, answerCode);
    if (Object.keys(derived).length > 0) {
      answerKey = derived;
    }
  }

  placeholderRegexIndexed.lastIndex = 0;
  placeholderRegexFlex.lastIndex = 0;

  return {
    title: session.title || "제목 없음",
    language: session.language === "text" ? "python" : (session.language || "python"),
    mode: session.mode || "-",
    question: questionCode,
    answer: answerCode,
    answer_key: answerKey,
  };
}

function loadSessionFromUrl(url, fallback = true) {
  fetch(url + "?t=" + Date.now())
    .then((r) => {
      if (!r.ok) throw new Error("세션을 불러오지 못했습니다.");
      return r.json();
    })
    .then((data) => setSession(data))
    .catch((err) => {
      console.warn(err.message);
      if (fallback && url !== "sample_session.json") {
        loadSessionFromUrl("sample_session.json", false);
      } else {
        alert(err.message);
      }
    });
}

// === Mode 2 인라인 빈칸 변환 ===
function buildInlineBlankCode(originalCode, blanks, answerKey) {
  /**
   * 원본 코드와 빈칸 정보를 받아서 __[N]__ 형식의 인라인 빈칸 코드로 변환
   * blanks: [{line_num, answer, full_line, context}, ...]
   */
  const lines = originalCode.split('\n');

  const blanksByLine = {};

  // 라인별로 빈칸 그룹화
  blanks.forEach((blank, idx) => {
    const lineNum = blank.line_num;  // 1-indexed
    if (!blanksByLine[lineNum]) {
      blanksByLine[lineNum] = [];
    }
    blanksByLine[lineNum].push({
      blankNum: idx + 1,
      answer: blank.answer
    });
  });



  let replacedCount = 0;
  let failedCount = 0;

  // 각 라인 처리
  const resultLines = lines.map((line, idx) => {
    const lineNum = idx + 1;  // 1-indexed
    if (!blanksByLine[lineNum]) return line;

    let modifiedLine = line;
    const blanksForLine = blanksByLine[lineNum];

    // 해당 라인의 모든 빈칸 처리 (역순으로 처리해서 인덱스 꼬임 방지)
    blanksForLine.sort((a, b) => b.blankNum - a.blankNum);

    for (const blank of blanksForLine) {
      const answer = blank.answer;
      const blankMarker = `__[${blank.blankNum}]__`;

      // 정답 위치 찾아서 빈칸으로 교체
      const answerIndex = modifiedLine.indexOf(answer);
      if (answerIndex !== -1) {
        modifiedLine = modifiedLine.slice(0, answerIndex) + blankMarker + modifiedLine.slice(answerIndex + answer.length);
        replacedCount++;
      } else {
        // 정답을 찾지 못한 경우, 라인 끝에 마커 추가 (fallback)
        console.warn(`[Blank ${blank.blankNum}] Answer not found in line ${lineNum}: "${answer}" in "${line}"`);
        failedCount++;
      }
    }

    return modifiedLine;
  });



  return resultLines.join('\n');
}

// === Mode 3 인라인 빈칸 변환 (함수 본문을 빈칸으로) ===
function buildInlineChallengeCode(originalCode, challenges, answerKey) {
  /**
   * 원본 코드와 챌린지 정보를 받아서 함수 본문을 __[N]__ 형식으로 변환
   * challenges: [{signature, body, line_num}, ...]
   */
  const lines = originalCode.split('\n');
  let challengeNum = 0;
  let resultLines = [...lines];

  // 각 챌린지(함수)별로 처리
  challenges.forEach((ch, idx) => {
    challengeNum = idx + 1;
    const signature = ch.signature;
    const body = ch.body;

    // 시그니처 라인 찾기
    let sigLineIdx = -1;
    for (let i = 0; i < resultLines.length; i++) {
      if (resultLines[i].trim().startsWith(signature.trim().split('(')[0])) {
        sigLineIdx = i;
        break;
      }
    }

    if (sigLineIdx !== -1) {
      // 함수 본문 라인들을 빈칸으로 교체
      const bodyLines = body.split('\n').filter(l => l.trim());
      if (bodyLines.length > 0) {
        // 첫 번째 본문 라인 인덱스 찾기 (시그니처 다음 라인들)
        let bodyStartIdx = sigLineIdx + 1;
        let bodyEndIdx = bodyStartIdx;

        // 본문 끝 찾기 (들여쓰기 기준)
        const sigIndent = resultLines[sigLineIdx].match(/^(\s*)/)[1].length;
        for (let i = bodyStartIdx; i < resultLines.length; i++) {
          const line = resultLines[i];
          const lineIndent = line.match(/^(\s*)/)?.[1]?.length || 0;
          if (line.trim() && lineIndent <= sigIndent && !line.trim().startsWith('#')) {
            bodyEndIdx = i;
            break;
          }
          bodyEndIdx = i + 1;
        }

        // 본문 라인들을 빈칸으로 교체
        const indent = resultLines[sigLineIdx + 1]?.match(/^(\s*)/)?.[1] || '    ';
        const blankPlaceholder = `${indent}# __[${challengeNum}]__ 이 함수의 구현부를 작성하세요`;

        // 원래 라인들을 주석 처리하거나 빈칸으로 교체
        for (let i = bodyStartIdx; i < bodyEndIdx && i < resultLines.length; i++) {
          const line = resultLines[i];
          if (line.trim() && !line.trim().startsWith('#') && !line.trim().startsWith('"""') && !line.trim().startsWith("'''")) {
            resultLines[i] = indent + `__[${challengeNum}]__  # ${line.trim()}`;
            // 첫 줄만 빈칸으로, 나머지는 숨김
            if (i > bodyStartIdx) {
              resultLines[i] = '';  // 나머지 라인 제거
            }
          }
        }
      }
    }
  });

  // 빈 라인 정리
  resultLines = resultLines.filter((line, idx, arr) => {
    // 연속 빈 라인 제거
    if (line === '' && arr[idx - 1] === '') return false;
    return true;
  });

  return resultLines.join('\n');
}


function setSession(rawSession) {
  // rawSession.answer_key에서 특수 필드들을 먼저 추출 (normalizeSession 전에)
  const rawAnswerKey = rawSession.answer_key || rawSession.answerKey || {};
  const rawBlanks = rawAnswerKey._blanks;
  const rawOriginalCode = rawAnswerKey._original_code;
  const rawChallenges = rawAnswerKey._challenges;

  currentSession = normalizeSession(rawSession);
  const { title, language, mode, question, answer, answer_key } = currentSession;
  challengeReviewQueue = new Set();

  // 특수 필드들을 answer_key에 복원 (normalizeSession에서 손실되었을 수 있음)
  if (rawBlanks && !answer_key._blanks) {
    answer_key._blanks = rawBlanks;
  }
  if (rawOriginalCode && !answer_key._original_code) {
    answer_key._original_code = rawOriginalCode;
  }
  if (rawChallenges && !answer_key._challenges) {
    answer_key._challenges = rawChallenges;
  }

  warnedMissingAnswers = false;
  usedPositions = {}; // Reset used positions for new session

  sessionTitle.textContent = title || "제목 없음";
  sessionLang.textContent = language || "python";
  sessionMode.textContent = modeLabels[mode] || mode || "-";
  updateControlButtonsForMode(mode);
  answerBlock.textContent = answer || "(정답/해설이 없습니다)";
  highlightAnswer(language);

  answerKeyMap = answer_key || {};

  // 모드별 렌더링
  const type = answer_key?._type;

  if (type === "parsed_quiz" && answer_key?._questions) {
    renderParsedQuiz(answer_key._questions, answer_key, language);
  } else if (type === "multiple_choice" && answer_key?._questions) {
    renderMultipleChoiceNew(answer_key._questions, answer_key, language);
  } else if ((type === "fill_in_blank_cards" || type === "fill_in_blank_inline") && answer_key?._blanks) {
    // Mode 2: 전체 코드에 인라인 빈칸 형태로 렌더링
    // Python에서 question에 인라인 빈칸 코드를 직접 생성함
    // question이 이미 인라인 빈칸 형식인지 확인 (__[N]__ 패턴 포함)
    const hasInlineBlanks = /__\[\d+\]__/.test(question);

    if (hasInlineBlanks && question.length > 50) {
      // Python 백엔드에서 생성한 인라인 빈칸 코드를 직접 사용

      renderQuestion(question, answer_key, language);
    } else {
      // 폴백: JS에서 인라인 빈칸 빌드 시도
      const originalCode = answer_key._original_code || currentSession.answer || "";
      if (originalCode && originalCode.length > 50) {
        const inlineCode = buildInlineBlankCode(originalCode, answer_key._blanks, answer_key);
        renderQuestion(inlineCode, answer_key, language);
      } else {

        renderQuestion(question || "", answer_key, language);
      }
    }
  } else if (type === "implementation_challenge" && answer_key?._challenges) {
    // Mode 3: 항상 카드 형태로 렌더링 (코드 에디터 + AI 채점)
    renderImplementationChallenge(answer_key._challenges, answer_key, language);
  } else if (type === "definition_quiz" && answer_key?._definitions) {
    renderDefinitionQuiz(answer_key._definitions, answer_key, language);
  } else if (type === "vocabulary_cards" && answer_key?._words) {
    renderVocabularyCards(answer_key._words, answer_key, language);
  } else {

    renderQuestion(question || "", answer_key || {}, language);
  }
}

function renderQuestion(questionText, answerKey, language) {
  codeArea.innerHTML = "";
  blankList.innerHTML = "";
  inputs = [];
  reviewQueue = new Set();
  answerKeyMap = answerKey;

  const hasIndexed = placeholderRegexIndexed.test(questionText);
  placeholderRegexIndexed.lastIndex = 0;
  placeholderRegexFlex.lastIndex = 0;

  const lines = questionText.split("\n");
  const frag = document.createDocumentFragment();
  let counter = 0;

  lines.forEach((line, lineIdx) => {
    const lineElem = document.createElement("div");
    lineElem.className = "code-line";
    const lineNo = document.createElement("div");
    lineNo.className = "line-no";
    lineNo.textContent = lineIdx + 1;
    const codeText = document.createElement("div");
    codeText.className = "code-text";

    let lineHtml = line;
    let lineKeys = [];

    if (hasIndexed) {
      lineHtml = lineHtml.replace(/__\[(\d+)\]__/g, (_, idx) => {
        lineKeys.push(idx);
        return `__BLANK_MARKER_${idx}__`;
      });
    } else {
      lineHtml = lineHtml.replace(/_{3,10}/g, () => {
        counter += 1;
        const key = String(counter);
        lineKeys.push(key);
        return `__BLANK_MARKER_${key}__`;
      });
    }

    if (window.hljs && language) {
      try {
        lineHtml = window.hljs.highlight(lineHtml, { language, ignoreIllegals: true }).value;
      } catch (e) {
        lineHtml = escapeHtml(lineHtml);
      }
    } else {
      lineHtml = escapeHtml(lineHtml);
    }

    lineKeys.forEach((key) => {
      const answer = answerKey[key];
      const dataAnswer = answer !== undefined ? ` data-answer="${escapeHtml(String(answer))}"` : "";
      const inputHtml = `<span class="placeholder" id="blank-${key}">
        <input type="text" class="blank" data-key="${key}"${dataAnswer} placeholder="#${key}" autocomplete="off">
        <button class="help-btn" data-key="${key}" title="힌트 보기" style="background: rgba(247, 215, 116, 0.2); color: #f7d774; border: 1px solid rgba(247, 215, 116, 0.5);">?</button>
        <button class="why-wrong-btn" data-key="${key}" title="왜 틀렸어요?" style="display: none; background: rgba(255, 107, 107, 0.2); color: #ff6b6b; border: 1px solid rgba(255, 107, 107, 0.5);">?</button>
        <span class="answer-chip">#${key}</span>
      </span>`;
      const markerRegex = new RegExp(`__BLANK_MARKER_${key}__`, 'g');
      lineHtml = lineHtml.replace(markerRegex, inputHtml);
    });

    codeText.innerHTML = lineHtml || "&nbsp;";
    lineElem.appendChild(lineNo);
    lineElem.appendChild(codeText);
    frag.appendChild(lineElem);
  });

  codeArea.appendChild(frag);

  const allInputs = codeArea.querySelectorAll("input.blank");
  inputs = Array.from(allInputs);

  inputs.forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleEnter(input);
      }
    });
  });

  // Add help button listeners (yellow - hint)
  codeArea.querySelectorAll(".help-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      explainBlank(btn.dataset.key);
    });
  });

  // Add why-wrong button listeners (red - explain wrong answer)
  codeArea.querySelectorAll(".why-wrong-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      explainWhyWrongBlank(btn.dataset.key);
    });
  });

  sessionCount.textContent = inputs.length;
  hasAnswers = inputs.some((inp) => inp.dataset.answer !== undefined);
  updateScore();
  renderBlankNav();
}

// ========== PARSED QUIZ (기존 문제 파일) ==========
let parsedQuizStates = [];
let originalQuestions = [];  // 원본 문제 순서 저장
let currentQuestions = [];   // 현재 표시 중인 문제 순서
let isShuffled = false;      // 섞임 상태
let parsedQuizMap = new Map(); // qId -> 문제 객체

function renderParsedQuiz(questions, answerKey, language, preserveOrder = false) {
  codeArea.innerHTML = "";
  blankList.innerHTML = "";
  inputs = [];
  reviewQueue = new Set();
  parsedQuizStates = [];
  parsedQuizMap = new Map();

  // 원본 순서 저장 (첫 로드 시)
  if (!preserveOrder) {
    originalQuestions = [...questions];
    currentQuestions = [...questions];
    isShuffled = false;
    updateShuffleButton();
  }

  const frag = document.createDocumentFragment();

  questions.forEach((q, idx) => {
    const qId = q.id || (idx + 1);  // 원본 고유 ID
    const displayIdx = idx + 1;      // 현재 표시 순서 (1, 2, 3...)
    const displayNum = q.original_num || q.num || qId;
    const qType = q.type || "multiple_choice";

    const cardDiv = document.createElement("div");
    cardDiv.className = "mc-question";
    cardDiv.id = `pq-${qId}`;
    cardDiv.dataset.displayIdx = displayIdx;  // 현재 표시 순서 저장

    // 문제 헤더
    const headerDiv = document.createElement("div");
    headerDiv.className = "mc-header";

    // 문제 유형 뱃지
    const typeBadge = qType === "short_answer" ? "📝 단답형" :
      qType === "fill_blank" ? "✏️ 빈칸" : "📋 객관식";

    // [Q#] 형식으로 전역 고유 ID 표시 - AI가 구분 가능
    headerDiv.innerHTML = `<span class="global-qid" style="background:var(--accent);color:#000;padding:2px 6px;border-radius:4px;font-size:0.75em;margin-right:6px;font-weight:bold;">[Q${qId}]</span> <span style="opacity:0.6;font-size:0.8em">${typeBadge}</span> <strong>${displayNum}.</strong> ${escapeHtml(q.text)}`;
    cardDiv.appendChild(headerDiv);

    // 코드 블록
    if (q.code && q.code.trim()) {
      const codeDiv = document.createElement("pre");
      codeDiv.className = "mc-code";
      const langHint = language === "text" ? "python" : language;
      if (window.hljs && langHint) {
        try {
          codeDiv.innerHTML = window.hljs.highlight(q.code.trim(), { language: langHint, ignoreIllegals: true }).value;
        } catch (e) {
          codeDiv.textContent = q.code.trim();
        }
      } else {
        codeDiv.textContent = q.code.trim();
      }
      cardDiv.appendChild(codeDiv);
    }

    // 선지 또는 입력 영역
    if (q.options && q.options.length > 0) {
      // 객관식
      const optionsDiv = document.createElement("div");
      optionsDiv.className = "mc-options";

      q.options.forEach((opt) => {
        const optionBtn = document.createElement("button");
        optionBtn.className = "mc-option";
        optionBtn.dataset.question = String(qId);
        optionBtn.dataset.option = String(opt.num);
        // 정답이 있으면 저장 (채점용)
        optionBtn.dataset.correct = q.correct ? String(q.correct) : "";

        const numSymbols = ["①", "②", "③", "④", "⑤"];
        const symbol = numSymbols[opt.num - 1] || opt.num;

        optionBtn.innerHTML = `<span class="mc-option-num">${symbol}</span><span class="mc-option-text">${escapeHtml(opt.text)}</span>`;
        optionBtn.addEventListener("click", () => handleParsedQuizClick(optionBtn, qId));

        optionsDiv.appendChild(optionBtn);
      });

      cardDiv.appendChild(optionsDiv);
    } else {
      // 단답형/빈칸 - 입력 필드
      const inputDiv = document.createElement("div");
      inputDiv.className = "short-answer-input";
      inputDiv.style.cssText = "margin-top: 1rem;";

      const textarea = document.createElement("textarea");
      textarea.className = "challenge-textarea";
      textarea.id = `pq-input-${qId}`;
      textarea.placeholder = qType === "fill_blank" ? "빈칸에 들어갈 내용을 입력하세요..." : "답을 입력하세요... (Enter=제출, Enter 두 번=AI 정답)";
      textarea.rows = 2;
      textarea.style.cssText = "width: 100%; padding: 0.75rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: var(--fg); font-family: inherit; resize: vertical;";

      // 엔터 두 번 = AI 정답 보기
      let lastEnterTime = 0;
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          const now = Date.now();
          if (now - lastEnterTime < 500) {
            // 엔터 두 번 빠르게 → AI 정답 보기
            e.preventDefault();
            showShortAnswerWithAI(qId, q.question, q.code || "");
          } else {
            // 첫 번째 엔터 → 제출
            e.preventDefault();
            handleShortAnswerSubmit(qId, textarea.value);
          }
          lastEnterTime = now;
        }
      });

      // 버튼들
      const btnDiv = document.createElement("div");
      btnDiv.style.cssText = "display: flex; gap: 8px; margin-top: 0.5rem; flex-wrap: wrap;";

      const submitBtn = document.createElement("button");
      submitBtn.className = "challenge-btn";
      submitBtn.textContent = "제출";
      submitBtn.style.cssText = "padding: 0.5rem 1rem; background: var(--accent-2); color: #0f1117; border: none; border-radius: 6px; cursor: pointer;";
      submitBtn.addEventListener("click", () => handleShortAnswerSubmit(qId, textarea.value));

      const resetBtn = document.createElement("button");
      resetBtn.className = "challenge-btn";
      resetBtn.id = `pq-reset-${qId}`;
      resetBtn.textContent = "🔄 다시";
      resetBtn.style.cssText = "padding: 0.5rem 1rem; background: var(--muted); color: var(--fg); border: none; border-radius: 6px; cursor: pointer;";
      resetBtn.addEventListener("click", () => resetShortAnswer(qId));

      const aiBtn = document.createElement("button");
      aiBtn.className = "challenge-btn";
      aiBtn.textContent = "💡 AI정답";
      aiBtn.style.cssText = "padding: 0.5rem 1rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 6px; cursor: pointer;";
      aiBtn.addEventListener("click", () => showShortAnswerWithAI(qId, q.question, q.code || ""));

      btnDiv.appendChild(submitBtn);
      btnDiv.appendChild(resetBtn);
      btnDiv.appendChild(aiBtn);

      inputDiv.appendChild(textarea);
      inputDiv.appendChild(btnDiv);
      cardDiv.appendChild(inputDiv);
    }

    // 결과 표시
    const resultDiv = document.createElement("div");
    resultDiv.className = "mc-result";
    resultDiv.id = `pq-result-${qId}`;
    cardDiv.appendChild(resultDiv);

    frag.appendChild(cardDiv);
    parsedQuizMap.set(qId, q);

    parsedQuizStates.push({
      qId,
      displayIdx,  // 현재 표시 순서
      displayNum,
      qType,
      selected: null,
      answered: false,
      userAnswer: ""
    });
  });

  codeArea.appendChild(frag);
  renderParsedQuizNav();
  sessionCount.textContent = questions.length;
  hasAnswers = true;
  updateParsedQuizScore();
}

// ========== 순서 섞기 기능 ==========
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function shuffleQuestions() {
  if (!currentSession?.answer_key?._questions) return;

  const answerKey = currentSession.answer_key;
  const language = currentSession.language;

  // 문제 순서 섞기
  currentQuestions = shuffleArray(originalQuestions);
  isShuffled = true;

  // 다시 렌더링
  renderParsedQuiz(currentQuestions, answerKey, language, true);
  updateShuffleButton();

  // 스크롤 맨 위로
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetQuizOrder() {
  if (!currentSession?.answer_key?._questions) return;

  const answerKey = currentSession.answer_key;
  const language = currentSession.language;

  // 원본 순서로 복원
  currentQuestions = [...originalQuestions];
  isShuffled = false;

  // 다시 렌더링
  renderParsedQuiz(currentQuestions, answerKey, language, true);
  updateShuffleButton();

  // 스크롤 맨 위로
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateShuffleButton() {
  const btn = document.getElementById("btn-shuffle");
  if (!btn) return;

  if (isShuffled) {
    btn.textContent = "📋 원래 순서로";
    btn.classList.add("shuffled");
  } else {
    btn.textContent = "🔀 순서 섞기";
    btn.classList.remove("shuffled");
  }
}

function toggleShuffle() {
  // 4번 모드 (객관식)
  if (currentSession?.answer_key?._questions) {
    if (isShuffled) {
      resetQuizOrder();
    } else {
      shuffleQuestions();
    }
    return;
  }

  // 5번 모드 (정의 퀴즈)
  if (definitionStates && definitionStates.length > 0) {
    shuffleDefinitions();
    return;
  }

  // 7번 모드 (영단어)
  if (vocabStates && vocabStates.length > 0) {
    shuffleVocab();
    return;
  }
}

// 정의 퀴즈 순서 섞기
function shuffleDefinitions() {
  const container = document.getElementById('definition-container') || codeBlock;
  if (!container) return;

  const cards = Array.from(container.querySelectorAll('.definition-card'));
  if (cards.length === 0) return;

  // Fisher-Yates 셔플
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    container.appendChild(cards[j]);
  }

  // 모든 카드 다시 추가 (순서 섞인 상태로)
  cards.sort(() => Math.random() - 0.5).forEach(card => container.appendChild(card));

  window.scrollTo({ top: 0, behavior: 'smooth' });

  const btn = document.getElementById('btn-shuffle');
  if (btn) btn.textContent = '🔀 다시 섞기';
}

// 영단어 순서 섞기
function shuffleVocab() {
  const container = document.getElementById('vocab-container') || codeBlock;
  if (!container) return;

  const cards = Array.from(container.querySelectorAll('.vocab-card'));
  if (cards.length === 0) return;

  // Fisher-Yates 셔플
  cards.sort(() => Math.random() - 0.5).forEach(card => container.appendChild(card));

  window.scrollTo({ top: 0, behavior: 'smooth' });

  const btn = document.getElementById('btn-shuffle');
  if (btn) btn.textContent = '🔀 다시 섞기';
}

function handleParsedQuizClick(btn, qId) {
  const selectedOption = btn.dataset.option;
  const correctAnswer = btn.dataset.correct;  // 정답 (있으면)
  const state = parsedQuizStates.find(s => s.qId === qId);

  if (state?.answered) return;

  // 상태 업데이트
  if (state) {
    state.answered = true;
    state.selected = selectedOption;
    state.correctAnswer = correctAnswer;
    state.isCorrect = correctAnswer && selectedOption === correctAnswer;
  }

  const cardDiv = document.getElementById(`pq-${qId}`);
  const options = cardDiv.querySelectorAll(".mc-option");
  const resultDiv = document.getElementById(`pq-result-${qId}`);
  const nav = document.getElementById(`nav-pq-${qId}`);

  // 정답이 있으면 채점
  if (correctAnswer) {
    const isCorrect = selectedOption === correctAnswer;

    options.forEach(opt => {
      opt.disabled = true;
      if (opt.dataset.option === correctAnswer) {
        opt.classList.add("correct");  // 정답은 항상 녹색
      }
      if (opt.dataset.option === selectedOption && !isCorrect) {
        opt.classList.add("wrong");  // 오답이면 빨간색
      }
      if (opt.dataset.option === selectedOption && isCorrect) {
        opt.classList.add("correct");
      }
    });

    if (isCorrect) {
      resultDiv.innerHTML = `<span style="color: var(--green);">✅ 정답! (${selectedOption}번)</span>`;
      if (nav) {
        nav.classList.remove("pending");
        nav.classList.add("correct");
      }
    } else {
      resultDiv.innerHTML = `<span style="color: var(--red);">❌ 오답! 정답은 ${correctAnswer}번</span>`;
      if (nav) {
        nav.classList.remove("pending");
        nav.classList.add("wrong");
      }
    }
  } else {
    // 정답 없으면 선택만 표시
    options.forEach(opt => {
      opt.disabled = true;
      if (opt.dataset.option === selectedOption) {
        opt.classList.add("selected");
      }
    });
    resultDiv.innerHTML = `<span style="color: var(--accent-2);">✓ ${selectedOption}번 선택됨</span>`;
    if (nav) {
      nav.classList.remove("pending");
      nav.classList.add("correct");
    }
  }

  updateParsedQuizScore();
}

// 단답형/빈칸 제출 핸들러 (AI 채점)
async function handleShortAnswerSubmit(qId, answer) {
  const state = parsedQuizStates.find(s => s.qId === qId);

  if (state?.isCorrect) return;

  if (!answer.trim()) {
    alert("답을 입력해주세요.");
    return;
  }

  const textarea = document.getElementById(`pq-input-${qId}`);
  const resultDiv = document.getElementById(`pq-result-${qId}`);

  resultDiv.innerHTML = `<span style="color: var(--accent-2);">AI가 채점 중...</span>`;

  try {
    const questionCard = document.getElementById(`pq-${qId}`);
    const questionText = questionCard?.querySelector('.parsed-quiz-question')?.textContent || '';
    const codeText = questionCard?.querySelector('pre')?.textContent || '';

    const qObj = parsedQuizMap.get(qId) || {};
    const expected = qObj.answer || currentSession?.answer_key?.[String(qId)];
    const normalize = (s) => s.replace(/\s+/g, ' ').trim();

    let isCorrect = false;
    let gradedBy = "ai";

    if (expected && normalize(expected) === normalize(answer)) {
      isCorrect = true;
      gradedBy = "exact";
    }

    if (!isCorrect) {
      isCorrect = await checkShortAnswerWithAI(questionText, codeText, answer.trim());
    }

    if (state) {
      state.answered = isCorrect;
      state.userAnswer = answer.trim();
      state.isCorrect = isCorrect;
    }

    if (isCorrect) {
      if (textarea) {
        textarea.style.background = "rgba(94, 230, 167, 0.1)";
        textarea.style.borderColor = "var(--green)";
        textarea.disabled = false;
      }
      resultDiv.innerHTML = `<span class="mc-correct">정답! ${gradedBy === "exact" ? "정확히 일치합니다." : "AI가 인정했습니다."}</span>`;
      LearningStats.recordAnswer(true);
      SoundEffects.play('correct');
    } else {
      if (textarea) {
        textarea.style.background = "rgba(255, 107, 107, 0.1)";
        textarea.style.borderColor = "var(--red)";
        textarea.disabled = false;
      }
      resultDiv.innerHTML = `<span class="mc-wrong">오답입니다. 다시 생각해보세요.</span>`;
      LearningStats.recordAnswer(false);
      SoundEffects.play('wrong');
      if (state) state.answered = false;
    }

    const nav = document.getElementById(`nav-pq-${qId}`);
    if (nav) {
      nav.classList.remove("pending");
      nav.classList.add(isCorrect ? "correct" : "wrong");
    }

    updateParsedQuizScore();

  } catch (err) {
    resultDiv.innerHTML = `<span class="mc-wrong">채점 오류: ${err.message}</span>`;
  }
}

// 단답형 AI 채점 (매우 엄격)
async function checkShortAnswerWithAI(question, code, userAnswer) {
  const prompt = `당신은 매우 엄격한 프로그래밍 시험 채점관입니다. 학생들의 점수를 후하게 주지 않습니다.

## 문제
${question}

${code ? `## 관련 코드\n\`\`\`\n${code}\n\`\`\`` : ''}

## 학생의 답
"${userAnswer}"

## 채점 기준 (매우 엄격)
1. 정확한 값이나 결과여야 함
2. 대략적인 답이나 설명은 오답
3. 숫자 문제는 정확한 숫자여야 함
4. 출력 결과 문제는 정확한 출력이어야 함
5. 의미없는 답이나 임의의 답은 무조건 오답
6. 확신이 없으면 오답으로 처리

## 응답 (한 단어만)
- 100% 확실히 정답이면: CORRECT
- 그 외 모든 경우: WRONG`;

  try {
    const response = await callGeminiAPI(prompt, "You are an extremely strict exam grader. When in doubt, mark as WRONG.");
    const upperResponse = response.toUpperCase().trim();
    // "CORRECT"가 명확히 있고 "WRONG"이 없을 때만 정답
    if (upperResponse.includes("CORRECT") && !upperResponse.includes("WRONG")) {
      return true;
    }
    return false; // 기본값은 오답
  } catch (err) {
    console.error("AI 채점 오류:", err);
    return false; // API 실패 시 오답
  }
}

// 단답형 다시 풀기
function resetShortAnswer(qId) {
  const state = parsedQuizStates.find(s => s.qId === qId);
  if (!state) return;

  const textarea = document.getElementById(`pq-input-${qId}`);
  const resultDiv = document.getElementById(`pq-result-${qId}`);
  const nav = document.getElementById(`nav-pq-${qId}`);

  // 상태 초기화
  state.answered = false;
  state.isCorrect = null;
  state.userAnswer = "";

  // UI 초기화
  if (textarea) {
    textarea.value = "";
    textarea.disabled = false;
    textarea.style.background = "rgba(255,255,255,0.05)";
    textarea.style.borderColor = "rgba(255,255,255,0.1)";
    textarea.focus();
  }

  if (resultDiv) {
    resultDiv.innerHTML = "";
  }

  if (nav) {
    nav.classList.remove("correct", "wrong");
    nav.classList.add("pending");
  }

  updateParsedQuizScore();
}

// AI 정답 보기
async function showShortAnswerWithAI(qId, question, code) {
  const resultDiv = document.getElementById(`pq-result-${qId}`);
  const state = parsedQuizStates.find(s => s.qId === qId);

  resultDiv.innerHTML = `<span style="color: var(--accent-2);">🤔 AI가 정답을 분석 중...</span>`;

  const prompt = `당신은 프로그래밍 문제 해설자입니다.

## 문제
${question}

${code ? `## 코드\n\`\`\`\n${code}\n\`\`\`` : ''}

이 문제의 정답과 간단한 해설을 알려주세요.
- 정답을 먼저 명확하게 제시
- 왜 그 답인지 1-2줄로 설명

형식: "정답: [답] / 해설: [설명]"`;

  try {
    const response = await callGeminiAPI(prompt, "Provide the correct answer clearly.");

    // 정답 표시
    resultDiv.innerHTML = `
      <div style="background: rgba(102, 126, 234, 0.1); border: 1px solid rgba(102, 126, 234, 0.3); border-radius: 8px; padding: 12px; margin-top: 8px;">
        <div style="color: #667eea; font-weight: bold; margin-bottom: 6px;">💡 AI 정답</div>
        <div style="color: var(--fg);">${escapeHtml(response)}</div>
      </div>`;

    // 상태 업데이트 (정답 봄으로 표시)
    if (state && !state.answered) {
      state.answered = true;
      state.isCorrect = false; // 정답을 봤으므로 틀린 것으로 처리
    }

    const nav = document.getElementById(`nav-pq-${qId}`);
    if (nav) {
      nav.classList.remove("pending");
      nav.classList.add("revealed");
    }

    updateParsedQuizScore();

  } catch (err) {
    resultDiv.innerHTML = `<span class="mc-wrong">❌ AI 오류: ${err.message}</span>`;
  }
}

function renderParsedQuizNav() {
  blankList.innerHTML = "";
  parsedQuizStates.forEach((s, idx) => {
    const btn = document.createElement("div");
    btn.className = "blank-pill pending";
    btn.id = `nav-pq-${s.qId}`;
    btn.textContent = `${idx + 1}`;  // 순차 번호 (1, 2, 3...)
    btn.title = `[Q${s.qId}] ${s.displayNum}번`;  // 툴팁에 전역 ID + 원본 번호
    btn.addEventListener("click", () => {
      const target = document.getElementById(`pq-${s.qId}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    blankList.appendChild(btn);
  });
}

function updateParsedQuizScore() {
  const total = parsedQuizStates.length;
  const answered = parsedQuizStates.filter(s => s.answered).length;
  const correct = parsedQuizStates.filter(s => s.isCorrect === true).length;
  const wrong = parsedQuizStates.filter(s => s.answered && s.isCorrect === false && s.correctAnswer).length;

  // 채점 가능한 문제가 있으면 점수 표시
  const hasGradedQuestions = parsedQuizStates.some(s => s.correctAnswer);

  if (hasGradedQuestions && answered > 0) {
    sessionScore.textContent = `✅${correct} ❌${wrong} / ${total}`;
    sessionScore.style.color = correct > wrong ? "var(--green)" : "var(--red)";
  } else {
    sessionScore.textContent = `${answered} / ${total} 완료`;
    sessionScore.style.color = "";
  }

  const ratio = total ? (answered / total) * 100 : 0;
  sessionProgress.style.width = `${ratio}%`;

  if (reviewBadge) {
    if (answered === total && hasGradedQuestions) {
      const percentage = Math.round((correct / total) * 100);
      reviewBadge.textContent = `최종 점수: ${correct}/${total} (${percentage}%)`;
      reviewBadge.style.color = percentage >= 60 ? "var(--green)" : "var(--red)";
    } else if (answered === total) {
      reviewBadge.textContent = "모두 완료!";
    } else {
      reviewBadge.textContent = `남은 문제 ${total - answered}개`;
    }
  }
}

// ========== MULTIPLE CHOICE (코드 생성) ==========
function renderMultipleChoiceNew(questions, answerKey, language) {
  codeArea.innerHTML = "";
  blankList.innerHTML = "";
  inputs = [];
  reviewQueue = new Set();
  mcQuestions = [];

  const frag = document.createDocumentFragment();

  questions.forEach((q, idx) => {
    const qNum = q.num || (idx + 1);
    const correctAnswer = q.correct ? String(q.correct) : answerKey[String(qNum)];

    const cardDiv = document.createElement("div");
    cardDiv.className = "mc-question";
    cardDiv.id = `mc-${qNum}`;

    // 문제 헤더
    const headerDiv = document.createElement("div");
    headerDiv.className = "mc-header";
    headerDiv.innerHTML = `<strong>[문제 ${qNum}]</strong> ${escapeHtml(q.text)}`;
    cardDiv.appendChild(headerDiv);

    // 코드 블록
    if (q.code) {
      const codeDiv = document.createElement("pre");
      codeDiv.className = "mc-code";
      if (window.hljs && language) {
        try {
          codeDiv.innerHTML = window.hljs.highlight(q.code.trim(), { language, ignoreIllegals: true }).value;
        } catch (e) {
          codeDiv.textContent = q.code.trim();
        }
      } else {
        codeDiv.textContent = q.code.trim();
      }
      cardDiv.appendChild(codeDiv);
    }

    // 선지
    const optionsDiv = document.createElement("div");
    optionsDiv.className = "mc-options";

    q.options.forEach((opt) => {
      const optionBtn = document.createElement("button");
      optionBtn.className = "mc-option";
      optionBtn.dataset.question = String(qNum);
      optionBtn.dataset.option = String(opt.num);
      optionBtn.dataset.correct = correctAnswer;

      optionBtn.innerHTML = `<span class="mc-option-num">${opt.num}</span><span class="mc-option-text">${escapeHtml(opt.text)}</span>`;
      optionBtn.addEventListener("click", () => handleMCClick(optionBtn));

      optionsDiv.appendChild(optionBtn);
    });

    cardDiv.appendChild(optionsDiv);

    // 결과
    const resultDiv = document.createElement("div");
    resultDiv.className = "mc-result";
    resultDiv.id = `mc-result-${qNum}`;
    cardDiv.appendChild(resultDiv);

    frag.appendChild(cardDiv);

    mcQuestions.push({
      questionNum: qNum,
      correctAnswer,
      answered: false,
      isCorrect: null
    });
  });

  codeArea.appendChild(frag);
  renderMCNav();
  sessionCount.textContent = questions.length;
  hasAnswers = true;
  updateMCScore();
}

// ========== MULTIPLE CHOICE (Legacy) ==========
let mcQuestions = []; // 객관식 문제 상태 저장

function renderMultipleChoice(questions, answerKey, language) {
  codeArea.innerHTML = "";
  blankList.innerHTML = "";
  inputs = [];
  reviewQueue = new Set();
  mcQuestions = [];

  const frag = document.createDocumentFragment();

  questions.forEach((questionText, idx) => {
    const questionNum = idx + 1;
    const correctAnswer = answerKey[String(questionNum)];
    const details = answerKey._details?.[String(questionNum)];

    // 문제 컨테이너
    const questionDiv = document.createElement("div");
    questionDiv.className = "mc-question";
    questionDiv.id = `mc-${questionNum}`;

    // 문제 파싱 (텍스트에서 코드와 선지 분리)
    const parts = questionText.split(/```python\n/);
    const header = parts[0] || "";
    const rest = parts[1]?.split(/```\n/) || ["", ""];
    const codeBlock = rest[0] || "";
    const optionsText = rest[1] || "";

    // 문제 헤더
    const headerDiv = document.createElement("div");
    headerDiv.className = "mc-header";
    headerDiv.innerHTML = escapeHtml(header.trim());
    questionDiv.appendChild(headerDiv);

    // 코드 블록
    if (codeBlock) {
      const codeDiv = document.createElement("pre");
      codeDiv.className = "mc-code";
      if (window.hljs && language) {
        try {
          codeDiv.innerHTML = window.hljs.highlight(codeBlock.trim(), { language, ignoreIllegals: true }).value;
        } catch (e) {
          codeDiv.textContent = codeBlock.trim();
        }
      } else {
        codeDiv.textContent = codeBlock.trim();
      }
      questionDiv.appendChild(codeDiv);
    }

    // 선지 파싱 및 렌더링
    const optionsDiv = document.createElement("div");
    optionsDiv.className = "mc-options";

    const optionLines = optionsText.trim().split("\n").filter(line => /^\s*\d+\./.test(line));
    optionLines.forEach((line) => {
      const match = line.match(/^\s*(\d+)\.\s*(.+)$/);
      if (!match) return;

      const optionNum = match[1];
      const optionText = match[2];

      const optionBtn = document.createElement("button");
      optionBtn.className = "mc-option";
      optionBtn.dataset.question = String(questionNum);
      optionBtn.dataset.option = optionNum;
      optionBtn.dataset.correct = correctAnswer;

      optionBtn.innerHTML = `<span class="mc-option-num">${optionNum}</span><span class="mc-option-text">${escapeHtml(optionText)}</span>`;

      optionBtn.addEventListener("click", () => handleMCClick(optionBtn));

      optionsDiv.appendChild(optionBtn);
    });

    questionDiv.appendChild(optionsDiv);

    // 결과 표시 영역
    const resultDiv = document.createElement("div");
    resultDiv.className = "mc-result";
    resultDiv.id = `mc-result-${questionNum}`;
    questionDiv.appendChild(resultDiv);

    frag.appendChild(questionDiv);

    // 상태 저장
    mcQuestions.push({
      questionNum,
      correctAnswer,
      answered: false,
      isCorrect: null
    });
  });

  codeArea.appendChild(frag);

  // 빈칸 목록 대신 문제 목록 렌더링
  renderMCNav();

  sessionCount.textContent = questions.length;
  hasAnswers = true;
  updateMCScore();
}

function handleMCClick(btn) {
  const questionNum = parseInt(btn.dataset.question);
  const selectedOption = btn.dataset.option;
  const correctOption = btn.dataset.correct;

  // 이미 답한 문제면 무시
  const questionState = mcQuestions.find(q => q.questionNum === questionNum);
  if (questionState?.answered) return;

  const isCorrect = selectedOption === correctOption;

  // 상태 업데이트
  if (questionState) {
    questionState.answered = true;
    questionState.isCorrect = isCorrect;
  }

  // UI 업데이트
  const questionDiv = document.getElementById(`mc-${questionNum}`);
  const options = questionDiv.querySelectorAll(".mc-option");

  options.forEach(opt => {
    opt.disabled = true;
    if (opt.dataset.option === correctOption) {
      opt.classList.add("correct");
    }
    if (opt.dataset.option === selectedOption && !isCorrect) {
      opt.classList.add("wrong");
    }
  });

  // 결과 메시지
  const resultDiv = document.getElementById(`mc-result-${questionNum}`);
  if (isCorrect) {
    resultDiv.innerHTML = `<span class="mc-correct">✓ 정답입니다!</span>`;
  } else {
    resultDiv.innerHTML = `<span class="mc-wrong">✗ 오답입니다. 정답: ${correctOption}번</span>`;
  }

  // 네비게이션 업데이트
  const nav = document.getElementById(`nav-mc-${questionNum}`);
  if (nav) {
    nav.classList.remove("pending");
    nav.classList.add(isCorrect ? "correct" : "revealed");
  }

  updateMCScore();
}

function renderMCNav() {
  blankList.innerHTML = "";
  mcQuestions.forEach((q) => {
    const btn = document.createElement("div");
    btn.className = "blank-pill pending";
    btn.id = `nav-mc-${q.questionNum}`;
    btn.textContent = `Q${q.questionNum}`;
    btn.addEventListener("click", () => {
      const target = document.getElementById(`mc-${q.questionNum}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    blankList.appendChild(btn);
  });
}

function updateMCScore() {
  const total = mcQuestions.length;
  const answered = mcQuestions.filter(q => q.answered).length;
  const correct = mcQuestions.filter(q => q.isCorrect).length;

  sessionScore.textContent = `${correct} / ${total}`;
  const ratio = total ? (correct / total) * 100 : 0;
  sessionProgress.style.width = `${ratio}%`;

  if (reviewBadge) {
    if (answered === total) {
      reviewBadge.textContent = `완료! ${correct}/${total}`;
    } else {
      reviewBadge.textContent = `진행 중 ${answered}/${total}`;
    }
  }
}

// ========== FILL IN BLANK CARDS (Mode 1/2) ==========
let blankCardStates = [];

function renderBlankCards(blanks, answerKey, language) {
  codeArea.innerHTML = "";
  blankList.innerHTML = "";
  inputs = [];
  reviewQueue = new Set();
  blankCardStates = [];

  const frag = document.createDocumentFragment();

  blanks.forEach((blank, idx) => {
    const cardNum = idx + 1;
    const answer = blank.answer;

    const cardDiv = document.createElement("div");
    cardDiv.className = "blank-card";
    cardDiv.id = `blank-card-${cardNum}`;

    // 헤더
    const headerDiv = document.createElement("div");
    headerDiv.className = "blank-card-header";
    headerDiv.innerHTML = `<span class="blank-card-num">#${cardNum}</span> <span class="blank-card-line">Line ${blank.line_num}</span>`;
    cardDiv.appendChild(headerDiv);

    // 코드 컨텍스트
    const codeDiv = document.createElement("pre");
    codeDiv.className = "blank-card-code";

    // 코드에서 _____ 를 input으로 변환
    let codeHtml = blank.context;
    if (window.hljs && language) {
      try {
        codeHtml = window.hljs.highlight(blank.context, { language, ignoreIllegals: true }).value;
      } catch (e) {
        codeHtml = escapeHtml(blank.context);
      }
    } else {
      codeHtml = escapeHtml(blank.context);
    }

    // _____ 를 input으로 변환
    codeHtml = codeHtml.replace(/_____/g,
      `<input type="text" class="blank-card-input" data-key="${cardNum}" data-answer="${escapeHtml(answer)}" placeholder="정답 입력">`
    );

    codeDiv.innerHTML = codeHtml;
    cardDiv.appendChild(codeDiv);

    // 결과 표시
    const resultDiv = document.createElement("div");
    resultDiv.className = "blank-card-result";
    resultDiv.id = `blank-result-${cardNum}`;
    cardDiv.appendChild(resultDiv);

    // 도움말 버튼
    const helpBtn = document.createElement("button");
    helpBtn.className = "help-btn blank-card-help";
    helpBtn.textContent = "?";
    helpBtn.title = "이 빈칸 설명";
    helpBtn.addEventListener("click", () => explainBlank(String(cardNum)));
    cardDiv.appendChild(helpBtn);

    frag.appendChild(cardDiv);

    blankCardStates.push({
      cardNum,
      answer,
      answered: false,
      isCorrect: null
    });
  });

  codeArea.appendChild(frag);

  // input에 이벤트 바인딩
  const allInputs = codeArea.querySelectorAll(".blank-card-input");
  inputs = Array.from(allInputs);

  inputs.forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleBlankCardEnter(input);
      }
    });
  });

  renderBlankCardNav();
  sessionCount.textContent = blanks.length;
  hasAnswers = true;
  updateBlankCardScore();
}

function handleBlankCardEnter(input) {
  const cardNum = parseInt(input.dataset.key);
  const expected = input.dataset.answer;
  const userAnswer = input.value.trim();

  if (!userAnswer) return;

  const isCorrect = userAnswer === expected;
  const state = blankCardStates.find(s => s.cardNum === cardNum);

  if (state) {
    state.answered = true;
    state.isCorrect = isCorrect;
  }

  // UI 업데이트
  input.disabled = true;
  input.classList.add(isCorrect ? "correct" : "wrong");

  const resultDiv = document.getElementById(`blank-result-${cardNum}`);
  if (isCorrect) {
    resultDiv.innerHTML = `<span class="mc-correct">✓ 정답!</span>`;
  } else {
    input.value = expected;
    input.classList.remove("wrong");
    input.classList.add("revealed");
    resultDiv.innerHTML = `<span class="mc-wrong">✗ 오답 → 정답: ${expected}</span>`;
  }

  // 네비게이션 업데이트
  const nav = document.getElementById(`nav-blank-${cardNum}`);
  if (nav) {
    nav.classList.remove("pending");
    nav.classList.add(isCorrect ? "correct" : "revealed");
  }

  updateBlankCardScore();

  // 다음 입력으로 포커스
  const nextInput = inputs.find(inp => !inp.disabled);
  if (nextInput) nextInput.focus();
}

function renderBlankCardNav() {
  blankList.innerHTML = "";
  blankCardStates.forEach((s) => {
    const btn = document.createElement("div");
    btn.className = "blank-pill pending";
    btn.id = `nav-blank-${s.cardNum}`;
    btn.textContent = `#${s.cardNum}`;
    btn.addEventListener("click", () => {
      const target = document.getElementById(`blank-card-${s.cardNum}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      const input = target?.querySelector("input");
      if (input && !input.disabled) input.focus();
    });
    blankList.appendChild(btn);
  });
}

function updateBlankCardScore() {
  const total = blankCardStates.length;
  const correct = blankCardStates.filter(s => s.isCorrect).length;
  const answered = blankCardStates.filter(s => s.answered).length;

  sessionScore.textContent = `${correct} / ${total}`;
  const ratio = total ? (correct / total) * 100 : 0;
  sessionProgress.style.width = `${ratio}%`;

  if (reviewBadge) {
    const remaining = total - answered;
    if (remaining === 0) {
      reviewBadge.textContent = `완료! ${correct}/${total}`;
    } else {
      reviewBadge.textContent = `남은 문제 ${remaining}개`;
    }
  }
}

// ========== IMPLEMENTATION CHALLENGE (Mode 3) ==========
let challengeStates = [];

function renderImplementationChallenge(challenges, answerKey, language) {
  codeArea.innerHTML = "";
  blankList.innerHTML = "";
  inputs = [];
  reviewQueue = new Set();
  challengeStates = [];

  const frag = document.createDocumentFragment();

  challenges.forEach((ch, idx) => {
    const challengeNum = idx + 1;
    const answer = ch.body;

    const cardDiv = document.createElement("div");
    cardDiv.className = "challenge-card";
    cardDiv.id = `challenge-${challengeNum}`;

    // 헤더
    const headerDiv = document.createElement("div");
    headerDiv.className = "challenge-header";
    headerDiv.innerHTML = `<span class="challenge-num">챌린지 ${challengeNum}</span>`;
    cardDiv.appendChild(headerDiv);

    // 함수 시그니처
    const sigDiv = document.createElement("pre");
    sigDiv.className = "challenge-signature";
    if (window.hljs && language) {
      try {
        sigDiv.innerHTML = window.hljs.highlight(ch.signature, { language, ignoreIllegals: true }).value;
      } catch (e) {
        sigDiv.textContent = ch.signature;
      }
    } else {
      sigDiv.textContent = ch.signature;
    }
    cardDiv.appendChild(sigDiv);

    // 힌트
    const hintDiv = document.createElement("div");
    hintDiv.className = "challenge-hint";
    hintDiv.textContent = "↓ 아래에 함수 본문을 구현하세요";
    cardDiv.appendChild(hintDiv);

    // 입력 영역
    const textarea = document.createElement("textarea");
    textarea.className = "challenge-input";
    textarea.dataset.key = String(challengeNum);
    textarea.dataset.answer = answer;
    textarea.placeholder = "    # 여기에 코드 구현...";
    textarea.rows = 8;
    textarea.spellcheck = false;

    // Python 자동 들여쓰기 및 Enter 키 채점
    textarea.addEventListener("keydown", (e) => {
      // Tab 키: 들여쓰기 추가
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = textarea.value;
        textarea.value = value.substring(0, start) + "    " + value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 4;
        return;
      }

      // Shift+Tab: 들여쓰기 제거
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        const start = textarea.selectionStart;
        const value = textarea.value;
        const lineStart = value.lastIndexOf("\n", start - 1) + 1;
        const linePrefix = value.substring(lineStart, start);
        if (linePrefix.startsWith("    ")) {
          textarea.value = value.substring(0, lineStart) + value.substring(lineStart + 4);
          textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, start - 4);
        }
        return;
      }

      // ===== Enter 키: 자동 들여쓰기 + 채점 단축키 =====
      // VSCode 스타일: 빈 줄에서 엔터 = 들여쓰기 한 단계 취소
      if (e.key === "Enter") {
        // Shift+Enter: 개별 채점 (Mode3 전용)
        if (e.shiftKey) {
          e.preventDefault();
          handleChallengeCheck(challengeNum);
          return;
        }

        // Ctrl+Enter는 전체 채점용으로 전파
        if (e.ctrlKey || e.metaKey) {
          return;
        }

        e.preventDefault();
        const start = textarea.selectionStart;
        const value = textarea.value;
        const lineStart = value.lastIndexOf("\n", start - 1) + 1;
        const currentLine = value.substring(lineStart, start);

        // 현재 줄의 들여쓰기 추출
        const indentMatch = currentLine.match(/^(\s*)/);
        let indent = indentMatch ? indentMatch[1] : "";

        // ★ VSCode 스타일: 현재 줄이 공백만 있으면 (빈 줄) 들여쓰기 한 단계 취소
        if (currentLine.trim() === "" && indent.length >= 4) {
          // 이전 줄의 공백을 4칸 줄이기 (들여쓰기 취소)
          const newIndent = indent.substring(4);
          // 현재 줄 내용을 새 들여쓰기로 교체
          textarea.value = value.substring(0, lineStart) + newIndent + "\n" + newIndent + value.substring(start);
          textarea.selectionStart = textarea.selectionEnd = lineStart + newIndent.length + 1 + newIndent.length;
          return;
        }

        // : 로 끝나면 추가 들여쓰기 (def, if, for, while, class, try, except 등)
        if (currentLine.trim().endsWith(":")) {
          indent += "    ";
        }

        textarea.value = value.substring(0, start) + "\n" + indent + value.substring(start);
        textarea.selectionStart = textarea.selectionEnd = start + 1 + indent.length;
        return;
      }
    });

    cardDiv.appendChild(textarea);

    // 버튼 영역
    const btnDiv = document.createElement("div");
    btnDiv.className = "challenge-actions";

    const checkBtn = document.createElement("button");
    checkBtn.className = "challenge-check-btn";
    checkBtn.textContent = "✓ AI 채점";
    checkBtn.addEventListener("click", () => handleChallengeCheck(challengeNum));

    const showBtn = document.createElement("button");
    showBtn.className = "challenge-show-btn";
    showBtn.textContent = "정답 보기";
    showBtn.addEventListener("click", () => handleChallengeShow(challengeNum));

    const resetBtn = document.createElement("button");
    resetBtn.className = "challenge-reset-btn";
    resetBtn.textContent = "🔄 다시 풀기";
    resetBtn.addEventListener("click", () => handleChallengeReset(challengeNum));

    const helpBtn = document.createElement("button");
    helpBtn.className = "help-btn";
    helpBtn.textContent = "?";
    helpBtn.title = "AI가 정답과 이유를 코드와 함께 설명합니다.";
    helpBtn.addEventListener("click", () => explainBlank(String(challengeNum)));

    const whyWrongBtn = document.createElement("button");
    whyWrongBtn.className = "why-wrong-btn";
    whyWrongBtn.textContent = "❓ 왜 틀렸나요?";
    whyWrongBtn.style.cssText = "background: linear-gradient(135deg, #ff6b6b, #ee5a5a); color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;";
    whyWrongBtn.addEventListener("click", () => explainWhyWrong(challengeNum, 'challenge'));

    btnDiv.appendChild(checkBtn);
    btnDiv.appendChild(showBtn);
    btnDiv.appendChild(resetBtn);
    btnDiv.appendChild(helpBtn);
    btnDiv.appendChild(whyWrongBtn);
    cardDiv.appendChild(btnDiv);

    // 결과
    const resultDiv = document.createElement("div");
    resultDiv.className = "challenge-result";
    resultDiv.id = `challenge-result-${challengeNum}`;
    cardDiv.appendChild(resultDiv);

    frag.appendChild(cardDiv);

    challengeStates.push({
      challengeNum,
      signature: ch.signature,
      answer,
      answered: false,
      isCorrect: null,
      hasBeenWrong: false
    });
  });

  codeArea.appendChild(frag);
  renderChallengeNav();
  sessionCount.textContent = challenges.length;
  hasAnswers = true;
  updateChallengeScore();
}

async function handleChallengeCheck(num) {
  const card = document.getElementById(`challenge-${num}`);
  const textarea = card.querySelector("textarea");
  const state = challengeStates.find(s => s.challengeNum === num);
  const resultDiv = document.getElementById(`challenge-result-${num}`);

  const userAnswer = textarea.value.trim();

  // 빈 답안 체크
  if (!userAnswer) {
    resultDiv.innerHTML = `<span class="mc-wrong">✗ 코드를 입력해주세요</span>`;
    return;
  }

  // 이미 오답으로 표시된 상태에서 다시 확인 버튼 → 정답 표시
  if (textarea.classList.contains("wrong") && !textarea.classList.contains("revealed")) {
    handleChallengeShow(num);
    return;
  }

  // 이미 채점 완료된 상태면 무시
  if (textarea.classList.contains("correct") || textarea.classList.contains("revealed")) {
    return;
  }

  // AI 채점 시작
  resultDiv.innerHTML = `<span class="definition-loading">🤖 AI가 채점 중...</span>`;

  const expected = state.answer.trim();
  const signature = state.signature || "";

  try {
    // 정답 코드의 핵심 라인 수 계산 (주석, 빈 줄 제외)
    const expectedLines = expected.split('\n')
      .filter(line => line.trim() && !line.trim().startsWith('#'))
      .length;
    const userLines = userAnswer.split('\n')
      .filter(line => line.trim() && !line.trim().startsWith('#'))
      .length;

    // 라인 수가 현저히 다르면 바로 WRONG (50% 이상 차이)
    if (userLines < expectedLines * 0.5) {
      finishChallengeCheck(num, false, `코드가 너무 짧습니다. (필요: ${expectedLines}줄 이상, 입력: ${userLines}줄)`);
      return;
    }

    // AI 채점 - 더 엄격한 프롬프트
    const prompt = `Python 코드를 엄격하게 채점해줘.

## 함수 시그니처
${signature}

## 정답 코드 (반드시 이 내용이 모두 포함되어야 함)
\`\`\`python
${expected}
\`\`\`

## 학생 코드
\`\`\`python
${userAnswer}
\`\`\`

## 엄격한 채점 기준
1. 정답 코드의 모든 로직이 학생 코드에 있어야 함
2. 조건문(if), 반복문(while/for), return문이 모두 포함되어야 함
3. 함수 호출이 정확히 같아야 함 (예: print(), current.link 등)
4. 변수명, 함수명은 정확히 같아야 함
5. 누락된 코드가 있으면 무조건 WRONG
6. 주석은 채점에서 제외
7. 들여쓰기, 공백 스타일 차이는 무시

## 응답 형식
CORRECT 또는 WRONG만 응답해. 확실하지 않으면 WRONG.`;

    const response = await callGeminiAPI(prompt, "엄격하게 채점해. 확실히 모든 내용이 포함된 경우만 CORRECT. 조금이라도 의심스러우면 WRONG.");

    // CORRECT가 있고 WRONG이 없는 경우만 정답
    const responseUpper = response.toUpperCase().trim();
    const isCorrect = responseUpper.startsWith('CORRECT') ||
      (responseUpper.includes('CORRECT') && !responseUpper.includes('WRONG'));

    const feedback = isCorrect ? '정답입니다! 🎉' : '코드를 다시 확인해보세요.';
    finishChallengeCheck(num, isCorrect, feedback);

  } catch (err) {
    // AI 오류 시 로컬 비교로 폴백 - 더 엄격하게
    const normalize = (s) => s.replace(/\s+/g, '').replace(/#.*$/gm, '').toLowerCase();
    const expectedNorm = normalize(expected);
    const userNorm = normalize(userAnswer);

    // 정답 코드가 사용자 코드에 완전히 포함되어야 함
    const isCorrect = userNorm.includes(expectedNorm) || expectedNorm === userNorm;
    finishChallengeCheck(num, isCorrect, `${isCorrect ? "정답!" : "다시 확인해보세요"} (AI 연결 오류)`);
  }
}

function finishChallengeCheck(num, isCorrect, feedback) {
  const card = document.getElementById(`challenge-${num}`);
  const textarea = card.querySelector("textarea");
  const state = challengeStates.find(s => s.challengeNum === num);
  const resultDiv = document.getElementById(`challenge-result-${num}`);

  state.answered = true;
  state.isCorrect = isCorrect;
  textarea.classList.remove("wrong", "correct", "retried");

  if (isCorrect) {
    const wasWrongBefore = state.hasBeenWrong;
    if (wasWrongBefore) {
      textarea.classList.add("retried");
      challengeReviewQueue.add(String(num));
      resultDiv.innerHTML = `<span class="mc-correct">✓ 정답! (재도전 성공)</span>`;
    } else {
      textarea.classList.add("correct");
      challengeReviewQueue.delete(String(num));
      resultDiv.innerHTML = `<span class="mc-correct">✓ ${feedback}</span>`;
    }
    SoundEffects.play("correct");
  } else {
    state.hasBeenWrong = true;
    textarea.classList.add("wrong");
    challengeReviewQueue.add(String(num));
    resultDiv.innerHTML = `<span class="mc-wrong">✗ ${feedback}<br><small style="color: var(--muted);">다시 확인 버튼을 누르면 정답을 볼 수 있습니다</small></span>`;
    SoundEffects.play("wrong");
  }

  const nav = document.getElementById(`nav-challenge-${num}`);
  if (nav) {
    nav.classList.remove("pending");
    nav.classList.remove("correct", "wrong", "retried");
    if (isCorrect) {
      nav.classList.add(state.hasBeenWrong ? "retried" : "correct");
    } else {
      nav.classList.add("wrong");
    }
  }

  LearningStats.recordAnswer(isCorrect);
  updateChallengeScore();
}

// 왜 틀렸나요? AI 설명
async function explainWhyWrong(num, mode) {
  let userAnswer = '';
  let correctAnswer = '';
  let resultDiv = null;
  let question = '';

  if (mode === 'challenge') {
    const state = challengeStates.find(s => s.challengeNum === num);
    const textarea = document.getElementById(`challenge-${num}`)?.querySelector('textarea');
    userAnswer = textarea?.value || '';
    correctAnswer = state?.answer || '';
    resultDiv = document.getElementById(`challenge-result-${num}`);
    question = state?.signature || '';
  } else if (mode === 'vocab') {
    const state = vocabStates.find(s => s.wordNum === num);
    const textarea = document.getElementById(`vocab-input-${num}`);
    userAnswer = textarea?.value || '';
    correctAnswer = state?.correctAnswer || '';
    resultDiv = document.getElementById(`vocab-result-${num}`);
    question = state?.english || '';
  } else if (mode === 'definition') {
    const state = definitionStates.find(s => s.defNum === num);
    const textarea = document.getElementById(`def-input-${num}`);
    userAnswer = textarea?.value || '';
    correctAnswer = state?.correctAnswer || '';
    resultDiv = document.getElementById(`def-result-${num}`);
    question = state?.term || '';
  }

  if (!resultDiv) return;

  resultDiv.innerHTML = `<span style="color: var(--accent-2);">🤔 차이점 분석 중...</span>`;

  // 더 간결한 프롬프트 - 2-3줄 차이점만
  const prompt = `정답 코드와 내 코드를 비교해서 뭐가 틀렸는지 2-3줄로만 알려줘.

정답:
\`\`\`
${correctAnswer}
\`\`\`

내 코드:
\`\`\`
${userAnswer}
\`\`\`

요구사항:
- 전체 코드 흐름 설명 절대 금지
- 빠진 줄이나 틀린 부분만 콕 집어서 말해
- "~줄이 빠짐" 또는 "~대신 ~써야함" 형태로 간단하게
- 최대 2-3줄`;

  try {
    const response = await callGeminiAPI(prompt, "2-3줄로 차이점만 말해. 설명하지 마.");
    resultDiv.innerHTML = `
      <div style="background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 8px; padding: 12px; margin-top: 8px;">
        <div style="color: #ff6b6b; font-weight: bold; margin-bottom: 6px;">❓ 왜 틀렸나요?</div>
        <div style="color: var(--fg);">${escapeHtml(response)}</div>
      </div>`;
  } catch (err) {
    resultDiv.innerHTML = `<span class="mc-wrong">❌ 분석 오류: ${err.message}</span>`;
  }
}

function handleChallengeShow(num) {
  const card = document.getElementById(`challenge-${num}`);
  const textarea = card.querySelector("textarea");
  const state = challengeStates.find(s => s.challengeNum === num);

  textarea.value = state.answer;
  textarea.disabled = true;
  textarea.classList.remove("wrong");
  textarea.classList.add("revealed");

  state.answered = true;
  state.isCorrect = false;

  const resultDiv = document.getElementById(`challenge-result-${num}`);
  resultDiv.innerHTML = `<span class="mc-wrong">정답이 표시되었습니다</span>`;

  const nav = document.getElementById(`nav-challenge-${num}`);
  if (nav) {
    nav.classList.remove("pending", "wrong");
    nav.classList.add("revealed");
  }

  updateChallengeScore();
}

function handleChallengeReset(num) {
  const card = document.getElementById(`challenge-${num}`);
  const textarea = card.querySelector("textarea");
  const state = challengeStates.find(s => s.challengeNum === num);

  // 상태 리셋
  textarea.value = "";
  textarea.disabled = false;
  textarea.classList.remove("correct", "wrong", "revealed", "retried");
  textarea.focus();

  state.answered = false;
  state.isCorrect = null;
  state.hasBeenWrong = false;
  challengeReviewQueue.delete(String(num));

  // 결과 초기화
  const resultDiv = document.getElementById(`challenge-result-${num}`);
  resultDiv.innerHTML = "";

  // 네비게이션 초기화
  const nav = document.getElementById(`nav-challenge-${num}`);
  if (nav) {
    nav.classList.remove("correct", "wrong", "revealed", "retried");
    nav.classList.add("pending");
  }

  updateChallengeScore();
}

function renderChallengeNav() {
  blankList.innerHTML = "";
  challengeStates.forEach((s) => {
    const btn = document.createElement("div");
    btn.className = "blank-pill pending";
    btn.id = `nav-challenge-${s.challengeNum}`;
    btn.textContent = `C${s.challengeNum}`;
    btn.addEventListener("click", () => {
      const target = document.getElementById(`challenge-${s.challengeNum}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    blankList.appendChild(btn);
  });
  applyNavFilter();
}

function updateChallengeScore() {
  const total = challengeStates.length;
  const correct = challengeStates.filter(s => s.isCorrect).length;
  const answered = challengeStates.filter(s => s.answered).length;
  const retried = challengeStates.filter(s => s.isCorrect && s.hasBeenWrong).length;
  const wrong = challengeStates.filter(s => s.answered && !s.isCorrect).length;

  sessionScore.textContent = `${correct} / ${total}`;
  const ratio = total ? (correct / total) * 100 : 0;
  sessionProgress.style.width = `${ratio}%`;

  if (reviewBadge) {
    const reviewCount = wrong + retried;
    if (reviewCount) {
      reviewBadge.textContent = `복습 ${reviewCount}개`;
    } else if (answered === total) {
      reviewBadge.textContent = `완료! ${correct}/${total}`;
    } else {
      reviewBadge.textContent = `진행 중 ${answered}/${total}`;
    }
  }
  applyNavFilter();
}

function renderBlankNav() {
  blankList.innerHTML = "";
  inputs.forEach((inp) => {
    const key = inp.dataset.key;
    const btn = document.createElement("div");
    btn.className = "blank-pill pending";
    btn.id = `nav-${key}`;
    btn.textContent = `#${key}`;
    btn.addEventListener("click", () => {
      const target = document.getElementById(`blank-${key}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      inp.focus();
    });
    blankList.appendChild(btn);
  });
  applyNavFilter();
}

function applyNavFilter() {
  const pills = document.querySelectorAll("#blank-list .blank-pill");
  pills.forEach((pill) => {
    const isDone =
      pill.classList.contains("correct") ||
      pill.classList.contains("revealed") ||
      pill.classList.contains("retried");
    pill.style.display = hideCompletedNav && isDone ? "none" : "";
  });
}

function checkOne(input) {
  const expected = input.dataset.answer;
  if (expected === undefined) return null;
  if (input.dataset.revealed === "true") {
    setState(input, "revealed");
    return false;
  }
  const user = input.value.trim();
  const key = input.dataset.key;
  const isCorrect = user === expected.trim();

  // 빨간 물음표 버튼 표시/숨김
  const whyBtn = input.parentElement?.querySelector('.why-wrong-btn');

  if (!user) {
    setState(input, "pending");
    if (whyBtn) whyBtn.style.display = 'none';
  } else {
    setState(input, isCorrect ? "correct" : "wrong");
    if (whyBtn) whyBtn.style.display = isCorrect ? 'none' : 'inline-flex';
  }
  toggleReview(key, !isCorrect && !!user);
  updateScore();
  return isCorrect;
}

function checkAll() {
  // Mode 7 (영단어) 처리
  if (vocabStates && vocabStates.length > 0) {
    const unansweredIndices = vocabStates
      .filter(s => !s.answered && !s.needsAi)
      .map(s => s.wordNum);

    if (unansweredIndices.length === 0) {
      alert('모든 영단어가 이미 채점되었습니다.');
      return;
    }

    unansweredIndices.forEach(num => handleVocabCheck(num));
    return;
  }

  // Mode 5 (정의 퀴즈) 처리
  if (definitionStates && definitionStates.length > 0) {
    const unansweredIndices = definitionStates
      .filter(s => !s.answered)
      .map(s => s.defNum);

    if (unansweredIndices.length === 0) {
      alert('모든 정의가 이미 채점되었습니다.');
      return;
    }

    // 순차적으로 각 정의 채점 (AI 사용 시)
    const checkNextDef = async (indices) => {
      if (indices.length === 0) {
        updateDefinitionScore();
        return;
      }
      const num = indices[0];
      await handleDefinitionCheck(num);
      setTimeout(() => checkNextDef(indices.slice(1)), 300);
    };

    checkNextDef(unansweredIndices);
    return;
  }

  // Mode 3 (백지복습 / 챌린지 모드) 처리
  if (challengeStates.length > 0) {
    const unansweredIndices = challengeStates
      .filter(s => !s.answered)
      .map(s => s.challengeNum);

    if (unansweredIndices.length === 0) {
      alert('모든 챌린지가 이미 채점되었습니다.');
      return;
    }

    // 순차적으로 각 챌린지 채점 시작
    const checkNextChallenge = async (indices) => {
      if (indices.length === 0) {
        updateChallengeScore();
        return;
      }
      const num = indices[0];
      await handleChallengeCheck(num);
      // 약간의 딜레이 후 다음 채점 (API 과부하 방지)
      setTimeout(() => checkNextChallenge(indices.slice(1)), 500);
    };

    checkNextChallenge(unansweredIndices);
    return;
  }

  // 일반 빈칸 모드
  inputs.forEach((input) => checkOne(input));
}

function revealAll() {
  inputs.forEach((input) => revealOne(input, { autoAdvance: false }));
  updateScore();
}

function resetInputs() {
  inputs.forEach((input) => {
    input.value = "";
    delete input.dataset.revealed;
    setState(input, "pending");
  });
  reviewQueue = new Set();
  updateScore();
}

function updateScore() {
  if (!hasAnswers) {
    sessionScore.textContent = "정답 키 없음";
    sessionProgress.style.width = "0%";
    if (reviewBadge) reviewBadge.textContent = "정답 키 없음";
    return;
  }
  let correct = 0;
  let revealed = 0;
  inputs.forEach((input) => {
    if (input.classList.contains("correct") || input.classList.contains("retried")) correct += 1;
    if (input.classList.contains("revealed")) revealed += 1;
  });
  sessionScore.textContent =
    `${correct} / ${inputs.length}` +
    (reviewQueue.size ? ` (복습 ${reviewQueue.size})` : revealed ? ` (정답 표시 ${revealed})` : "");
  const ratio = inputs.length ? (correct / inputs.length) * 100 : 0;
  sessionProgress.style.width = `${ratio}%`;
  if (reviewBadge) {
    const pending = Math.max(inputs.length - correct - revealed, 0);
    if (reviewQueue.size) {
      reviewBadge.textContent = `복습 ${reviewQueue.size}개`;
    } else if (pending > 0) {
      reviewBadge.textContent = `미채점 ${pending}개`;
    } else {
      reviewBadge.textContent = "모든 빈칸 완료";
    }
  }
  applyNavFilter();
}

function focusNext(current) {
  const idx = inputs.indexOf(current);
  const next = inputs[idx + 1];
  if (next) next.focus();
}

function setState(input, state, { preserveReview = false } = {}) {
  input.classList.remove("correct", "wrong", "revealed", "retried");
  const nav = document.getElementById(`nav-${input.dataset.key}`);
  nav && nav.classList.remove("pending", "correct", "wrong", "revealed", "retried");
  const key = input.dataset.key;
  if (state !== "revealed") delete input.dataset.revealed;
  switch (state) {
    case "correct":
      if (input.dataset.hasBeenWrong === "true") {
        input.classList.add("retried");
        nav && nav.classList.add("retried");
        if (!preserveReview) toggleReview(key, true);
      } else {
        input.classList.add("correct");
        nav && nav.classList.add("correct");
        if (!preserveReview) toggleReview(key, false);
      }
      break;
    case "wrong":
      input.dataset.hasBeenWrong = "true";
      input.classList.add("wrong");
      nav && nav.classList.add("wrong");
      if (!preserveReview) toggleReview(key, true);
      break;
    case "revealed":
      input.dataset.revealed = "true";
      input.dataset.hasBeenWrong = "true";
      input.classList.add("revealed");
      nav && nav.classList.add("revealed");
      if (!preserveReview) toggleReview(key, true);
      break;
    default:
      delete input.dataset.hasBeenWrong;
      nav && nav.classList.add("pending");
      if (!preserveReview) toggleReview(key, false);
  }
}

function toggleReview(key, shouldAdd) {
  if (!key) return;
  if (shouldAdd) reviewQueue.add(String(key));
  else reviewQueue.delete(String(key));
}

function revealOne(input, { autoAdvance = true } = {}) {
  const expected = input.dataset.answer;
  if (expected === undefined) return;
  const userCorrect = input.value.trim() === expected.trim();
  const alreadyRevealed = input.dataset.revealed === "true";
  if (alreadyRevealed) {
    setState(input, "revealed");
  } else if (!userCorrect) {
    input.value = expected;
    setState(input, "revealed");
  } else {
    setState(input, "correct");
  }
  updateScore();
  if (autoAdvance) focusNext(input);
}

function handleEnter(input) {
  // 2단계 채점 시스템:
  // 1단계: 정답/오답 표시만
  // 2단계: 오답인 경우 정답 표시 (노란색)

  // 이미 오답으로 표시된 상태에서 다시 Enter를 누르면 정답 표시
  if (input.classList.contains("wrong") && !input.classList.contains("revealed")) {
    // 2단계: 정답 표시 (노란색)
    revealOne(input, { autoAdvance: true });
    return;
  }

  // 이미 채점 완료된 상태면 다음으로 이동
  if (input.classList.contains("correct") || input.classList.contains("revealed")) {
    focusNext(input);
    return;
  }

  // 1단계: 채점만 수행
  const ok = checkOne(input);
  if (ok === null) {
    if (!warnedMissingAnswers && !hasAnswers) {
      alert(missingAnswerMessage);
      warnedMissingAnswers = true;
    }
    return;
  }

  if (!ok) {
    // 오답: 빨간색만 표시 (정답은 아직 표시 안 함)
    setState(input, "wrong");
    SoundEffects.play("wrong");
    LearningStats.recordAnswer(false);
    updateScore();
    // 다음 Enter를 기다림 (자동 정답 표시 제거)
  } else {
    // 정답
    SoundEffects.play("correct");
    LearningStats.recordAnswer(true);
    focusNext(input);
  }
}

function startReviewCycle() {
  // 4번 모드(파싱된 객관식/단답) 우선 처리
  if (parsedQuizStates.length > 0) {
    const reviewTargets = parsedQuizStates.filter(
      (s) => s.isCorrect === false || s.isCorrect === null || !s.answered
    );

    if (!reviewTargets.length) {
      alert("복습할 문제가 없습니다. 먼저 틀린 문제나 미응답 문제를 만들어주세요.");
      return;
    }

    // 큐 초기화 후 대상 추가
    reviewQueue = new Set(reviewTargets.map((s) => String(s.qId)));

    // UI/상태 리셋 + 비대상 카드 숨김
    parsedQuizStates.forEach((s) => {
      const isTarget = reviewQueue.has(String(s.qId));
      const card = document.getElementById(`pq-${s.qId}`);
      if (card) {
        card.style.display = isTarget ? "" : "none";
        card.querySelectorAll(".mc-option").forEach((opt) => {
          opt.disabled = !isTarget;
          opt.classList.remove("correct", "wrong", "selected");
        });
        const textarea = card.querySelector("textarea");
        if (textarea) {
          textarea.disabled = !isTarget;
          if (isTarget) {
            textarea.value = "";
            textarea.style.background = "rgba(255,255,255,0.05)";
            textarea.style.borderColor = "rgba(255,255,255,0.1)";
          }
        }
        const resultDiv = document.getElementById(`pq-result-${s.qId}`);
        if (resultDiv && isTarget) resultDiv.innerHTML = "";
      }
      const nav = document.getElementById(`nav-pq-${s.qId}`);
      if (nav) {
        nav.style.display = isTarget ? "" : "none";
        nav.classList.remove("correct", "wrong", "revealed");
        if (isTarget) nav.classList.add("pending");
      }
      if (isTarget) {
        s.answered = false;
        s.isCorrect = null;
        s.selected = null;
      }
    });

    updateParsedQuizScore();
    focusNextReview();
    return;
  }

  // Mode 3 챌린지 (백지 연습)
  if (challengeStates.length > 0) {
    const reviewTargets = challengeStates.filter(
      (s) => s.isCorrect === false || !s.answered || s.hasBeenWrong
    );
    if (!reviewTargets.length) {
      alert("복습할 문제가 없습니다. 먼저 틀린 문제나 미응답 문제를 만들어주세요.");
      return;
    }
    reviewQueue = new Set(reviewTargets.map((s) => String(s.challengeNum)));
    challengeStates.forEach((s) => {
      const isTarget = reviewQueue.has(String(s.challengeNum));
      const card = document.getElementById(`challenge-${s.challengeNum}`);
      if (card) {
        card.style.display = isTarget ? "" : "none";
        const textarea = card.querySelector("textarea");
        const resultDiv = document.getElementById(`challenge-result-${s.challengeNum}`);
        if (textarea) {
          textarea.disabled = !isTarget;
          if (isTarget) {
            textarea.value = "";
            textarea.classList.remove("correct", "wrong", "revealed", "retried");
            if (resultDiv) resultDiv.innerHTML = "";
          }
        }
      }
      const nav = document.getElementById(`nav-challenge-${s.challengeNum}`);
      if (nav) {
        nav.style.display = isTarget ? "" : "none";
        nav.classList.remove("correct", "wrong", "retried", "revealed");
        if (isTarget) nav.classList.add("pending");
      }
      if (isTarget) {
        s.answered = false;
        s.isCorrect = null;
        s.hasBeenWrong = false;
      }
    });
    updateChallengeScore();
    focusNextReview();
    return;
  }

  // 정의 퀴즈 / 영단어 카드
  if (definitionStates.length > 0 || vocabStates.length > 0) {
    const defTargets = definitionStates.filter((s) => s.isCorrect === false || !s.answered);
    const vocabTargets = vocabStates.filter((s) => s.isCorrect === false || !s.answered);
    if (!defTargets.length && !vocabTargets.length) {
      alert("복습할 카드가 없습니다.");
      return;
    }
    reviewQueue = new Set([
      ...defTargets.map((s) => `definition-${s.defNum}`),
      ...vocabTargets.map((s) => `vocab-${s.wordNum}`)
    ]);

    // 정의 카드
    definitionStates.forEach((s) => {
      const isTarget = reviewQueue.has(`definition-${s.defNum}`);
      const card = document.getElementById(`definition-${s.defNum}`);
      if (card) {
        card.style.display = isTarget ? "" : "none";
        const textarea = document.getElementById(`def-input-${s.defNum}`);
        const resultDiv = document.getElementById(`def-result-${s.defNum}`);
        if (textarea) {
          textarea.disabled = !isTarget;
          if (isTarget) {
            textarea.value = "";
            textarea.classList.remove("correct", "wrong", "revealed", "retried");
            if (resultDiv) resultDiv.innerHTML = "";
          }
        }
      }
    });

    // 영단어 카드
    vocabStates.forEach((s) => {
      const isTarget = reviewQueue.has(`vocab-${s.wordNum}`);
      const card = document.getElementById(`vocab-${s.wordNum}`);
      if (card) {
        card.style.display = isTarget ? "" : "none";
        const textarea = document.getElementById(`vocab-input-${s.wordNum}`);
        const resultDiv = document.getElementById(`vocab-result-${s.wordNum}`);
        if (textarea) {
          textarea.disabled = !isTarget;
          if (isTarget) {
            textarea.value = "";
            textarea.classList.remove("correct", "wrong", "revealed", "retried");
            if (resultDiv) resultDiv.innerHTML = "";
          }
        }
      }
    });

    updateDefinitionScore();
    updateVocabScore();
    focusNextReview();
    return;
  }

  // 일반 빈칸 모드
  const targets = inputs.filter(
    (inp) =>
      inp.classList.contains("wrong") ||
      inp.classList.contains("revealed") ||
      inp.classList.contains("retried")
  );
  if (!targets.length && !reviewQueue.size) {
    alert("복습할 빈칸이 없습니다. 먼저 채점/정답을 확인해주세요.");
    return;
  }
  reviewQueue = new Set(reviewQueue);
  targets.forEach((inp) => {
    reviewQueue.add(inp.dataset.key);
  });
  // 대상 외 빈칸은 비활성/숨김, 대상은 리셋
  inputs.forEach((inp) => {
    const isTarget = reviewQueue.has(inp.dataset.key);
    const nav = document.getElementById(`nav-${inp.dataset.key}`) || document.getElementById(`nav-blank-${inp.dataset.key}`);
    if (isTarget) {
      inp.value = "";
      inp.disabled = false;
      setState(inp, "pending", { preserveReview: true });
      inp.style.opacity = "1";
      if (nav) nav.style.display = "";
    } else {
      inp.disabled = true;
      inp.style.opacity = "0.3";
      if (nav) nav.style.display = "none";
    }
  });
  updateScore();
  focusNextReview();
}

function focusNextReview() {
  if (parsedQuizStates.length > 0) {
    if (!reviewQueue.size) {
      alert("복습 큐가 비어 있습니다.");
      return;
    }
    const [qId] = reviewQueue;
    const card = document.getElementById(`pq-${qId}`);
    const textarea = card?.querySelector("textarea");
    const option = card?.querySelector(".mc-option");

    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      if (textarea) {
        textarea.focus();
        textarea.select();
      } else if (option) {
        option.focus();
      }
    }
    return;
  }

  if (challengeStates.length > 0) {
    if (!reviewQueue.size) {
      alert("복습 큐가 비어 있습니다.");
      return;
    }
    const [id] = reviewQueue;
    const card = document.getElementById(`challenge-${id}`);
    const textarea = card?.querySelector("textarea");
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      if (textarea) {
        textarea.focus();
        textarea.select();
      }
    }
    return;
  }

  if (definitionStates.length > 0 || vocabStates.length > 0) {
    if (!reviewQueue.size) {
      alert("복습 큐가 비어 있습니다.");
      return;
    }
    const [key] = reviewQueue;
    let card = null;
    if (key.startsWith("definition-")) {
      card = document.getElementById(key);
    } else if (key.startsWith("vocab-")) {
      card = document.getElementById(key);
    }
    const textarea = card?.querySelector("textarea");
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      if (textarea) {
        textarea.focus();
        textarea.select();
      }
    }
    return;
  }

  if (!reviewQueue.size) {
    alert("복습 큐가 비어 있습니다.");
    return;
  }
  const [key] = reviewQueue;
  const target = document.getElementById(`blank-${key}`);
  const input = inputs.find((inp) => inp.dataset.key === key);
  if (target && input) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus();
    input.select();
  }
}

function highlightAnswer(language) {
  if (!answerBlock) return;
  answerBlock.className = `answer-block language-${language || "plaintext"}`;
  if (window.hljs) {
    window.hljs.highlightElement(answerBlock);
  }
}

// ========== BUTTON EVENT HANDLERS ==========
// DOMContentLoaded 대신 즉시 실행 함수로 변경 (동적 스크립트 로드 대응)
function initializeButtonHandlers() {
  // 핸드폰 접속 주소 및 ngrok URL 로드 및 표시
  const mobileUrlEl = document.getElementById("mobile-url");
  const ngrokUrlEl = document.getElementById("ngrok-url");

  // server_info.json에서 IP 및 ngrok URL 로드
  fetch("/server_info.json")
    .then(r => r.json())
    .then(info => {
      const currentPort = window.location.port || "8000";

      // 모바일 URL 표시
      if (mobileUrlEl) {
        const mobileUrl = `http://${info.local_ip}:${currentPort}`;
        mobileUrlEl.textContent = `📱 ${mobileUrl}`;
        mobileUrlEl.title = "클릭하면 복사";
      }

      // ngrok URL 표시 (있는 경우에만)
      if (ngrokUrlEl && info.ngrok_url) {
        ngrokUrlEl.textContent = `🌐 ${info.ngrok_url}`;
        ngrokUrlEl.title = "클릭하면 복사 (외부 접속용)";
        ngrokUrlEl.style.display = "inline-block";

        // 클릭하면 복사
        ngrokUrlEl.addEventListener("click", () => {
          navigator.clipboard.writeText(info.ngrok_url).then(() => {
            const original = ngrokUrlEl.textContent;
            ngrokUrlEl.textContent = "✓ 복사됨!";
            ngrokUrlEl.classList.add("copied");
            setTimeout(() => {
              ngrokUrlEl.textContent = original;
              ngrokUrlEl.classList.remove("copied");
            }, 1500);
          });
        });
      }
    })
    .catch(() => {
      // server_info.json 없으면 현재 호스트 사용
      if (mobileUrlEl) {
        const currentHost = window.location.hostname;
        const currentPort = window.location.port || "8000";
        if (currentHost === "localhost" || currentHost === "127.0.0.1") {
          mobileUrlEl.textContent = "📱 같은 WiFi에서 PC IP:8000";
        } else {
          mobileUrlEl.textContent = `📱 http://${currentHost}:${currentPort}`;
        }
      }
    });

  // 모바일 URL 클릭하면 복사
  if (mobileUrlEl) {
    mobileUrlEl.addEventListener("click", () => {
      const url = mobileUrlEl.textContent.replace("📱 ", "");
      navigator.clipboard.writeText(url).then(() => {
        const original = mobileUrlEl.textContent;
        mobileUrlEl.textContent = "✓ 복사됨!";
        mobileUrlEl.classList.add("copied");
        setTimeout(() => {
          mobileUrlEl.textContent = original;
          mobileUrlEl.classList.remove("copied");
        }, 1500);
      });
    });
  }

  // 전체 채점
  const btnCheckLocal = document.getElementById("btn-check");
  if (btnCheckLocal) {
    btnCheckLocal.addEventListener("click", () => {
      // parsed_quiz 모드
      if (parsedQuizStates.length > 0) {
        const answered = parsedQuizStates.filter(s => s.answered).length;
        const total = parsedQuizStates.length;
        alert(`📊 현재 진행 상황\n\n완료: ${answered} / ${total}개\n남은 문제: ${total - answered}개\n\n※ 파싱된 문제는 정답을 알 수 없어 채점이 불가합니다.`);
        return;
      }
      // 일반 빈칸 채점
      inputs.forEach((inp) => checkOne(inp, false));
      updateScore();
    });
  }

  // 전체 정답 보기
  const btnRevealLocal = document.getElementById("btn-reveal");
  if (btnRevealLocal) {
    btnRevealLocal.addEventListener("click", () => {
      // parsed_quiz 모드
      if (parsedQuizStates.length > 0) {
        // 모든 문제에 "선택됨" 표시만 표시 (정답을 모르므로)
        parsedQuizStates.forEach(s => {
          if (!s.answered) {
            const resultDiv = document.getElementById(`pq-result-${s.qId}`);
            if (resultDiv) {
              resultDiv.innerHTML = `<span style="color: var(--yellow);">⚠️ 미응답</span>`;
            }
            const nav = document.getElementById(`nav-pq-${s.qId}`);
            if (nav) {
              nav.classList.add("revealed");
            }
          }
        });
        alert("📚 파싱된 문제에는 정답 정보가 포함되어 있지 않습니다.\n\nPython 코드 파일로 세션을 생성하면 자동 채점이 가능합니다.");
        return;
      }
      // 일반 빈칸
      inputs.forEach((inp) => revealOne(inp));
      updateScore();
    });
  }

  // 복습 모드 시작
  const btnReview = document.getElementById("btn-review");
  if (btnReview) {
    btnReview.addEventListener("click", startReviewCycle);
  }

  // 리셋
  const btnReset = document.getElementById("btn-reset");
  if (btnReset) {
    btnReset.addEventListener("click", () => {
      if (confirm("모든 답변을 초기화하시겠습니까?")) {
        // parsed_quiz 모드
        if (parsedQuizStates.length > 0) {
          parsedQuizStates.forEach(s => {
            s.answered = false;
            s.selected = null;
            s.userAnswer = "";

            // UI 초기화
            const cardDiv = document.getElementById(`pq-${s.qId}`);
            if (cardDiv) {
              cardDiv.querySelectorAll(".mc-option").forEach(opt => {
                opt.disabled = false;
                opt.classList.remove("selected", "correct", "wrong");
              });
              const textarea = cardDiv.querySelector("textarea");
              if (textarea) {
                textarea.disabled = false;
                textarea.value = "";
                textarea.style.background = "rgba(255,255,255,0.05)";
                textarea.style.borderColor = "rgba(255,255,255,0.1)";
              }
            }
            const resultDiv = document.getElementById(`pq-result-${s.qId}`);
            if (resultDiv) resultDiv.innerHTML = "";

            const nav = document.getElementById(`nav-pq-${s.qId}`);
            if (nav) {
              nav.classList.remove("correct", "wrong", "revealed");
              nav.classList.add("pending");
            }
          });
          updateParsedQuizScore();
          return;
        }
        // 일반 빈칸
        inputs.forEach((inp) => {
          inp.value = "";
          setState(inp, "pending");
        });
        reviewQueue.clear();
        updateScore();
      }
    });
  }

  // API 키 버튼들
  const btnApiKey = document.getElementById("btn-api-key");
  if (btnApiKey) {
    btnApiKey.addEventListener("click", showApiKeyModal);
  }

  const btnSaveApiKey = document.getElementById("btn-save-api-key");
  if (btnSaveApiKey) {
    btnSaveApiKey.addEventListener("click", () => {
      const key = document.getElementById("api-key-input").value.trim();
      if (key) {
        setApiKey(key);
        hideApiKeyModal();
        alert("API 키가 저장되었습니다.");
      }
    });
  }

  const btnCancelApiKey = document.getElementById("btn-cancel-api-key");
  if (btnCancelApiKey) {
    btnCancelApiKey.addEventListener("click", hideApiKeyModal);
  }

  // 키보드 단축키 버튼
  const btnShortcuts = document.getElementById("btn-shortcuts");
  if (btnShortcuts) {
    btnShortcuts.addEventListener("click", () => KeyboardShortcuts.showHelp());
  }

  // 맨 위로 버튼
  const btnScrollTop = document.getElementById("btn-scroll-top");
  if (btnScrollTop) {
    btnScrollTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // 학습 타이머 시작 (세션 로드될 때도 시작)
  StudyTimer.start();

  // 이전 세션 복원 시도
  setTimeout(() => SessionSaver.restore(), 500);

  // 알림 권한 요청 (Pomodoro 알림용)
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// DOMContentLoaded 이벤트가 이미 발생했는지 확인 (동적 스크립트 로드 시)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeButtonHandlers);
} else {
  // 이미 DOM이 로드된 상태면 즉시 실행
  initializeButtonHandlers();
}

// ========== DEFINITION QUIZ (Mode 5) ==========
let definitionStates = [];

function renderDefinitionQuiz(definitions, answerKey, language) {
  codeArea.innerHTML = "";
  blankList.innerHTML = "";
  inputs = [];
  reviewQueue = new Set();
  definitionStates = [];

  const frag = document.createDocumentFragment();

  definitions.forEach((def, idx) => {
    const defNum = idx + 1;
    const correctAnswer = def.definition;

    const cardDiv = document.createElement("div");
    cardDiv.className = "definition-card";
    cardDiv.id = `definition-${defNum}`;

    // 용어 (Front)
    const termDiv = document.createElement("div");
    termDiv.className = "definition-term";
    termDiv.innerHTML = `<span class="definition-num">#${defNum}</span> <strong>${escapeHtml(def.term)}</strong>이란?`;
    cardDiv.appendChild(termDiv);

    // 입력 영역 (Back - 빈칸)
    const inputDiv = document.createElement("div");
    inputDiv.className = "definition-input-area";

    const textarea = document.createElement("textarea");
    textarea.className = "definition-input";
    textarea.id = `def-input-${defNum}`;
    textarea.dataset.key = String(defNum);
    textarea.dataset.answer = correctAnswer;
    textarea.placeholder = "정의를 입력하세요... (Enter로 AI 채점)";
    textarea.rows = 2;

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleDefinitionCheck(defNum);
      }
    });

    inputDiv.appendChild(textarea);
    cardDiv.appendChild(inputDiv);

    // 결과 표시
    const resultDiv = document.createElement("div");
    resultDiv.className = "definition-result";
    resultDiv.id = `def-result-${defNum}`;
    cardDiv.appendChild(resultDiv);

    frag.appendChild(cardDiv);

    definitionStates.push({
      defNum,
      term: def.term,
      correctAnswer,
      answered: false,
      isCorrect: null,
      hasBeenWrong: false
    });
  });

  codeArea.appendChild(frag);
  renderDefinitionNav();
  sessionCount.textContent = definitions.length;
  hasAnswers = true;
  updateDefinitionScore();
}

async function handleDefinitionCheck(defNum) {
  const state = definitionStates.find(s => s.defNum === defNum);
  if (!state || state.answered) return;

  const textarea = document.getElementById(`def-input-${defNum}`);
  const userAnswer = textarea.value.trim();

  if (!userAnswer) {
    alert("정의를 입력해주세요.");
    return;
  }

  const resultDiv = document.getElementById(`def-result-${defNum}`);
  resultDiv.innerHTML = `<span class="definition-loading">🤔 AI가 채점 중...</span>`;
  textarea.disabled = true;

  try {
    const isCorrect = await checkDefinitionWithAI(state.term, userAnswer, state.correctAnswer);

    state.answered = true;
    state.isCorrect = isCorrect;

    // 학습 통계 기록
    LearningStats.recordAnswer(isCorrect);
    SoundEffects.play(isCorrect ? 'correct' : 'wrong');

    textarea.classList.remove("correct", "wrong", "revealed", "retried");
    resultDiv.innerHTML = "";

    if (isCorrect) {
      if (state.hasBeenWrong) {
        textarea.classList.add("retried");
        reviewQueue.add(String(defNum));
        resultDiv.innerHTML = `<span class="mc-correct">✅ 정답! (재도전 성공)</span>`;
      } else {
        textarea.classList.add("correct");
        reviewQueue.delete(String(defNum));
        resultDiv.innerHTML = `<span class="mc-correct">✅ 정답!</span>`;
      }
    } else {
      state.hasBeenWrong = true;
      textarea.classList.add("wrong");
      reviewQueue.add(String(defNum));
      resultDiv.innerHTML = `
        <span class="mc-wrong">❌ 아쉽네요. 핵심 개념이 부족합니다.</span>
        <div class="definition-correct-answer">
          <strong>모범 답안:</strong> ${escapeHtml(state.correctAnswer)}
        </div>`;
    }

    const nav = document.getElementById(`nav-def-${defNum}`);
    if (nav) {
      nav.classList.remove("pending", "correct", "wrong", "retried", "revealed");
      if (isCorrect) {
        nav.classList.add(state.hasBeenWrong ? "retried" : "correct");
      } else {
        nav.classList.add("wrong");
      }
    }

    updateDefinitionScore();

    // 다음 문제로 포커스 (이전 답변이 보이도록)
    const nextState = definitionStates.find(s => !s.answered);
    if (nextState) {
      const nextInput = document.getElementById(`def-input-${nextState.defNum}`);
      const nextCard = document.querySelector(`#def-input-${nextState.defNum}`)?.closest('.definition-card');
      if (nextCard) {
        setTimeout(() => {
          const cardRect = nextCard.getBoundingClientRect();
          const scrollTop = window.scrollY + cardRect.top - (window.innerHeight * 0.25);
          window.scrollTo({ top: scrollTop, behavior: 'smooth' });
        }, 100);
      }
      if (nextInput) {
        setTimeout(() => nextInput.focus(), 150);
      }
    }
  } catch (err) {
    textarea.disabled = false;
    resultDiv.innerHTML = `<span class="mc-wrong">❌ 오류: ${err.message}</span>`;
  }
}

async function checkDefinitionWithAI(term, userAnswer, correctAnswer) {
  // 최소 길이 검사 (너무 짧은 답은 무조건 오답)
  if (userAnswer.length < 10) {
    return false;
  }

  const prompt = `당신은 매우 엄격한 OOP 기말시험 채점관입니다. 학점 인플레를 허용하지 않습니다.

**용어**: "${term}"
**모범 답안**: "${correctAnswer}"
**학생의 답**: "${userAnswer}"

## 채점 기준 (엄격하게 적용)
1. **핵심 키워드 필수**: 모범 답안의 핵심 기술 용어가 포함되어야 함
2. **개념의 완전성**: 정의의 핵심 요소가 모두 설명되어야 함
3. **기술적 정확성**: CS 전공자가 보기에 정확한 설명이어야 함

## 반드시 오답 처리하는 경우
- "~지 뭐", "~인듯", "~같음" 등 애매한 표현
- 핵심 개념 없이 용어만 반복 (예: "쓰레드는 쓰레드다")
- 지나치게 짧거나 불성실한 답변
- 정의가 아닌 예시만 나열
- 기술적으로 부정확한 설명

## 정답으로 인정하는 경우
- 모범 답안과 표현은 다르지만 핵심 개념이 정확히 일치
- 추가 설명이 있지만 핵심이 맞음

**판정**: 위 기준에 따라 엄격하게 판단하세요.
JSON 형식으로만 응답 (다른 텍스트 없이):
{"correct": true 또는 false}`;

  try {
    const response = await callGeminiAPI(prompt, "JSON 형식으로만 응답하세요. 채점은 엄격하게.");
    const jsonMatch = response.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return result.correct === true;
    }
    // 파싱 실패 시 엄격한 비교
    return false;
  } catch (err) {
    console.error("AI grading error:", err);
    // AI 실패 시에도 엄격하게 - 정확히 일치해야 정답
    const normalize = s => s.replace(/\s+/g, '').toLowerCase();
    return normalize(userAnswer) === normalize(correctAnswer);
  }
}

function renderDefinitionNav() {
  blankList.innerHTML = "";
  definitionStates.forEach((s) => {
    const btn = document.createElement("div");
    btn.className = "blank-pill pending";
    btn.id = `nav-def-${s.defNum}`;
    btn.textContent = `#${s.defNum}`;
    btn.addEventListener("click", () => {
      const target = document.getElementById(`definition-${s.defNum}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      const input = document.getElementById(`def-input-${s.defNum}`);
      if (input && !input.disabled) input.focus();
    });
    blankList.appendChild(btn);
  });
  applyNavFilter();
}

function updateDefinitionScore() {
  const total = definitionStates.length;
  const answered = definitionStates.filter(s => s.answered).length;
  const correct = definitionStates.filter(s => s.isCorrect).length;
  const retried = definitionStates.filter(s => s.isCorrect && s.hasBeenWrong).length;
  const wrong = definitionStates.filter(s => s.answered && !s.isCorrect).length;

  sessionScore.textContent = `${correct} / ${total}`;
  const ratio = total ? (correct / total) * 100 : 0;
  sessionProgress.style.width = `${ratio}%`;

  if (reviewBadge) {
    const reviewCount = wrong + retried + reviewQueue.size;
    if (reviewCount) {
      reviewBadge.textContent = `복습 ${reviewCount}개`;
    } else if (answered === total) {
      const percentage = Math.round(ratio);
      reviewBadge.textContent = `완료! ${correct}/${total} (${percentage}%)`;
      reviewBadge.style.color = percentage >= 60 ? "var(--green)" : "var(--red)";
    } else {
      reviewBadge.textContent = `남은 문제 ${total - answered}개`;
    }
  }
  applyNavFilter();
}

// ========== VOCABULARY CARDS (Mode 7) ==========
let vocabStates = [];

function renderVocabularyCards(words, answerKey, language) {
  codeArea.innerHTML = "";
  blankList.innerHTML = "";
  inputs = [];
  reviewQueue = new Set();
  vocabStates = [];

  const needsAI = answerKey._needs_ai_generation;

  const frag = document.createDocumentFragment();

  words.forEach((word, idx) => {
    const wordNum = idx + 1;
    const correctAnswer = word.korean || "[AI 생성 필요]";

    const cardDiv = document.createElement("div");
    cardDiv.className = "vocab-card";
    cardDiv.id = `vocab-${wordNum}`;

    // 영어 단어
    const termDiv = document.createElement("div");
    termDiv.className = "vocab-term";
    termDiv.innerHTML = `<span class="vocab-num">#${wordNum}</span> <strong class="vocab-english">${escapeHtml(word.english)}</strong>`;
    cardDiv.appendChild(termDiv);

    // 한글 뜻 입력/표시
    const meaningDiv = document.createElement("div");
    meaningDiv.className = "vocab-meaning-area";

    if (word.needs_ai) {
      // AI가 생성해야 하는 경우
      const genBtn = document.createElement("button");
      genBtn.className = "vocab-gen-btn";
      genBtn.textContent = "🤖 AI 뜻 생성";
      genBtn.addEventListener("click", () => generateVocabMeaning(wordNum, word.english));
      meaningDiv.appendChild(genBtn);

      const genResult = document.createElement("div");
      genResult.className = "vocab-gen-result";
      genResult.id = `vocab-gen-${wordNum}`;
      meaningDiv.appendChild(genResult);
    } else {
      // 이미 뜻이 있는 경우 - 빈칸 테스트
      const textarea = document.createElement("textarea");
      textarea.className = "vocab-input";
      textarea.id = `vocab-input-${wordNum}`;
      textarea.dataset.key = String(wordNum);
      textarea.dataset.answer = correctAnswer;
      textarea.placeholder = "뜻을 입력하세요... (Enter로 확인)";
      textarea.rows = 1;

      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleVocabCheck(wordNum);
        }
      });

      meaningDiv.appendChild(textarea);
    }

    cardDiv.appendChild(meaningDiv);

    // 결과 표시
    const resultDiv = document.createElement("div");
    resultDiv.className = "vocab-result";
    resultDiv.id = `vocab-result-${wordNum}`;
    cardDiv.appendChild(resultDiv);

    frag.appendChild(cardDiv);

    vocabStates.push({
      wordNum,
      english: word.english,
      correctAnswer,
      needsAi: word.needs_ai,
      answered: false,
      isCorrect: null,
      hasBeenWrong: false
    });
  });

  codeArea.appendChild(frag);
  renderVocabNav();
  sessionCount.textContent = words.length;
  hasAnswers = !needsAI;
  updateVocabScore();
}

async function generateVocabMeaning(wordNum, english) {
  const resultDiv = document.getElementById(`vocab-gen-${wordNum}`);
  resultDiv.innerHTML = `<span class="definition-loading">🤖 AI가 뜻을 생성 중...</span>`;

  const prompt = `영어 단어 "${english}"의 한국어 뜻을 알려주세요.

중요 규칙:
1. 단순 음역(code→코드, interface→인터페이스)은 절대 안 됩니다.
2. 실제 의미를 한국어로 설명해주세요.
3. 간결하게 1-2줄로 작성하세요.

JSON 형식으로만 응답: {"meaning": "한국어 뜻"}`;

  try {
    const response = await callGeminiAPI(prompt, "JSON 형식으로만 응답하세요.");
    const jsonMatch = response.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      const meaning = result.meaning || "생성 실패";

      resultDiv.innerHTML = `
        <div class="vocab-generated">
          <strong>뜻:</strong> ${escapeHtml(meaning)}
        </div>`;

      // 상태 업데이트
      const state = vocabStates.find(s => s.wordNum === wordNum);
      if (state) {
        state.correctAnswer = meaning;
        state.answered = true;
        state.isCorrect = true;
      }

      const nav = document.getElementById(`nav-vocab-${wordNum}`);
      if (nav) {
        nav.classList.remove("pending");
        nav.classList.add("correct");
      }

      updateVocabScore();
    }
  } catch (err) {
    resultDiv.innerHTML = `<span class="mc-wrong">❌ 오류: ${err.message}</span>`;
  }
}

function handleVocabCheck(wordNum) {
  const state = vocabStates.find(s => s.wordNum === wordNum);
  if (!state || state.answered) return;

  const textarea = document.getElementById(`vocab-input-${wordNum}`);
  const userAnswer = textarea.value.trim();

  if (!userAnswer) return;

  const normalize = s => s.replace(/\s+/g, '').toLowerCase();
  const userNorm = normalize(userAnswer);

  const correctAnswers = state.correctAnswer.split(',').map(a => normalize(a.trim()));
  const isCorrect = correctAnswers.some(correct =>
    correct === userNorm ||
    correct.includes(userNorm) ||
    userNorm.includes(correct)
  );

  state.answered = true;
  state.isCorrect = isCorrect;
  textarea.disabled = true;
  textarea.classList.remove("correct", "wrong", "revealed", "retried");

  const resultDiv = document.getElementById(`vocab-result-${wordNum}`);

  if (isCorrect) {
    if (state.hasBeenWrong) {
      textarea.classList.add("retried");
      reviewQueue.add(String(wordNum));
      resultDiv.innerHTML = `<span class="mc-correct">✓ 정답! (재도전 성공)</span> <span style="color: var(--muted); margin-left: 8px;">(${escapeHtml(state.correctAnswer)})</span>`;
    } else {
      textarea.classList.add("correct");
      reviewQueue.delete(String(wordNum));
      resultDiv.innerHTML = `<span class="mc-correct">✓ 정답!</span> <span style="color: var(--muted); margin-left: 8px;">(${escapeHtml(state.correctAnswer)})</span>`;
    }
  } else {
    state.hasBeenWrong = true;
    textarea.classList.add("wrong");
    reviewQueue.add(String(wordNum));
    textarea.value = state.correctAnswer;
    textarea.classList.remove("wrong");
    textarea.classList.add("revealed");
    resultDiv.innerHTML = `<span class="mc-wrong">✗ 오답. 정답: ${escapeHtml(state.correctAnswer)}</span> <button onclick="explainWhyWrong(${wordNum}, 'vocab')" style="margin-left: 8px; background: linear-gradient(135deg, #ff6b6b, #ee5a5a); color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;">왜 틀렸나요?</button>`;
  }

  const nav = document.getElementById(`nav-vocab-${wordNum}`);
  if (nav) {
    nav.classList.remove("pending", "correct", "wrong", "revealed", "retried");
    if (isCorrect) {
      nav.classList.add(state.hasBeenWrong ? "retried" : "correct");
    } else {
      nav.classList.add("wrong");
    }
  }

  updateVocabScore();

  const nextState = vocabStates.find(s => !s.answered && !s.needsAi);
  if (nextState) {
    const nextCard = document.getElementById(`vocab-${nextState.wordNum}`);
    const nextInput = document.getElementById(`vocab-input-${nextState.wordNum}`);

    if (nextCard) {
      setTimeout(() => {
        nextCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          if (nextInput && !nextInput.disabled) {
            nextInput.focus({ preventScroll: true });
          }
        }, 120);
      }, 80);
    }
  }
}

function updateVocabScore() {
  const total = vocabStates.length;
  const answered = vocabStates.filter(s => s.answered).length;
  const correct = vocabStates.filter(s => s.isCorrect).length;
  const retried = vocabStates.filter(s => s.isCorrect && s.hasBeenWrong).length;
  const wrong = vocabStates.filter(s => s.answered && !s.isCorrect).length;

  sessionScore.textContent = `${correct} / ${total}`;
  const ratio = total ? (correct / total) * 100 : 0;
  sessionProgress.style.width = `${ratio}%`;

  if (reviewBadge) {
    const reviewCount = wrong + retried + reviewQueue.size;
    if (reviewCount) {
      reviewBadge.textContent = `복습 ${reviewCount}개`;
    } else if (answered === total) {
      reviewBadge.textContent = `완료! ${correct}/${total}`;
    } else {
      reviewBadge.textContent = `남은 단어 ${total - answered}개`;
    }
  }
  applyNavFilter();
}

function renderVocabNav() {
  if (!blankList || !vocabStates || vocabStates.length === 0) return;

  blankList.innerHTML = "";
  vocabStates.forEach((s) => {
    const btn = document.createElement("div");
    btn.className = "blank-pill pending";
    btn.id = `nav-vocab-${s.wordNum}`;
    btn.textContent = `V${s.wordNum}`;

    if (s.answered) {
      btn.classList.remove("pending");
      btn.classList.add(s.isCorrect ? "correct" : "wrong");
      if (s.hasBeenWrong && s.isCorrect) {
        btn.classList.add("retried");
      }
    }

    btn.addEventListener("click", () => {
      const target = document.getElementById(`vocab-${s.wordNum}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    blankList.appendChild(btn);
  });
  applyNavFilter();
}

// ========== FILE/MODE SELECTION MODAL ==========
function initializeFileModeModal() {
  const modal = document.getElementById("file-mode-modal");
  const btnOpen = document.getElementById("btn-file-mode");
  const btnCancel = document.getElementById("btn-cancel-fm");
  const btnGenerate = document.getElementById("btn-generate-session");
  const statusEl = document.getElementById("fm-status");
  const selectedFileEl = document.getElementById("selected-file-name");

  // 현재 선택 상태
  let selectedPreset = "oop_vocab";
  let selectedMode = 7;

  const fileNames = {
    "oop_vocab": "1_OOP_Vocabulary.txt",
    "oop_concept": "2_OOP_Concepts.txt",
    "oop_code": "3_OOP_Code_Blanks.txt",
    "data_structure": "4_Data_Structure_Code.txt",
    "math_theory": "5_Computational_Math_Theory.txt",
    "math_practice": "6_Computational_Math_Practice.txt"
  };

  // 모달 자동 표시 함수
  function showFileModeModal() {
    if (modal) {
      modal.style.display = "flex";
      if (statusEl) {
        statusEl.textContent = "";
        statusEl.className = "fm-status";
      }
    }
  }

  // 세션 상태 확인 - 비어있거나 폴백 세션이면 모달 자동 표시
  function checkSessionAndShowModal() {
    // currentSession이 없거나 폴백 세션인지 확인
    if (!currentSession) {
      console.log("세션 없음 - 모달 표시");
      showFileModeModal();
      return;
    }

    // 폴백 세션 감지: title이 "기본 세션"이거나 answer_key가 비어있는 경우
    const isFallbackSession =
      currentSession.title === "기본 세션" ||
      (!currentSession.answer_key) ||
      (currentSession.answer_key._type === "whiteboard" &&
        (!currentSession.answer_key._challenges || currentSession.answer_key._challenges.length === 0));

    if (isFallbackSession) {
      console.log("폴백 세션 감지 - 모달 표시");
      showFileModeModal();
    }
  }

  // 세션 상태 확인 - initializeApp에서 이미 세션을 로드했으므로 즉시 체크
  checkSessionAndShowModal();

  // 모달 열기
  if (btnOpen) {
    btnOpen.addEventListener("click", () => {
      modal.style.display = "flex";
      statusEl.textContent = "";
      statusEl.className = "fm-status";
    });
  }

  // 모달 닫기
  if (btnCancel) {
    btnCancel.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  // 프리셋 파일 선택
  document.querySelectorAll(".fm-preset:not(.fm-upload)").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".fm-preset").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedPreset = btn.dataset.preset;
      customFileContent = null; // 프리셋 선택 시 커스텀 파일 초기화
      selectedFileEl.textContent = fileNames[selectedPreset] || selectedPreset;

      // 기본 모드 자동 선택 (data-default-mode 속성)
      const defaultMode = btn.dataset.defaultMode;
      if (defaultMode) {
        selectedMode = parseInt(defaultMode, 10);
        // 모드 버튼 UI 업데이트
        document.querySelectorAll(".fm-mode").forEach(m => m.classList.remove("active"));
        const modeBtn = document.querySelector(`.fm-mode[data-mode="${defaultMode}"]`);
        if (modeBtn) modeBtn.classList.add("active");
      }

      // 기본 방식 자동 선택: 모드/파일에 따라
      if (selectedPreset === "oop_code" || selectedPreset === "math_practice") {
        selectedMethod = "ai";
        document.querySelectorAll(".fm-method").forEach(m => m.classList.remove("active"));
        const aiMethodBtn = document.querySelector('.fm-method[data-method="ai"]');
        if (aiMethodBtn) aiMethodBtn.classList.add("active");
      } else {
        selectedMethod = "local";
        document.querySelectorAll(".fm-method").forEach(m => m.classList.remove("active"));
        const localBtn = document.querySelector('.fm-method[data-method="local"]');
        if (localBtn) localBtn.classList.add("active");
      }
    });
  });

  // 첫 번째 프리셋 활성화 + 기본 모드 설정
  const firstPreset = document.querySelector('.fm-preset:not(.fm-upload)');
  if (firstPreset) {
    firstPreset.classList.add('active');
    // 첫 프리셋의 기본 모드도 적용
    const defaultMode = firstPreset.dataset.defaultMode;
    if (defaultMode) {
      selectedMode = parseInt(defaultMode, 10);
      document.querySelectorAll(".fm-mode").forEach(m => m.classList.remove("active"));
      const modeBtn = document.querySelector(`.fm-mode[data-mode="${defaultMode}"]`);
      if (modeBtn) modeBtn.classList.add("active");
    }
  }

  // 파일 업로드 핸들러
  let customFileContent = null;
  let customFileName = null;
  const customFileInput = document.getElementById("custom-file-input");
  const uploadLabel = document.querySelector(".fm-upload");

  if (customFileInput) {
    customFileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        customFileContent = await file.text();
        customFileName = file.name;
        selectedPreset = "custom"; // 커스텀 파일 표시

        // UI 업데이트
        document.querySelectorAll(".fm-preset").forEach(b => b.classList.remove("active"));
        if (uploadLabel) uploadLabel.classList.add("active");
        selectedFileEl.textContent = `📁 ${file.name}`;

        statusEl.textContent = `✅ 파일 로드 완료: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`;
        statusEl.className = "fm-status";
      } catch (err) {
        statusEl.textContent = `❌ 파일 읽기 오류: ${err.message}`;
        statusEl.className = "fm-status error";
      }
    });
  }

  // 모드 선택
  document.querySelectorAll(".fm-mode").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".fm-mode").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedMode = parseInt(btn.dataset.mode, 10);
      // 모드 1, 6은 AI 필수, 나머지는 로컬 기본
      if (selectedMode === 1 || selectedMode === 6) {
        selectedMethod = "ai";
        document.querySelectorAll(".fm-method").forEach(m => m.classList.remove("active"));
        const aiBtn = document.querySelector('.fm-method[data-method="ai"]');
        if (aiBtn) aiBtn.classList.add("active");
      } else {
        selectedMethod = "local";
        document.querySelectorAll(".fm-method").forEach(m => m.classList.remove("active"));
        const localBtn = document.querySelector('.fm-method[data-method="local"]');
        if (localBtn) localBtn.classList.add("active");
      }

      // 모드 1, 2에서만 난이도 섹션 표시
      const diffSection = document.getElementById("difficulty-section");
      if (diffSection) {
        diffSection.style.display = (selectedMode === 1 || selectedMode === 2) ? "block" : "none";
      }
    });
  });

  // 생성 방식 선택
  let selectedMethod = "local";
  document.querySelectorAll(".fm-method").forEach(btn => {
    btn.addEventListener("click", () => {
      // 모드 1,6은 AI 고정
      if (selectedMode === 1 || selectedMode === 6) {
        selectedMethod = "ai";
        document.querySelectorAll(".fm-method").forEach(b => b.classList.remove("active"));
        const aiBtn = document.querySelector('.fm-method[data-method="ai"]');
        if (aiBtn) aiBtn.classList.add("active");
        return;
      }
      document.querySelectorAll(".fm-method").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedMethod = btn.dataset.method;
    });
  });

  // ========== 난이도 선택 ==========
  let selectedDifficulty = "normal";
  const difficultyHints = {
    easy: "쉬움: 주석 위주 20% 빈칸, 코드는 거의 그대로",
    normal: "보통: 주석 30% + 핵심 코드 40% 빈칸",
    hard: "어려움: 주석 50% + 코드 60% 빈칸 (키워드, 메서드명 포함)",
    extreme: "매우어려움: 거의 모든 코드 빈칸 80%+ (시험 대비용)"
  };

  document.querySelectorAll(".fm-diff").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".fm-diff").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedDifficulty = btn.dataset.diff;

      // 힌트 업데이트
      const hintEl = document.getElementById("diff-hint");
      if (hintEl) {
        hintEl.textContent = difficultyHints[selectedDifficulty] || "";
      }
    });
  });

  // 세션 생성
  if (btnGenerate) {
    btnGenerate.addEventListener("click", async () => {
      // ===== 모드 6: 전산수학 코드 작성 (프론트엔드에서 직접 처리) =====
      if (selectedMode === 6) {
        statusEl.textContent = "🤖 AI가 코드 작성 문제를 생성 중...";
        modal.style.display = "none";
        await renderMode6CodeWriting();
        return;
      }

      // ===== 모드 1: C# OOP 변형 빈칸 (프론트엔드에서 직접 처리) =====
      if (selectedMode === 1) {
        statusEl.textContent = "🤖 AI가 C# OOP 변형 문제를 생성 중...";
        modal.style.display = "none";
        await renderMode1OOPBlanks(selectedDifficulty);
        return;
      }

      const methodLabel = selectedMethod === "ai" ? "🤖 AI로" : "⚡ 로컬에서";
      statusEl.textContent = `${methodLabel} 세션 생성 중...`;
      statusEl.className = "fm-status";
      btnGenerate.disabled = true;

      try {
        // 요청 데이터 구성
        const requestData = {
          preset: selectedPreset,
          mode: selectedMode,
          method: selectedMethod
        };

        // 커스텀 파일이 선택된 경우 파일 내용 포함
        if (selectedPreset === "custom" && customFileContent) {
          requestData.content = customFileContent;
          requestData.fileName = customFileName;
        }

        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestData)
        });

        const result = await response.json();

        if (result.success) {
          const countInfo = result.questions
            ? `${result.questions}개 문제`
            : result.challenges
              ? `${result.challenges}개 챌린지`
              : `${result.blanks || 0}개 빈칸`;
          statusEl.textContent = `✅ 세션 생성 완료! (${countInfo})`;
          statusEl.className = "fm-status";

          // 세션 다시 로드 (리로드 없이)
          setTimeout(async () => {
            try {
              const sessionResponse = await fetch('session.json?t=' + Date.now());
              if (sessionResponse.ok) {
                const sessionData = await sessionResponse.json();
                setSession(sessionData);
                modal.style.display = 'none';
              }
            } catch (e) {
              console.error('세션 새로고침 실패:', e);
            }
          }, 300);
        } else {
          statusEl.textContent = `❌ 오류: ${result.error}`;
          statusEl.className = "fm-status error";
        }
      } catch (err) {
        statusEl.textContent = `❌ 네트워크 오류: ${err.message}`;
        statusEl.className = "fm-status error";
      } finally {
        btnGenerate.disabled = false;
      }
    });
  }

  // 모달 바깥 클릭 시 닫기
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
      }
    });
  }
}

// 동적 스크립트 로드 대응 + 세션 자동 로드
async function initializeApp() {
  // 세션 먼저 로드 (서버가 이미 생성한 session.json)
  try {
    const response = await fetch('session.json?t=' + Date.now());
    if (response.ok) {
      const data = await response.json();
      setSession(data);
      console.log('Session loaded:', data.title || 'untitled');
    } else {
      console.log('No session.json, waiting for modal');
    }
  } catch (e) {
    console.log('Session load error:', e.message);
  }

  // 모달 초기화 (세션 로드 후)
  initializeFileModeModal();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

// ========== MOBILE NAV TOGGLE ==========
(function () {
  const blankNav = document.getElementById('blank-nav');
  const btnToggleNav = document.getElementById('btn-toggle-nav');
  const btnShowNav = document.getElementById('btn-show-nav');

  if (btnShowNav) {
    btnShowNav.addEventListener('click', () => {
      blankNav?.classList.add('show');
    });
  }

  if (btnToggleNav) {
    btnToggleNav.addEventListener('click', () => {
      blankNav?.classList.remove('show');
    });
  }

  // 빈칸 목록에서 항목 클릭 시 자동으로 닫기 (모바일)
  document.getElementById('blank-list')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('blank-pill')) {
      if (window.innerWidth <= 768) {
        blankNav?.classList.remove('show');
      }
    }
  });
})();

// ========== CACHE CLEAR ON UNLOAD ==========
window.addEventListener("unload", () => {
  // 브라우저 캐시 초기화 시도
  if ('caches' in window) {
    caches.keys().then(names => {
      names.forEach(name => caches.delete(name));
    });
  }
});

// ============================================================================
// 모드 6: 전산수학 코드 작성 모드 (간단 요구사항 고정)
// ============================================================================

let mode6State = {
  problem: '',
  sampleCode: '',
  userCode: '',
  submitted: false,
  isCorrect: null
};

async function renderMode6CodeWriting() {
  const codeArea = document.getElementById('code-area');
  codeArea.innerHTML = `<div class="definition-loading">🤖 전산수학 기본 실습 프롬프트를 생성 중...</div>`;

  sessionTitle.textContent = "전산수학 코드 작성";
  sessionMode.textContent = "코드 작성 (AI)";

  // 기본 요구사항 로드 (파일 없으면 하드코딩)
  let baseLines = [];
  try {
    const resp = await fetch('/data/6_Computational_Math_Practice.txt?t=' + Date.now());
    if (!resp.ok) throw new Error('base file fetch failed');
    const text = await resp.text();
    baseLines = text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('- '))
      .map(l => l.replace(/^-\s*/, '').trim());
  } catch (e) {
    baseLines = [
      "Build a console menu loop in Python (while True + if/elif/else branching).",
      "Perform basic arithmetic (+, -, *, /) and log each operation.",
      "On exit, save the log to CSV (utf-8-sig) and support reload.",
      "Use pandas + matplotlib to plot the log."
    ];
  }

  const minorExtras = [
    "Add one user-defined function (e.g., run_menu).",
    "Guard divide-by-zero before performing division.",
    "Use at least one simple if/elif/else branch."
  ];

  // AI 프롬프트: 단순 메뉴 + 사칙연산 + CSV/pandas/matplotlib + 소형 제약만 추가
  const aiPrompt = `
당신은 전산수학 교수이자 실습 출제자입니다.
다음 '기본 요구사항'을 절대 벗어나지 말고, 요구사항에 꼭 맞는 단순 문제를 만들어 주세요.

[기본 요구사항]
${baseLines.map(l => "- " + l).join("\\n")}

[추가 제약 (아주 작게 1~2개만)]
- while True 또는 if/elif/else를 최소 한 번 포함
- 사용자 정의 함수 1개(run_menu 같은 이름) 포함
- 0으로 나누기 방지 로직 추가

출제 규칙:
- 새로운 도메인(환율, BMI, 가계부 등)을 만들지 말 것. 위 요구사항 그대로 콘솔 메뉴/계산기 흐름만 사용.
- 학생이 따라야 할 명령/단계만 작성. 불필요한 스토리/장식 금지.
- 코드 전체를 작성하라고 요구하지 말고, "위 요구사항에 맞춰 코드를 작성하시오" 수준으로 설명.
- JSON으로만 응답. 코드 블록이나 마크다운 금지.

응답 형식(JSON):
{
  "problem_title": "제목",
  "problem_description": "요구사항을 그대로 반영한 간단한 설명 (2~4줄)",
  "requirements": ["요구사항1", "요구사항2", "..."],
  "hints": ["힌트1", "힌트2"]
}`;

  try {
    const response = await callGeminiAPI(aiPrompt, "JSON only. No code fences, no markdown.");

    let problemData;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        problemData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("JSON 파싱 실패");
      }
    } catch (e) {
      throw new Error("문제 생성 실패: " + e.message);
    }

    const requirementList = problemData.requirements && problemData.requirements.length
      ? problemData.requirements
      : [...baseLines, ...minorExtras.slice(0, 2)];

    mode6State = {
      problem: problemData.problem_description || "",
      sampleCode: '',
      userCode: '',
      submitted: false,
      isCorrect: null
    };

    codeArea.innerHTML = `
      <div class="mode6-container" style="max-width: 900px; margin: 0 auto;">
        <div class="mode6-problem-card" style="background: linear-gradient(135deg, rgba(102, 126, 234, 0.1), rgba(118, 75, 162, 0.1)); border: 1px solid rgba(102, 126, 234, 0.3); border-radius: 12px; padding: 24px; margin-bottom: 20px;">
          <h2 style="color: #667eea; margin: 0 0 12px 0;">📝 ${escapeHtml(problemData.problem_title || "Computational Math Practice")}</h2>
          <p style="color: var(--text); line-height: 1.7; white-space: pre-line;">${escapeHtml(problemData.problem_description || "")}</p>
          <div style="margin-top: 16px;">
            <h4 style="color: var(--accent-2); margin: 0 0 8px 0;">✅ Requirements</h4>
            <ul style="color: var(--text); margin: 0; padding-left: 20px;">
              ${requirementList.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
            </ul>
          </div>
          ${problemData.hints && problemData.hints.length ? `
            <div style="margin-top: 12px;">
              <h4 style="color: var(--accent); margin: 0 0 8px 0;">💡 Hints</h4>
              <ul style="color: var(--text); margin: 0; padding-left: 20px;">
                ${problemData.hints.map(h => `<li>${escapeHtml(h)}</li>`).join('')}
              </ul>
            </div>
          ` : ""}
        </div>

        <div class="mode6-input-area" style="margin-bottom: 20px;">
          <h3 style="color: var(--accent); margin: 0 0 12px 0;">💻 코드 작성</h3>
          <textarea id="mode6-code-input"
            class="challenge-textarea"
            placeholder="# Write the full code here following the given requirements.\n# Keep it simple: menu loop, arithmetic log, CSV save/reload, pandas + matplotlib."
            style="width: 100%; min-height: 400px; font-family: var(--font-code); font-size: 14px; padding: 16px; background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 8px; color: var(--text); resize: vertical;"
            spellcheck="false"></textarea>
        </div>

        <div class="mode6-buttons" style="display: flex; gap: 12px; flex-wrap: wrap;">
          <button id="mode6-submit-btn" onclick="submitMode6Code()" style="padding: 12px 24px; background: linear-gradient(135deg, #667eea, #764ba2); color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; font-weight: 600;">🚀 제출 및 AI 채점</button>
          <button onclick="resetMode6()" style="padding: 12px 24px; background: var(--muted); color: var(--text); border: none; border-radius: 8px; cursor: pointer;">🔄 초기화</button>
          <button onclick="showMode6Hint()" style="padding: 12px 24px; background: rgba(255, 107, 107, 0.2); color: #ff6b6b; border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 8px; cursor: pointer;">💡 힌트 보기</button>
        </div>

        <div id="mode6-result" class="mode6-result" style="margin-top: 20px;"></div>
      </div>
    `;

    const codeInput = document.getElementById('mode6-code-input');
    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = codeInput.selectionStart;
        const end = codeInput.selectionEnd;
        codeInput.value = codeInput.value.substring(0, start) + '    ' + codeInput.value.substring(end);
        codeInput.selectionStart = codeInput.selectionEnd = start + 4;
      }
    });

    sessionCount.textContent = "1";
  } catch (err) {
    codeArea.innerHTML = `<div class="mc-wrong" style="padding: 20px;">❌ 문제 생성 오류: ${err.message}<br><br><button onclick="renderMode6CodeWriting()" style="padding: 10px 20px; background: var(--accent-2); border: none; border-radius: 6px; cursor: pointer;">🔄 다시 시도</button></div>`;
  }
}

/**
 * 모드 6 코드 제출 및 AI 채점
 * - 학생이 작성한 코드를 AI가 채점
 * - 로직/흐름이 맞으면 정답으로 융통성 있게 채점
 */
async function submitMode6Code() {
  const codeInput = document.getElementById('mode6-code-input');
  const resultDiv = document.getElementById('mode6-result');
  const userCode = codeInput.value.trim();

  if (!userCode) {
    alert('코드를 입력해주세요!');
    return;
  }

  mode6State.userCode = userCode;
  resultDiv.innerHTML = `<div class="definition-loading">🤖 AI가 코드를 분석하고 채점 중...</div>`;

  const prompt = `당신은 전산수학 시험 채점관입니다. 융통성 있게 채점하되, 핵심 로직이 맞아야 합니다.

## 문제 설명
${mode6State.problem}

## 학생이 작성한 코드
\`\`\`python
${userCode}
\`\`\`

## 채점 기준 (융통성 있게)
1. 핵심 기능 구현 여부 (70% 비중):
   - 메뉴 기반 while 루프가 있는가?
   - 사칙연산 또는 핵심 계산 로직이 있는가?
   - 데이터 저장 구조(리스트/딕셔너리)가 있는가?
   
2. 파일/시각화 (30% 비중):
   - CSV 저장 또는 pandas 사용 시도가 있는가?
   - matplotlib 그래프 시도가 있는가?
   
3. 정답 기준:
   - 70% 이상 구현되면 정답
   - 핵심 로직 구조만 맞아도 OK (변수명, 출력 메시지 달라도 됨)
   - 문법 오류가 좀 있어도 로직이 맞으면 정답

## 응답 형식 (JSON)
{
  "score": 0~100 점수,
  "passed": true 또는 false (70점 이상이면 true),
  "feedback": "상세한 피드백 (잘한 점, 부족한 점)",
  "missing": ["누락된 기능1", "누락된 기능2"] 또는 []
}`;

  try {
    const response = await callGeminiAPI(prompt, "JSON 형식으로만 응답하세요.");

    let result;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("JSON 파싱 실패");
      }
    } catch (e) {
      // JSON 파싱 실패 시 텍스트에서 판단
      const passed = response.includes('passed": true') || response.includes('정답') || response.includes('합격');
      result = { score: passed ? 80 : 50, passed, feedback: response, missing: [] };
    }

    mode6State.submitted = true;
    mode6State.isCorrect = result.passed;

    // 결과 UI
    const bgColor = result.passed ? 'rgba(94, 230, 167, 0.1)' : 'rgba(255, 107, 107, 0.1)';
    const borderColor = result.passed ? 'var(--green)' : 'var(--red)';
    const icon = result.passed ? '✅' : '❌';
    const title = result.passed ? '정답입니다!' : '아직 부족해요';

    resultDiv.innerHTML = `
      <div style="background: ${bgColor}; border: 2px solid ${borderColor}; border-radius: 12px; padding: 20px;">
        <h3 style="color: ${result.passed ? 'var(--green)' : 'var(--red)'}; margin: 0 0 12px 0;">
          ${icon} ${title} (${result.score}점)
        </h3>
        <div style="color: var(--text); line-height: 1.7; white-space: pre-line;">${escapeHtml(result.feedback)}</div>
        ${result.missing && result.missing.length > 0 ? `
          <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid ${borderColor};">
            <strong style="color: var(--yellow);">📋 누락된 기능:</strong>
            <ul style="margin: 8px 0 0 0; padding-left: 20px;">
              ${result.missing.map(m => `<li>${escapeHtml(m)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;

    // 점수 업데이트
    sessionScore.textContent = `${result.score} / 100`;

    // 효과음
    if (result.passed) {
      SoundEffects.play('correct');
      LearningStats.recordAnswer(true);
    } else {
      SoundEffects.play('wrong');
      LearningStats.recordAnswer(false);
    }

  } catch (err) {
    resultDiv.innerHTML = `<div class="mc-wrong" style="padding: 20px;">❌ 채점 오류: ${err.message}</div>`;
  }
}

/**
 * 모드 6 초기화
 */
function resetMode6() {
  const codeInput = document.getElementById('mode6-code-input');
  const resultDiv = document.getElementById('mode6-result');

  if (codeInput) codeInput.value = '';
  if (resultDiv) resultDiv.innerHTML = '';

  mode6State.userCode = '';
  mode6State.submitted = false;
  mode6State.isCorrect = null;
}

/**
 * 모드 6 힌트 보기
 */
async function showMode6Hint() {
  const resultDiv = document.getElementById('mode6-result');
  resultDiv.innerHTML = `<div class="definition-loading">💡 힌트 생성 중...</div>`;

  const prompt = `문제: ${mode6State.problem}

이 문제를 풀기 위한 핵심 힌트를 알려주세요:
1. 필수 import문
2. 기본 코드 구조 (의사 코드 수준)
3. 주의할 점

정답 코드를 직접 주지 말고, 힌트만 주세요.`;

  try {
    const response = await callGeminiAPI(prompt, "힌트만 제공하세요. 정답 코드는 주지 마세요.");
    resultDiv.innerHTML = `
      <div style="background: rgba(247, 215, 116, 0.1); border: 1px solid rgba(247, 215, 116, 0.3); border-radius: 12px; padding: 20px;">
        <h3 style="color: var(--yellow); margin: 0 0 12px 0;">💡 힌트</h3>
        <div style="color: var(--text); line-height: 1.7; white-space: pre-line;">${escapeHtml(response)}</div>
      </div>
    `;
  } catch (err) {
    resultDiv.innerHTML = `<div class="mc-wrong">힌트 생성 실패: ${err.message}</div>`;
  }
}

// ============================================================================
// 모드 1: C# OOP 빈칸 채우기
// ----------------------------------------------------------------------------
// CSharp_코드문제.txt를 파싱하여 문제를 로드하고, 빈칸 카드 UI로 표시
// ============================================================================

// 모드 1 상태 관리
let mode1State = {
  questions: [],    // 파싱된 문제들 { topic, description, code, blanks: [{num, answer}] }
  userAnswers: {},  // 사용자 답변
  difficulty: 'normal' // easy, normal, hard
};

/**
 * CSharp_코드문제.txt 파일을 파싱하여 문제 배열 반환
 */
function parseCSharpQuestions(text) {
  console.log('[Mode1] 파싱 시작, 텍스트 길이:', text.length);
  const questions = [];

  // ===== 문제 N: 로 분리
  const blocks = text.split(/={5,}\s*문제\s*\d+\s*:\s*/);
  console.log('[Mode1] 분리된 블록 수:', blocks.length);

  blocks.forEach((block, idx) => {
    if (idx === 0) return; // 첫 블록은 파일 헤더

    const lines = block.trim().split('\n');
    let topic = '';
    let description = '';
    let code = '';
    let answers = {};
    let inAnswerKey = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 첫 줄에서 제목 추출 (===== 로 끝나는 줄)
      if (i === 0 && line.includes('=====')) {
        topic = line.replace(/=+/g, '').trim();
        continue;
      }

      // // 로 시작하는 첫 번째 줄 = 설명
      if (line.trim().startsWith('//') && !description && !inAnswerKey) {
        description = line.replace(/^\/\/\s*/, '').trim();
        continue;
      }

      // 정답키 섹션 시작
      if (line.includes('정답키:')) {
        inAnswerKey = true;
        continue;
      }

      // 정답키 파싱
      if (inAnswerKey) {
        const answerMatch = line.match(/^(\d+)=(.+)$/);
        if (answerMatch) {
          answers[answerMatch[1]] = answerMatch[2].trim();
        }
        continue;
      }

      // 코드 수집 (정답키 시작 전까지 모든 줄)
      code += line + '\n';
    }

    // 빈칸 개수 확인
    const blankCount = (code.match(/_____/g) || []).length;
    const answerCount = Object.keys(answers).length;

    console.log(`[Mode1] 문제 ${idx}: topic="${topic}", 빈칸=${blankCount}, 정답=${answerCount}`);

    if (topic && code.trim() && blankCount > 0 && answerCount > 0) {
      // 빈칸 정보 생성
      const blanks = [];
      for (let num = 1; num <= Math.min(blankCount, answerCount); num++) {
        if (answers[num.toString()]) {
          blanks.push({
            num: num,
            answer: answers[num.toString()]
          });
        }
      }

      questions.push({
        id: idx,
        topic: topic,
        description: description || topic,
        code: code.trim(),
        blanks: blanks,
        answers: answers
      });
    }
  });

  console.log('[Mode1] 파싱 완료, 문제 수:', questions.length);
  return questions;
}

/**
 * 모드 1 렌더링 함수 (완전 AI 기반)
 * - C# 코드 파일 로드
 * - AI가 랜덤 빈칸 생성
 * - AI 채점/정답 표시
 */
async function renderMode1OOPBlanks(difficulty = 'normal') {
  const codeArea = document.getElementById('code-area');
  codeArea.innerHTML = `<div class="definition-loading">🤖 AI가 C# OOP 빈칸 문제를 생성 중...<br><span style="font-size: 12px; color: var(--muted);">잠시만 기다려주세요...</span></div>`;

  // 제목 업데이트
  sessionTitle.textContent = "C# OOP 빈칸 채우기 (AI)";
  sessionMode.textContent = "OOP 빈칸 채우기";

  try {
    // 파일 로드
    const primaryUrl = '/data/3_OOP_Code_Blanks.txt?t=' + Date.now();
    const legacyUrl = '/data/3_OOP_코드빈칸.txt?t=' + Date.now();
    let resp = await fetch(primaryUrl);
    if (!resp.ok) resp = await fetch(legacyUrl);
    if (!resp.ok) throw new Error('파일을 찾을 수 없습니다');
    const rawText = await resp.text();

    // 원본 C# 코드 블록들 추출 (빈칸 없는 상태)
    const codeBlocks = extractCSharpCodeBlocks(rawText);

    if (codeBlocks.length === 0) {
      throw new Error('코드 블록을 찾을 수 없습니다');
    }

    // 모든 코드 블록에서 빈칸 생성 (랜덤 선택 X → 전체 커버)
    const aiGeneratedQuestions = [];

    for (let i = 0; i < codeBlocks.length; i++) {
      const block = codeBlocks[i];
      codeArea.innerHTML = `<div class="definition-loading">🤖 문제 ${i + 1}/${codeBlocks.length} 생성 중...</div>`;

      const generated = await generateMode1BlankWithAI(block.code, block.topic, difficulty);
      if (generated) {
        aiGeneratedQuestions.push({
          ...generated,
          topic: block.topic,
          originalCode: block.code
        });
      }
    }

    if (aiGeneratedQuestions.length === 0) {
      throw new Error('AI 빈칸 생성 실패');
    }

    // 상태 저장 (AI 생성 데이터)
    mode1State.questions = aiGeneratedQuestions;
    mode1State.userAnswers = {};
    mode1State.submitted = false;
    mode1State.isAIMode = true; // AI 모드 플래그

    // UI 렌더링
    let questionsHtml = '';
    let navHtml = '';
    let globalBlankIdx = 0;

    aiGeneratedQuestions.forEach((q, qIdx) => {
      const questionNum = qIdx + 1;

      // 빈칸이 있는 코드를 입력 필드로 변환
      let processedCode = highlightCSharpSyntax(q.codeWithBlanks);
      let blankCounter = 1;

      processedCode = processedCode.replace(/_____/g, () => {
        globalBlankIdx++;
        const blankId = `mode1-${questionNum}-${blankCounter}`;

        navHtml += `<span class="blank-pill pending" id="nav-${blankId}" data-q="${questionNum}" data-blank="${blankCounter}" onclick="document.getElementById('input-${blankId}').focus()">${globalBlankIdx}</span>`;

        // 입력 필드 + 노란 물음표(힌트) + 빨간 물음표(왜 틀림)
        const result = `<span class="mode1-blank-wrapper" style="display: inline-flex; align-items: center; gap: 3px;">
          <input type="text" id="input-${blankId}" class="blank-card-input mode1-input" 
            data-q="${questionNum}" data-blank="${blankCounter}" data-global-idx="${globalBlankIdx}" 
            placeholder="[${globalBlankIdx}]" autocomplete="off"
            style="width: 100px; padding: 6px 10px; border-radius: 6px; border: 2px solid #6fb3ff; background: rgba(111, 179, 255, 0.15); color: #e5e9f0; font-family: var(--font-code); font-size: 13px;">
          <button class="mode1-hint-btn" tabindex="-1" onclick="explainMode1BlankAI(${questionNum}, ${blankCounter})" title="힌트 보기" 
            style="width: 20px; height: 20px; padding: 0; border-radius: 50%; background: rgba(247, 215, 116, 0.2); border: 1px solid rgba(247, 215, 116, 0.5); color: #f7d774; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center;">?</button>
          <button class="mode1-why-btn" tabindex="-1" onclick="explainMode1WhyWrong(${questionNum}, ${blankCounter})" title="왜 틀렸어요?" 
            style="width: 20px; height: 20px; padding: 0; border-radius: 50%; background: rgba(255, 107, 107, 0.2); border: 1px solid rgba(255, 107, 107, 0.5); color: #ff6b6b; font-size: 11px; cursor: pointer; display: none; align-items: center; justify-content: center;">?</button>
        </span>`;
        blankCounter++;
        return result;
      });

      questionsHtml += `
        <div class="blank-card" id="mode1-card-${questionNum}">
          <div class="blank-card-header">
            <span class="blank-card-num">Q${questionNum}</span>
            <span style="color: var(--accent-2); font-weight: 600;">${escapeHtml(q.topic)}</span>
          </div>
          <p style="color: var(--muted); margin: 0 0 12px 0; font-size: 13px;">${escapeHtml(q.description || '아래 코드의 빈칸을 채우세요.')}</p>
          <pre class="blank-card-code" style="background: rgba(0,0,0,0.4); padding: 16px; border-radius: 8px; overflow-x: auto; margin: 0; line-height: 1.6;">${processedCode}</pre>
          <div class="blank-card-result" id="result-mode1-${questionNum}"></div>
        </div>
      `;
    });

    codeArea.innerHTML = questionsHtml;

    // 빈칸 목록 업데이트
    const blankList = document.getElementById('blank-list');
    if (blankList) blankList.innerHTML = navHtml;

    // 세션 카운트 업데이트
    sessionCount.textContent = globalBlankIdx.toString();
    sessionScore.textContent = `0 / ${globalBlankIdx}`;

    // 이벤트 리스너 설정
    setupMode1AIEventListeners();

    // 컨트롤 버튼 표시
    updateControlButtonsForMode(1);

  } catch (err) {
    console.error('Mode 1 error:', err);
    codeArea.innerHTML = `<div class="mc-wrong" style="padding: 20px;">❌ 오류: ${err.message}<br><br><button onclick="renderMode1OOPBlanks()" style="padding: 10px 20px; background: var(--accent-2); border: none; border-radius: 6px; cursor: pointer;">🔄 다시 시도</button></div>`;
  }
}

/**
 * C# 코드 블록 추출 (파일에서 원본 코드만 추출)
 */
function extractCSharpCodeBlocks(text) {
  const blocks = [];
  const sections = text.split(/={5,}\s*문제\s*\d+\s*:\s*/);

  sections.forEach((section, idx) => {
    if (idx === 0) return; // 헤더 스킵

    const lines = section.trim().split('\n');
    let topic = '';
    let code = '';
    let inAnswerKey = false;

    for (const line of lines) {
      // 제목 추출
      if (line.includes('=====')) {
        topic = line.replace(/=+/g, '').trim();
        continue;
      }
      // 정답키 섹션 시작
      if (line.includes('정답키:')) {
        inAnswerKey = true;
        continue;
      }
      // 정답키 스킵
      if (inAnswerKey) continue;

      // 힌트 주석 제거 (// 빈칸: XXX 형태)
      let cleanLine = line.replace(/\s*\/\/\s*빈칸[^:\n]*:[^\n]*/g, '');

      // 코드 수집
      code += cleanLine + '\n';
    }

    // 빈칸 마커 _____ 도 제거하지 않음 (AI가 이미 빈칸이 있는 코드를 받아서 새로 생성)
    // 하지만 이미 빈칸이 있는 코드는 그대로 사용하되, 주석만 제거된 상태

    if (topic && code.trim()) {
      blocks.push({ topic, code: code.trim() });
    }
  });

  return blocks;
}

/**
 * AI에게 빈칸 생성 요청
 * @param {string} code - 원본 코드
 * @param {string} topic - 주제
 * @param {string} difficulty - 난이도 (easy, normal, hard, extreme)
 */
async function generateMode1BlankWithAI(code, topic, difficulty = 'normal') {
  // 난이도별 설정
  const difficultySettings = {
    easy: {
      blankCount: '1-2',
      focus: '주석이나 문자열 위주로만 빈칸을 만들어. 코드 키워드는 거의 건드리지 마.',
      description: '쉬움 - 기본 개념 확인'
    },
    normal: {
      blankCount: '2-4',
      focus: '주석 30%와 핵심 코드 키워드(public, interface, class 등) 70% 비율로 빈칸을 만들어.',
      description: '보통 - 핵심 개념 학습'
    },
    hard: {
      blankCount: '4-6',
      focus: '주석은 50%, 코드는 메서드명, 키워드, 타입, 변수명 등 50%로 빈칸을 만들어. 더 어렵게.',
      description: '어려움 - 코드 완전 암기'
    },
    extreme: {
      blankCount: '6-10',
      focus: '거의 모든 중요한 요소를 빈칸으로 만들어. 주석, 키워드, 메서드명, 타입, 변수명, 값 등 모두 포함. 시험 대비 최고 난이도.',
      description: '매우어려움 - 시험 완벽 대비'
    }
  };

  const settings = difficultySettings[difficulty] || difficultySettings.normal;

  const prompt = `다음 C# 코드에서 학습에 도움이 되는 빈칸을 ${settings.blankCount}개 만들어줘.

## 주제: ${topic}
## 난이도: ${settings.description}

## 원본 코드
\`\`\`csharp
${code}
\`\`\`

## 난이도별 요구사항
${settings.focus}

## 일반 요구사항
1. 빈칸은 _____ (언더스코어 5개)로 표시
2. 각 빈칸에는 고유 번호 부여 (1, 2, 3...)
3. 빈칸 위치는 학습 효과를 고려해 선택

## 응답 형식 (JSON만 응답)
{
  "codeWithBlanks": "빈칸이 포함된 코드 (_____ 사용)",
  "description": "문제 설명 (한 줄)",
  "blanks": [
    {"num": 1, "hint": "이 위치에 필요한 것에 대한 힌트"}
  ]
}`;

  try {
    const response = await callGeminiAPI(prompt, "JSON 형식으로만 응답해. 코드 블록 없이 순수 JSON만.");

    // JSON 추출
    let jsonStr = response;
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    const parsed = JSON.parse(jsonStr);
    return parsed;
  } catch (err) {
    console.error('AI blank generation error:', err);
    // 폴백: 원본 코드 그대로 반환 (빈칸 없음)
    return null;
  }
}

/**
 * Mode 1 AI 이벤트 리스너 설정 (Enter 시 AI 채점)
 */
function setupMode1AIEventListeners() {
  const inputs = document.querySelectorAll('.mode1-input');

  inputs.forEach(input => {
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();

        // 이미 채점된 경우
        if (input.classList.contains('correct') || input.classList.contains('revealed')) {
          focusNextMode1Input(input);
          return;
        }

        // 오답 상태에서 다시 Enter
        if (input.classList.contains('wrong')) {
          await revealMode1AnswerAI(input);
          focusNextMode1Input(input);
          return;
        }

        // AI 채점
        await checkMode1AnswerAI(input);
      }
    });
  });
}

/**
 * AI 채점
 */
async function checkMode1AnswerAI(input) {
  const qNum = parseInt(input.dataset.q);
  const blankNum = parseInt(input.dataset.blank);
  const userAnswer = input.value.trim();

  if (!userAnswer) return;

  const question = mode1State.questions[qNum - 1];
  if (!question) return;

  const navPill = document.getElementById(`nav-mode1-${qNum}-${blankNum}`);
  const whyBtn = input.parentElement.querySelector('.mode1-why-btn');

  // 로딩 표시
  input.style.borderColor = 'var(--yellow)';

  // 전체 원본 코드와 빈칸 정보 전달
  const prompt = `C# 빈칸 문제 채점.

## 원본 전체 코드
\`\`\`csharp
${question.originalCode || question.codeWithBlanks}
\`\`\`

## 빈칸 ${blankNum}번
학생 답: "${userAnswer}"

빈칸 ${blankNum}에 "${userAnswer}"가 맞으면 CORRECT, 틀리면 WRONG.
대소문자 무시. 한 단어만 응답.`;

  try {
    const response = await callGeminiAPI(prompt, "CORRECT 또는 WRONG 한 단어만 응답.");
    const isCorrect = response.toUpperCase().includes('CORRECT') && !response.toUpperCase().includes('WRONG');

    input.classList.remove('correct', 'wrong');
    navPill?.classList.remove('pending', 'correct', 'wrong');

    if (isCorrect) {
      input.classList.add('correct');
      input.style.borderColor = 'var(--green)';
      navPill?.classList.add('correct');
      if (whyBtn) whyBtn.style.display = 'none';
      SoundEffects.play('correct');
      LearningStats.recordAnswer(true);
    } else {
      input.classList.add('wrong');
      input.style.borderColor = 'var(--red)';
      navPill?.classList.add('wrong');
      if (whyBtn) whyBtn.style.display = 'flex';
      SoundEffects.play('wrong');
      LearningStats.recordAnswer(false);
    }

    updateMode1Score();

  } catch (err) {
    console.error('AI grading error:', err);
    input.style.borderColor = '#6fb3ff';
  }
}

/**
 * AI 정답 표시
 */
async function revealMode1AnswerAI(input) {
  const qNum = parseInt(input.dataset.q);
  const blankNum = parseInt(input.dataset.blank);

  const question = mode1State.questions[qNum - 1];
  if (!question) return;

  const navPill = document.getElementById(`nav-mode1-${qNum}-${blankNum}`);

  input.value = "정답 로딩중...";
  input.disabled = true;

  // 전체 원본 코드로 정답 요청
  const prompt = `C# 코드의 빈칸 정답 알려줘.

## 원본 전체 코드
\`\`\`csharp
${question.originalCode || question.codeWithBlanks}
\`\`\`

위 코드에서 빈칸 ${blankNum}번의 정답은?
설명 없이 정답 단어/키워드만 응답. 예: public, try, catch 등`;

  try {
    const response = await callGeminiAPI(prompt, "정답 단어만 응답해. 다른 설명 없이 한 단어.");
    // 응답에서 불필요한 부분 제거
    let answer = response.trim()
      .replace(/```/g, '')
      .replace(/\n/g, ' ')
      .replace(/정답[은:]?\s*/gi, '')
      .replace(/빈칸\s*\d+[번:]?\s*/gi, '')
      .replace(/^\s*["`']|["`']\s*$/g, '')
      .trim();

    // 첫 단어만 추출 (너무 긴 응답 방지)
    const words = answer.split(/\s+/);
    if (words.length > 2) {
      answer = words.slice(0, 2).join(' ');
    }

    input.value = answer;
    input.classList.remove('wrong');
    input.classList.add('revealed');
    input.style.borderColor = 'var(--yellow)';
    navPill?.classList.remove('wrong');
    navPill?.classList.add('revealed');

  } catch (err) {
    input.value = "정답 로드 실패";
  }

  updateMode1Score();
}

/**
 * 힌트 보기 (노란 물음표)
 */
async function explainMode1BlankAI(questionNum, blankNum) {
  const question = mode1State.questions[questionNum - 1];
  if (!question) return;

  openAIPanel();
  explanationArea.innerHTML = `<div class="explanation-loading">💡 힌트 생성 중...</div>`;

  const prompt = `C# 코드에서 빈칸 ${blankNum}번에 대한 힌트를 줘.

## 전체 코드
\`\`\`csharp
${question.originalCode || question.codeWithBlanks}
\`\`\`

## 힌트 형식
1. 이 위치에 무엇이 필요한지 (정답은 알려주지 마!)
2. 관련 C# 개념 설명 (1-2줄)

정답을 직접 알려주지 말고 힌트만!`;

  try {
    const response = await callGeminiAPI(prompt, "힌트만 주고 정답은 절대 알려주지 마.");
    explanationArea.innerHTML = `
      <div class="explanation-content">
        <strong style="color: var(--yellow);">💡 빈칸 ${blankNum}번 힌트</strong>
        <hr style="border: none; border-top: 1px solid var(--border); margin: 12px 0;">
        ${formatMarkdown(response)}
      </div>`;
  } catch (err) {
    explanationArea.innerHTML = `<div class="explanation-content" style="color: var(--red);">❌ ${err.message}</div>`;
  }
}

/**
 * 왜 틀렸어요? (빨간 물음표)
 */
async function explainMode1WhyWrong(questionNum, blankNum) {
  const question = mode1State.questions[questionNum - 1];
  if (!question) return;

  const input = document.getElementById(`input-mode1-${questionNum}-${blankNum}`);
  const userAnswer = input?.value || '';

  openAIPanel();
  explanationArea.innerHTML = `<div class="explanation-loading">❓ 분석 중...</div>`;

  const prompt = `C# 코드에서 학생의 답이 왜 틀렸는지 설명해줘.

## 전체 코드
\`\`\`csharp
${question.originalCode || question.codeWithBlanks}
\`\`\`

## 빈칸 ${blankNum}번
학생의 답: "${userAnswer}"

왜 틀렸는지, 정답이 무엇인지 간단히 설명해줘.`;

  try {
    const response = await callGeminiAPI(prompt, "왜 틀렸는지 친절하게 설명.");
    explanationArea.innerHTML = `
      <div class="explanation-content">
        <strong style="color: var(--red);">❓ 왜 틀렸나요?</strong>
        <p style="color: var(--muted); margin: 8px 0;">내 답: <code>${escapeHtml(userAnswer)}</code></p>
        <hr style="border: none; border-top: 1px solid var(--border); margin: 12px 0;">
        ${formatMarkdown(response)}
      </div>`;
  } catch (err) {
    explanationArea.innerHTML = `<div class="explanation-content" style="color: var(--red);">❌ ${err.message}</div>`;
  }
}


/**
 * C# 코드 구문 강조
 */
function highlightCSharpSyntax(code) {
  // 키워드 강조
  const keywords = ['namespace', 'class', 'interface', 'public', 'private', 'protected', 'static', 'void', 'int', 'string', 'double', 'bool', 'new', 'return', 'if', 'else', 'for', 'foreach', 'while', 'try', 'catch', 'finally', 'throw', 'using', 'lock', 'object', 'in'];

  let result = code;

  // 문자열 강조 (먼저 처리)
  result = result.replace(/"([^"\\]|\\.)*"/g, '<span style="color: #ce9178;">"$&"</span>');
  result = result.replace(/<span style="color: #ce9178;">"("([^"\\]|\\.)*")"/g, '<span style="color: #ce9178;">$1');

  // 주석 강조
  result = result.replace(/(\/\/[^\n]*)/g, '<span style="color: #6a9955;">$1</span>');
  result = result.replace(/(\/\*[\s\S]*?\*\/)/g, '<span style="color: #6a9955;">$1</span>');

  // 키워드 강조
  keywords.forEach(kw => {
    const regex = new RegExp(`\\b(${kw})\\b`, 'g');
    result = result.replace(regex, '<span style="color: #569cd6;">$1</span>');
  });

  // 타입 강조
  const types = ['Console', 'Thread', 'Exception', 'DivideByZeroException', 'ArgumentException', 'ThreadStart'];
  types.forEach(type => {
    const regex = new RegExp(`\\b(${type})\\b`, 'g');
    result = result.replace(regex, '<span style="color: #4ec9b0;">$1</span>');
  });

  // 숫자 강조
  result = result.replace(/\b(\d+)\b/g, '<span style="color: #b5cea8;">$1</span>');

  return result;
}

/**
 * Mode 1 이벤트 리스너 설정
 */
function setupMode1EventListeners() {
  const inputs = document.querySelectorAll('.mode1-input');

  inputs.forEach(input => {
    // Enter key: Mode 2 style two-step grading
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();

        // Already wrong -> show answer and move to next
        if (input.classList.contains('wrong') && !input.classList.contains('revealed')) {
          checkMode1Single(input, true);
          focusNextMode1Input(input);
          return;
        }

        // Already graded -> move to next
        if (input.classList.contains('correct') || input.classList.contains('revealed')) {
          focusNextMode1Input(input);
          return;
        }

        // Step 1: Grade
        checkMode1Single(input, false);

        // If correct, move to next
        if (input.classList.contains('correct')) {
          focusNextMode1Input(input);
        }
        // If wrong, stay (wait for next Enter)
      }
    });
  });
}

/**
 * Focus next Mode 1 blank input
 */
function focusNextMode1Input(current) {
  const allInputs = Array.from(document.querySelectorAll('.mode1-input'));
  const currentIdx = allInputs.indexOf(current);
  if (currentIdx < allInputs.length - 1) {
    allInputs[currentIdx + 1].focus();
  }
}

/**
 * Mode 1 개별 빈칸 체크 (AI 채점 우선, 실패 시 로컬 폴백)
 */
async function checkMode1Single(input, showAnswer = false) {
  const qNum = input.dataset.q;
  const blankNum = input.dataset.blank;
  const correctAnswer = input.dataset.answer;
  const userAnswer = input.value.trim();

  if (!userAnswer && !showAnswer) return;

  const navPill = document.getElementById(`nav-mode1-${qNum}-${blankNum}`);

  // 이미 채점된 경우 스킵
  if (input.classList.contains('correct') || input.classList.contains('revealed')) {
    return;
  }

  // 정답 표시 요청인 경우
  if (showAnswer && !input.classList.contains('correct')) {
    input.value = correctAnswer;
    input.classList.add('revealed');
    navPill?.classList.remove('pending', 'correct', 'wrong');
    navPill?.classList.add('revealed');
    input.disabled = true;
    SoundEffects.play('wrong');
    updateMode1Score();
    return;
  }

  // 로컬 비교 (대소문자, 공백 무시)
  const normalize = s => s.replace(/\s+/g, '').toLowerCase();
  const isCorrect = normalize(userAnswer) === normalize(correctAnswer);

  input.classList.remove('correct', 'wrong', 'revealed');
  navPill?.classList.remove('pending', 'correct', 'wrong', 'revealed');

  if (isCorrect) {
    input.classList.add('correct');
    navPill?.classList.add('correct');
    SoundEffects.play('correct');
    LearningStats.recordAnswer(true);
  } else {
    input.classList.add('wrong');
    navPill?.classList.add('wrong');
    SoundEffects.play('wrong');
    LearningStats.recordAnswer(false);
  }

  updateMode1Score();
}

/**
 * Mode 1 점수 업데이트
 */
function updateMode1Score() {
  const inputs = document.querySelectorAll('.mode1-input');
  let correct = 0;
  let answered = 0;

  inputs.forEach(input => {
    if (input.classList.contains('correct') || input.classList.contains('revealed')) {
      answered++;
      if (input.classList.contains('correct')) correct++;
    } else if (input.classList.contains('wrong')) {
      answered++;
    }
  });

  sessionScore.textContent = `${correct} / ${inputs.length}`;
  const ratio = inputs.length ? (correct / inputs.length) * 100 : 0;
  sessionProgress.style.width = `${ratio}%`;
}

/**
 * Mode 1 전체 채점
 */
function checkMode1Answers() {
  document.querySelectorAll('.mode1-input').forEach(input => {
    if (!input.disabled) {
      checkMode1Single(input, true);
    }
  });
}

// End of Mode 1 implementation

/**
 * Mode 1 빈칸에 대한 AI 설명 제공
 */
async function explainMode1Blank(questionNum, blankNum) {
  const question = mode1State.questions.find((q, idx) => idx + 1 === questionNum);
  if (!question) return;

  const blank = question.blanks.find(b => b.num === blankNum);
  const answer = blank ? blank.answer : '';

  openAIPanel();
  explanationArea.innerHTML = `<div class="explanation-loading">🤔 빈칸 [${blankNum}]에 대해 분석 중...</div>`;

  // 코드에서 해당 빈칸 주변 컨텍스트 추출
  const codeLines = question.code.split('\n');
  let blankLineIdx = -1;
  let blankCount = 0;

  for (let i = 0; i < codeLines.length; i++) {
    const matches = codeLines[i].match(/_____/g);
    if (matches) {
      for (let j = 0; j < matches.length; j++) {
        blankCount++;
        if (blankCount === blankNum) {
          blankLineIdx = i;
          break;
        }
      }
    }
    if (blankLineIdx !== -1) break;
  }

  // 빈칸 주변 3줄 컨텍스트
  const startLine = Math.max(0, blankLineIdx - 2);
  const endLine = Math.min(codeLines.length, blankLineIdx + 3);
  const contextCode = codeLines.slice(startLine, endLine).join('\n');

  const prompt = `C# 코드에서 [빈칸 ${blankNum}]의 정답이 무엇인지 핵심만 알려줘.
정답을 직접 알려주지 말고, 힌트와 설명만 해줘.

## 문제 주제
${question.topic}

## 코드 컨텍스트 (빈칸은 _____ 로 표시)
\`\`\`csharp
${contextCode}
\`\`\`

## 설명 형식
1. 이 위치에 무엇이 필요한지 (1줄)
2. 관련 C# 개념 핵심 설명 (1-2줄)

힌트만 주고 정답은 알려주지 마!`;

  try {
    const response = await callGeminiAPI(prompt, "C# 튜터로서 핵심만 짧게 설명해줘. 정답은 절대 알려주지 마.");
    explanationArea.innerHTML = `
      <div class="explanation-content">
        <strong style="color: var(--yellow);">💡 빈칸 [${blankNum}] 힌트</strong>
        <hr style="border: none; border-top: 1px solid var(--border); margin: 12px 0;">
        ${formatMarkdown(response)}
      </div>`;
  } catch (err) {
    explanationArea.innerHTML = `<div class="explanation-content" style="color: var(--red);">❌ 오류: ${err.message}</div>`;
  }
}

/**
 * Mode 1 AI 기반 채점 (코드 맥락 이해)
 */
async function checkMode1WithAI(input, showAnswer = false) {
  const qNum = parseInt(input.dataset.q);
  const blankNum = parseInt(input.dataset.blank);
  const storedAnswer = input.dataset.answer;
  const userAnswer = input.value.trim();
  const globalIdx = input.dataset.globalIdx || blankNum;

  if (!userAnswer && !showAnswer) return;

  const question = mode1State.questions.find((q, idx) => idx + 1 === qNum);
  if (!question) {
    // Fallback to local check
    checkMode1SingleLocal(input, showAnswer);
    return;
  }

  const navPill = document.getElementById(`nav-mode1-${qNum}-${blankNum}`);

  // 이미 채점된 경우 스킵
  if (input.classList.contains('correct') || input.classList.contains('revealed')) {
    return;
  }

  // 정답 표시 요청인 경우
  if (showAnswer && !input.classList.contains('correct')) {
    input.value = storedAnswer;
    input.classList.add('revealed');
    navPill?.classList.remove('pending', 'correct', 'wrong');
    navPill?.classList.add('revealed');
    input.disabled = true;
    SoundEffects.play('wrong');
    updateMode1Score();
    return;
  }

  // AI 채점 프롬프트
  const prompt = `C# 코드에서 빈칸에 들어갈 답을 채점해줘.

## 코드 맥락
${question.code.split('\n').slice(0, 30).join('\n')}

## 빈칸 ${blankNum}번
- 저장된 정답: "${storedAnswer}"
- 학생 답변: "${userAnswer}"

## 채점 기준
1. 정확히 일치하면 CORRECT
2. 대소문자 차이만 있으면 CORRECT
3. 공백 차이만 있어도 CORRECT
4. 같은 의미의 다른 표현이면 CORRECT (예: "new int[]"와 "new int []")
5. 그 외는 WRONG

반드시 CORRECT 또는 WRONG 중 하나만 응답해.`;

  try {
    const response = await callGeminiAPI(prompt, "CORRECT 또는 WRONG 중 하나만 응답해.");
    const isCorrect = response.toUpperCase().includes('CORRECT');

    input.classList.remove('correct', 'wrong', 'revealed');
    navPill?.classList.remove('pending', 'correct', 'wrong', 'revealed');

    if (isCorrect) {
      input.classList.add('correct');
      navPill?.classList.add('correct');
      SoundEffects.play('correct');
      LearningStats.recordAnswer(true);
    } else {
      input.classList.add('wrong');
      navPill?.classList.add('wrong');
      SoundEffects.play('wrong');
      LearningStats.recordAnswer(false);
    }

    updateMode1Score();

  } catch (err) {
    console.error('AI grading error:', err);
    // AI 실패 시 로컬 채점으로 폴백
    checkMode1SingleLocal(input, showAnswer);
  }
}

/**
 * Mode 1 로컬 채점 (폴백용)
 */
function checkMode1SingleLocal(input, showAnswer = false) {
  const qNum = input.dataset.q;
  const blankNum = input.dataset.blank;
  const correctAnswer = input.dataset.answer;
  const userAnswer = input.value.trim();

  if (!userAnswer && !showAnswer) return;

  const navPill = document.getElementById(`nav-mode1-${qNum}-${blankNum}`);
  const normalize = s => s.replace(/\s+/g, '').toLowerCase();
  const isCorrect = normalize(userAnswer) === normalize(correctAnswer);

  input.classList.remove('correct', 'wrong', 'revealed');
  navPill?.classList.remove('pending', 'correct', 'wrong', 'revealed');

  if (showAnswer && !isCorrect) {
    input.value = correctAnswer;
    input.classList.add('revealed');
    navPill?.classList.add('revealed');
    input.disabled = true;
    SoundEffects.play('wrong');
  } else if (isCorrect) {
    input.classList.add('correct');
    navPill?.classList.add('correct');
    SoundEffects.play('correct');
    LearningStats.recordAnswer(true);
  } else {
    input.classList.add('wrong');
    navPill?.classList.add('wrong');
    SoundEffects.play('wrong');
    LearningStats.recordAnswer(false);
  }

  updateMode1Score();
}
