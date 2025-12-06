import {
  buildDifferencePrompt,
  buildDefinitionGradePrompt,
  buildMode1AnswerPrompt,
  buildMode1GradePrompt,
  buildMode1HintPrompt,
  buildMode1WhyWrongPrompt,
  buildMode6HintPrompt,
  buildMode6ProblemPrompt,
  buildVocabMeaningPrompt,
} from "./js/features/prompt-builders.js";
import { escapeHtml, formatMarkdown, isAnswerCorrect as compareAnswers } from "./js/core/utils.js";

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('Service Worker registered'))
      .catch(err => console.log('SW registration failed:', err));
  });
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
window.sessionScore = sessionScore;

// AI Panel refs
const aiPanel = document.getElementById("ai-panel");
const explanationArea = document.getElementById("explanation-area");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const floatingExplain = document.getElementById("floating-explain");
const btnToggleCompleted = document.getElementById("btn-toggle-completed");

window.currentSession = null;
let currentSession = window.currentSession;
let inputs = [];
let answerKeyMap = {};
let reviewQueue = new Set();
let challengeReviewQueue = new Set();
let hasAnswers = false;
let warnedMissingAnswers = false;
let hideCompletedNav = false;

// Track used blank positions to avoid duplicates when regenerating
let usedPositions = {}; // { "1": 3, "2": 1 } = usage count per position

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

// Normalize answers for comparison (trim, drop wrapping quotes, normalize quotes/whitespace, lowercase)
function normalizeAnswerText(value) {
  if (!value) return "";
  return value
    .trim()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function pickFirstCodeBlock(text) {
  if (!text) return "";
  const match = text.match(/```([\s\S]*?)```/);
  if (match && match[1]) return match[1].trim();
  return text.trim();
}
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
    throw new Error("API key is required.");
  }

  const basePrompt = await loadBaseSystemPrompt();
  const mergedSystemInstruction = [basePrompt, systemInstruction].filter(Boolean).join("\n\n");

  let contents;
  if (chatHistory && chatHistory.length > 0) {
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
    const msg = (error && error.error && error.error.message) ? error.error.message : "API request failed";
    throw new Error(msg);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

function fillChatAndOpen(message) {
  openAIPanel();
  if (chatInput) {
    chatInput.value = message;
    chatInput.focus();
  }
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
  const msg = `Give me a hint for blank ${key}.`;
  fillChatAndOpen(msg);
}

function explainWhyWrongBlank(key) {
  const answer = answerKeyMap[key];
  const input = document.querySelector(`input.blank[data-key="${key}"]`);
  const userAnswer = input?.value || "";
  if (!answer) return;
  const msg = `Explain why blank ${key} is wrong (input: ${userAnswer || "-"}, answer: ${answer}).`;
  fillChatAndOpen(msg);
}

function explainSelection(text) {
  if (!text || !text.trim()) return;
  const truncatedCode = text.length > 200 ? text.slice(0, 200) + '...' : text;
  const msg = `Explain this code block:
${truncatedCode}`;
  fillChatAndOpen(msg);
}

// ========== CHAT FEATURE ==========
let chatHistory = [];

function startNewChatSession() {
  chatHistory = [];
  if (chatMessages) {
    chatMessages.innerHTML = `<div class="chat-message system">새 대화를 시작했어요. 질문을 입력해 주세요.</div>`;
  }
}

function toggleChatHistory() {
  if (chatHistory.length === 0) {
    LegacyAlerts.noChatHistory();
    return;
  }
  const userMsgs = chatHistory.filter(h => h.role === 'user').length;
  const aiMsgs = chatHistory.filter(h => h.role === 'model').length;
  LegacyAlerts.chatHistoryStats(userMsgs, aiMsgs, chatHistory.length);
}

async function sendChatMessage() {
  const message = chatInput?.value.trim();
  if (!message) return;

  addChatMessage(message, "user");
  chatInput.value = "";

  const loadingId = Date.now();
  addChatMessage("답변을 생성하고 있어요...", "assistant", loadingId);

  const context = buildChatContext(message);
  const prompt = context ? `${context}

User input: ${message}` : message;

  try {
    const response = await callGeminiAPI(prompt, "", chatHistory.slice(-20));
    chatHistory.push({ role: "user", parts: [{ text: prompt }] });
    chatHistory.push({ role: "model", parts: [{ text: response }] });
    replaceChatMessage(loadingId, response);
  } catch (err) {
    replaceChatMessage(loadingId, `오류: ${err.message}`);
  }
}

function buildChatContext(message) {
  const numMatch = message.match(/(\d+)/);
  let context = "";

  if (chatHistory.length === 0 && !numMatch) {
    if (currentSession?.answer_key?._questions && currentQuestions.length > 0) {
      const questionList = currentQuestions.map((q, idx) => {
        const displayIdx = idx + 1;
        const qId = q.id;
        const qType = q.type === "short_answer" ? "short answer" :
          q.type === "fill_blank" ? "fill blank" : "multiple choice";
        const codeSnippet = q.code ? `\nCode: ${q.code.slice(0, 100)}...` : "";
        return `#${displayIdx} [Q${qId}] ${qType}: ${q.text.slice(0, 80)}${codeSnippet}`;
      }).join("\n");
      context = `Current question list (total ${currentQuestions.length}):\n---\n${questionList}\n---`;
    } else if (currentSession?.question) {
      context = `Current working code:\n\`\`\`python\n${currentSession.question.slice(0, 2000)}\n\`\`\``;
    }
  }

  if (numMatch && currentQuestions.length > 0) {
    const qNum = parseInt(numMatch[1], 10);
    if (qNum >= 1 && qNum <= currentQuestions.length) {
      const targetQ = currentQuestions[qNum - 1];
      const codeSnippet = targetQ.code ? `- Code:\n\`\`\`\n${targetQ.code}\n\`\`\`` : "";
      const options = targetQ.options ? `- Choices:\n${targetQ.options.map(o => `  ${o.num}. ${o.text}`).join("\n")}` : "";
      const correct = targetQ.correct ? `- Answer: ${targetQ.correct}` : "";
      context = `Question ${qNum} detail:\n- Question ID: [Q${targetQ.id}]\n- Type: ${targetQ.type}\n- Text: ${targetQ.text}\n${codeSnippet}\n${options}\n${correct}`;
    }
  } else if (numMatch) {
    const qNum = parseInt(numMatch[1], 10);
    let inputEl = document.querySelector(`input[data-global-idx="${qNum}"]`)
      || document.querySelector(`input.mode1-input[data-global-idx="${qNum}"]`)
      || document.querySelector(`input.blank-card-input[data-key="${qNum}"]`)
      || document.querySelector(`input.blank[data-key="${qNum}"]`);

    if (!inputEl) {
      const allModeInputs = document.querySelectorAll('.mode1-input, .blank-card-input, input.blank');
      if (qNum >= 1 && qNum <= allModeInputs.length) {
        inputEl = allModeInputs[qNum - 1];
      }
    }

    if (inputEl) {
      const card = inputEl.closest(".blank-card, .question-card, .mode1-question");
      const codeEl = card?.querySelector("pre, code, .code-content");
      const answer = inputEl.dataset?.answer;
      const codeSnippet = codeEl ? codeEl.textContent.slice(0, 400) : "";
      context = `[Blank ${qNum}]\nInput: ${inputEl.value || "-"}\nAnswer: ${answer || "-"}\n${codeSnippet ? `Code:\n${codeSnippet}` : ""}`;
    }
  }

  if (!context && currentSession?.question) {
    context = `Current working code:\n\`\`\`\n${currentSession.question.slice(0, 1500)}\n\`\`\``;
  }

  return context;
}

function addChatMessage(text, role, id = null) {
  if (!chatMessages) return;
  const div = document.createElement("div");
  div.className = `chat-message ${role}`;
  if (id) div.id = `loading-${id}`;
  div.innerHTML = role === "user" ? escapeHtml(text) : formatMarkdown(text);
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function replaceChatMessage(id, text) {
  const el = document.getElementById(`loading-${id}`);
  if (el) {
    el.innerHTML = formatMarkdown(text);
    el.id = "";
  }
  if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ========== REGENERATE BLANKS ==========
// Store previous blank answers to detect duplicates
let previousAnswers = new Set();

async function regenerateBlanks() {
  // Show message instead when Mode 1 (C# OOP blanks) is active
  if (currentSession?.mode === 1 && mode1State && mode1State.questions && mode1State.questions.length > 0) {
    LegacyAlerts.mode1Reload();
    return;
  }

  if (!currentSession?.answer) {
    LegacyAlerts.noAnswerCode();
    return;
  }

  // Locate the modal element
  let modal = document.getElementById("regenerate-modal");

  // Create the modal dynamically if missing (defensive)
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

  // Attach listeners once to avoid duplicates
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

  // Open modal
  if (modal) {
    modal.style.display = "flex";
    if (input) input.focus();
  }
}

async function executeRegenerate(targetCount) {
  if (isNaN(targetCount) || targetCount < 5) targetCount = 20;
  if (targetCount > 100) targetCount = 100;

  // openAIPanel(); // removed per request: do not auto-open the chat panel
  if (explanationArea) {
    explanationArea.innerHTML = `<div class="explanation-loading">새로운 빈칸 ${targetCount}개를 생성하고 있습니다...</div>`;
  }

  // Save current answers into the previous answer set
  const currentAnswers = new Set(Object.values(answerKeyMap));

  try {
    // Generate blanks locally (more stable than using the API)
    const result = generateBlanksLocally(currentSession.answer, targetCount, currentAnswers, 5);

    if (result.answerKey && Object.keys(result.answerKey).length > 0) {
      // Update previous answers
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
      if (explanationArea) {
        explanationArea.innerHTML = `
          <div class="explanation-content">
            <strong style="color: var(--green);">✅ 새 빈칸 ${Object.keys(result.answerKey).length}개 생성!</strong>
            <p>이전 문제와 중복: ${duplicateCount}개</p>
            <p style="color: var(--muted); font-size: 12px;">새로운 위치에 빈칸이 생성되었습니다.</p>
          </div>`;
      }
    } else {
      throw new Error("Failed to generate blanks");
    }
  } catch (err) {
    console.error("Regenerate error:", err);
    if (explanationArea) {
      explanationArea.innerHTML = `
        <div class="explanation-content" style="color: var(--red);">
          ❌ ${err.message}
          <p style="color: var(--muted); margin-top: 8px;">다시 시도해주세요.</p>
        </div>`;
    }
  }
}

// Regenerate modal event listeners
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
 * Generate blanks locally (no API call)
 * @param {string} code - solution code
 * @param {number} targetCount - desired blank count
 * @param {Set} previousAnswers - prior answers for duplicate checks
 * @param {number} maxDuplicates - maximum duplicate allowance
 */
function generateBlanksLocally(code, targetCount, previousAnswers, maxDuplicates) {
  const lines = code.split("\n");
  const answerKey = {};
  let blankCount = 0;
  let duplicateCount = 0;

  // Validate whether a candidate is a usable answer
  function isValidAnswer(ans) {
    if (!ans || ans.length <= 1) return false;

    // Skip if it is only special characters
    const specialOnly = new Set("()[]{}:,;'\"` ");
    if ([...ans].every(c => specialOnly.has(c))) return false;

    // Skip quotes/whitespace-only values (e.g., ' ', "")
    if (/^['\"]\s*['"]?\)?$/.test(ans)) return false;

    // Require at least one alphanumeric character
    if (!/[a-zA-Z0-9_]/.test(ans)) return false;

    return true;
  }

  // Clean answer by trimming trailing parens/commas
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

  // Collect blank candidates first
  const candidates = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trim();

    // Lines to skip
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

    // Assignment pattern: value after =
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

    // return statements
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

    // while conditions
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

    // if conditions
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

  // Prioritize unique answers, then duplicates (up to maxDuplicates)
  const nonDuplicates = candidates.filter(c => !c.isDuplicate);
  const duplicates = candidates.filter(c => c.isDuplicate);

  // Shuffle helper
  const shuffle = arr => arr.sort(() => Math.random() - 0.5);

  // Shuffle non-duplicates
  shuffle(nonDuplicates);
  shuffle(duplicates);

  // Candidates to pick
  const selected = [];
  const usedLines = new Set();

  // Add non-duplicates first
  for (const c of nonDuplicates) {
    if (selected.length >= targetCount) break;
    if (usedLines.has(c.lineIndex)) continue; // Only one per line
    selected.push(c);
    usedLines.add(c.lineIndex);
  }

  // Fill from duplicates if needed (up to maxDuplicates)
  let addedDuplicates = 0;
  for (const c of duplicates) {
    if (selected.length >= targetCount) break;
    if (addedDuplicates >= maxDuplicates) break;
    if (usedLines.has(c.lineIndex)) continue;
    selected.push(c);
    usedLines.add(c.lineIndex);
    addedDuplicates++;
  }

  // Sort by line order
  selected.sort((a, b) => a.lineIndex - b.lineIndex);

  // Apply blanks as __[N]__ markers (indexed blanks)
  const newLines = [...lines];
  for (const item of selected) {
    blankCount++;
    const key = String(blankCount);
    answerKey[key] = item.answer;
    if (item.isDuplicate) duplicateCount++;

    // Replace the value in that line with __[N]__ (indexed blanks)
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
      LegacyAlerts.jsonParseFail(err.message);
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

// Mapping control buttons to be exposed for each mode
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

// Flatten various answer_key shapes into a simple key/value map while preserving metadata fields.
function flattenAnswerKey(rawKey) {
  if (!rawKey || typeof rawKey !== "object") return {};
  if (rawKey._type) return rawKey; // structured types should stay intact

  if (Array.isArray(rawKey)) {
    const flatFromArray = {};
    rawKey.forEach((val, idx) => {
      if (val !== undefined && val !== null) {
        flatFromArray[String(idx + 1)] = val;
      }
    });
    return flatFromArray;
  }

  const flat = {};
  for (const [key, val] of Object.entries(rawKey)) {
    if (key.startsWith("_")) {
      flat[key] = val;
      continue;
    }
    if (val && typeof val === "object" && typeof val.answer === "string") {
      flat[key] = val.answer;
    } else {
      flat[key] = val;
    }
  }
  return flat;
}

// Try to extract numbered answers from loose markdown (e.g., "1) foo").
function extractAnswerKeyFromMarkdown(questionText) {
  if (!questionText) return {};
  const result = {};
  const numberedLine = /^\s*\[?(\d+)\]?[.)-]?\s*[:\-]?\s*(.+)$/;
  questionText.split("\n").forEach((line) => {
    const match = line.match(numberedLine);
    if (match) {
      const idx = match[1];
      const value = match[2]?.trim();
      if (value) result[idx] = value;
    }
  });
  return result;
}

// Derive answers by aligning placeholders in the question with concrete text in the answer.
function deriveAnswerKeyFromAnswer(questionCode, answerCode) {
  if (!questionCode || !answerCode) return {};

  const parts = questionCode.split(/(__\[\d+\]__|_{3,10})/);
  const derived = {};
  let answerPos = 0;
  let seqCounter = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const indexedMatch = part.match(/^__\[(\d+)\]__$/);
    const isSeqPlaceholder = !indexedMatch && /^_{3,10}$/.test(part);

    if (indexedMatch || isSeqPlaceholder) {
      const key = indexedMatch ? indexedMatch[1] : String(++seqCounter);
      const nextLiteral = parts[i + 1] || "";
      let nextPos = nextLiteral ? answerCode.indexOf(nextLiteral, answerPos) : -1;

      if (nextLiteral && nextPos === -1) {
        nextPos = answerCode.length;
      }

      const sliceEnd = nextPos === -1 ? answerCode.length : nextPos;
      const value = answerCode.slice(answerPos, sliceEnd).trim();
      if (value) derived[key] = value;

      if (nextLiteral && nextPos !== -1) {
        answerPos = nextPos;
      }
    } else if (part) {
      const literalPos = answerCode.indexOf(part, answerPos);
      if (literalPos !== -1) {
        answerPos = literalPos + part.length;
      }
    }
  }

  return derived;
}

function loadSessionFromUrl(url, fallback = true) {
  fetch(url + "?t=" + Date.now())
    .then((r) => {
      if (!r.ok) throw new Error("Failed to load session.");
      return r.json();
    })
    .then((data) => setSession(data))
    .catch((err) => {
      console.warn(err.message);
      if (fallback && url !== "sample_session.json") {
        loadSessionFromUrl("sample_session.json", false);
      } else {
        LegacyAlerts.genericError(err.message);
      }
    });
}

// === Mode 2 inline blank conversion ===
function buildInlineBlankCode(originalCode, blanks, answerKey) {
  /**
   * Convert source code + blank info into inline __[N]__ markers.
   * blanks: [{line_num, answer, full_line, context}, ...]
   */
  const lines = originalCode.split('\n');

  const blanksByLine = {};

  // Group blank spaces by line
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

  // Each line processing
  const resultLines = lines.map((line, idx) => {
    const lineNum = idx + 1;  // 1-indexed
    if (!blanksByLine[lineNum]) return line;

    let modifiedLine = line;
    const blanksForLine = blanksByLine[lineNum];

    // Process all blank spaces in the line (process in reverse order to prevent index confusion)
    blanksForLine.sort((a, b) => b.blankNum - a.blankNum);

    for (const blank of blanksForLine) {
      const answer = blank.answer;
      const blankMarker = `__[${blank.blankNum}]__`;

      // Find the location of the correct answer and replace it with a blank space
      const answerIndex = modifiedLine.indexOf(answer);
      if (answerIndex !== -1) {
        modifiedLine = modifiedLine.slice(0, answerIndex) + blankMarker + modifiedLine.slice(answerIndex + answer.length);
        replacedCount++;
      } else {
        // If you don't find the correct answer, add a marker at the end of the line (fallback)
        console.warn(`[Blank ${blank.blankNum}] Answer not found in line ${lineNum}: "${answer}" in "${line}"`);
        failedCount++;
      }
    }

    return modifiedLine;
  });



  return resultLines.join('\n');
}

// === Mode 3 Inline blank conversion (function body to blank) ===
function buildInlineChallengeCode(originalCode, challenges, answerKey) {
  /**
   * Convert function bodies to __[N]__ markers based on challenge info.
   * challenges: [{signature, body, line_num}, ...]
   */
  const lines = originalCode.split('\n');
  let challengeNum = 0;
  let resultLines = [...lines];

  // Processing for each challenge (function)
  challenges.forEach((ch, idx) => {
    challengeNum = idx + 1;
    const signature = ch.signature;
    const body = ch.body;

    // Find your signature line
    let sigLineIdx = -1;
    for (let i = 0; i < resultLines.length; i++) {
      if (resultLines[i].trim().startsWith(signature.trim().split('(')[0])) {
        sigLineIdx = i;
        break;
      }
    }

    if (sigLineIdx !== -1) {
      // Replace function body lines with blank spaces
      const bodyLines = body.split('\n').filter(l => l.trim());
      if (bodyLines.length > 0) {
        // Find the index of the first body line (lines following the signature)
        let bodyStartIdx = sigLineIdx + 1;
        let bodyEndIdx = bodyStartIdx;

        // Find end of text (based on indentation)
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

        // Replace body lines with blank spaces
        const indent = resultLines[sigLineIdx + 1]?.match(/^(\s*)/)?.[1] || '    ';
        const blankPlaceholder = `${indent}# __[${challengeNum}]__ Implement this function body`;

        // Comment out the original lines or replace them with blank spaces.
        for (let i = bodyStartIdx; i < bodyEndIdx && i < resultLines.length; i++) {
          const line = resultLines[i];
          if (line.trim() && !line.trim().startsWith('#') && !line.trim().startsWith('"""') && !line.trim().startsWith("'''")) {
            resultLines[i] = indent + `__[${challengeNum}]__  # ${line.trim()}`;
            // Leave only the first line blank, hide the rest
            if (i > bodyStartIdx) {
              resultLines[i] = '';  // remove the rest of the lines
            }
          }
        }
      }
    }
  });

  // clean up empty lines
  resultLines = resultLines.filter((line, idx, arr) => {
    // Remove consecutive empty lines
    if (line === '' && arr[idx - 1] === '') return false;
    return true;
  });

  return resultLines.join('\n');
}


function setSession(rawSession) {
  // Extract special fields from rawSession.answer_key first (before normalizeSession)
  const rawAnswerKey = rawSession.answer_key || rawSession.answerKey || {};
  const rawBlanks = rawAnswerKey._blanks;
  const rawOriginalCode = rawAnswerKey._original_code;
  const rawChallenges = rawAnswerKey._challenges;

  currentSession = normalizeSession(rawSession);
  window.currentSession = currentSession;
  const { title, language, mode, question, answer, answer_key } = currentSession;
  challengeReviewQueue = new Set();

  // Restore special fields to answer_key (which may have been lost in normalizeSession)
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

  // Rendering by mode
  const type = answer_key?._type;

  if (type === "parsed_quiz" && answer_key?._questions) {
    renderParsedQuiz(answer_key._questions, answer_key, language);
  } else if (type === "multiple_choice" && answer_key?._questions) {
    renderMultipleChoiceNew(answer_key._questions, answer_key, language);
  } else if ((type === "fill_in_blank_cards" || type === "fill_in_blank_inline") && answer_key?._blanks) {
    // Mode 2: Render as inline blank space in the entire code
    // Generate inline blank code directly in question in Python
    // Check if question is already inline-blank format (with __[N]__ pattern)
    const hasInlineBlanks = /__\[\d+\]__/.test(question);

    if (hasInlineBlanks && question.length > 50) {
      // Directly use inline blank code generated by the Python backend

      renderQuestion(question, answer_key, language);
    } else {
      // Fallback: Try building inline blank in JS
      const originalCode = answer_key._original_code || currentSession.answer || "";
      if (originalCode && originalCode.length > 50) {
        const inlineCode = buildInlineBlankCode(originalCode, answer_key._blanks, answer_key);
        renderQuestion(inlineCode, answer_key, language);
      } else {

        renderQuestion(question || "", answer_key, language);
      }
    }
  } else if (type === "implementation_challenge" && answer_key?._challenges) {
    // Mode 3: Always render in card form (code editor + AI scoring)
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

// ========== PARSED QUIZ (Existing problem file) ==========
let parsedQuizStates = [];
let originalQuestions = [];  // Save original question order
let currentQuestions = [];   // Order of questions currently being displayed
let isShuffled = false;      // mixed state
let parsedQuizMap = new Map(); // qId -> Problem Object

function renderParsedQuiz(questions, answerKey, language, preserveOrder = false) {
  codeArea.innerHTML = "";
  blankList.innerHTML = "";
  inputs = [];
  reviewQueue = new Set();
  parsedQuizStates = [];
  parsedQuizMap = new Map();

  // Save original order (on first load)
  if (!preserveOrder) {
    originalQuestions = [...questions];
    currentQuestions = [...questions];
    isShuffled = false;
    updateShuffleButton();
  }

  const frag = document.createDocumentFragment();

  questions.forEach((q, idx) => {
    const qId = q.id || (idx + 1);  // Original unique ID
    const displayIdx = idx + 1;      // Current display order (1, 2, 3...)
    const displayNum = q.original_num || q.num || qId;
    const qType = q.type || "multiple_choice";

    const cardDiv = document.createElement("div");
    cardDiv.className = "mc-question";
    cardDiv.id = `pq-${qId}`;
    cardDiv.dataset.displayIdx = displayIdx;  // Save current display order

    // problem header
    const headerDiv = document.createElement("div");
    headerDiv.className = "mc-header";

    // Problem Type Badge
    const typeBadge = qType === "short_answer" ? "📝 단답형" :
      qType === "fill_blank" ? "✏️ 빈칸" : "📋 객관식";

    // Display globally unique ID in [Q#] format - AI can differentiate
    headerDiv.innerHTML = `<span class="global-qid" style="background:var(--accent);color:#000;padding:2px 6px;border-radius:4px;font-size:0.75em;margin-right:6px;font-weight:bold;">[Q${qId}]</span> <span style="opacity:0.6;font-size:0.8em">${typeBadge}</span> <strong>${displayNum}.</strong> ${escapeHtml(q.text)}`;
    cardDiv.appendChild(headerDiv);

    // code block
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

    // line or input area
    if (q.options && q.options.length > 0) {
      // multiple choice
      const optionsDiv = document.createElement("div");
      optionsDiv.className = "mc-options";

      q.options.forEach((opt) => {
        const optionBtn = document.createElement("button");
        optionBtn.className = "mc-option";
        optionBtn.dataset.question = String(qId);
        optionBtn.dataset.option = String(opt.num);
        // If you have the correct answer, save it (for grading)
        optionBtn.dataset.correct = q.correct ? String(q.correct) : "";

        const numSymbols = ["①", "②", "③", "④", "⑤"];
        const symbol = numSymbols[opt.num - 1] || opt.num;

        optionBtn.innerHTML = `<span class="mc-option-num">${symbol}</span><span class="mc-option-text">${escapeHtml(opt.text)}</span>`;
        optionBtn.addEventListener("click", () => handleParsedQuizClick(optionBtn, qId));

        optionsDiv.appendChild(optionBtn);
      });

      cardDiv.appendChild(optionsDiv);
    } else {
      // Short answer/blank - input field
      const inputDiv = document.createElement("div");
      inputDiv.className = "short-answer-input";
      inputDiv.style.cssText = "margin-top: 1rem;";

      const textarea = document.createElement("textarea");
      textarea.className = "challenge-textarea";
      textarea.id = `pq-input-${qId}`;
      textarea.placeholder = qType === "fill_blank" ? "빈칸에 들어갈 내용을 입력하세요..." : "답을 입력하세요... (Enter=제출, Enter 두 번=AI 정답)";
      textarea.rows = 2;
      textarea.style.cssText = "width: 100%; padding: 0.75rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: var(--fg); font-family: inherit; resize: vertical;";

      // Enter twice = View AI answer
      let lastEnterTime = 0;
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          const now = Date.now();
          if (now - lastEnterTime < 500) {
            // Press enter twice quickly → View AI answer
            e.preventDefault();
            showShortAnswerWithAI(qId, q.question, q.code || "");
          } else {
            // First Enter → Submit
            e.preventDefault();
            handleShortAnswerSubmit(qId, textarea.value);
          }
          lastEnterTime = now;
        }
      });

      // buttons
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

    // Show results
    const resultDiv = document.createElement("div");
    resultDiv.className = "mc-result";
    resultDiv.id = `pq-result-${qId}`;
    cardDiv.appendChild(resultDiv);

    frag.appendChild(cardDiv);
    parsedQuizMap.set(qId, q);

    parsedQuizStates.push({
      qId,
      displayIdx,  // Current display order
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

// ========== Shuffle function ==========
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

  // Shuffle the order of questions
  currentQuestions = shuffleArray(originalQuestions);
  isShuffled = true;

  // re-render
  renderParsedQuiz(currentQuestions, answerKey, language, true);
  updateShuffleButton();

  // scroll to top
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetQuizOrder() {
  if (!currentSession?.answer_key?._questions) return;

  const answerKey = currentSession.answer_key;
  const language = currentSession.language;

  // Restore to original order
  currentQuestions = [...originalQuestions];
  isShuffled = false;

  // re-render
  renderParsedQuiz(currentQuestions, answerKey, language, true);
  updateShuffleButton();

  // scroll to top
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
  // Mode 4 (multiple choice)
  if (currentSession?.answer_key?._questions) {
    if (isShuffled) {
      resetQuizOrder();
    } else {
      shuffleQuestions();
    }
    return;
  }

  // Mode 5 (Definition Quiz)
  if (definitionStates && definitionStates.length > 0) {
    shuffleDefinitions();
    return;
  }

  // Mode 7 (English words)
  if (vocabStates && vocabStates.length > 0) {
    shuffleVocab();
    return;
  }
}

// Definition Quiz Shuffle
function shuffleDefinitions() {
  const container = document.getElementById('definition-container') || codeBlock;
  if (!container) return;

  const cards = Array.from(container.querySelectorAll('.definition-card'));
  if (cards.length === 0) return;

  // Fisher-Yates Shuffle
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    container.appendChild(cards[j]);
  }

  // Add all cards again (in shuffled order)
  cards.sort(() => Math.random() - 0.5).forEach(card => container.appendChild(card));

  window.scrollTo({ top: 0, behavior: 'smooth' });

  const btn = document.getElementById('btn-shuffle');
  if (btn) btn.textContent = '🔀 다시 섞기';
}

// Shuffle the order of English words
function shuffleVocab() {
  const container = document.getElementById('vocab-container') || codeBlock;
  if (!container) return;

  const cards = Array.from(container.querySelectorAll('.vocab-card'));
  if (cards.length === 0) return;

  // Fisher-Yates Shuffle
  cards.sort(() => Math.random() - 0.5).forEach(card => container.appendChild(card));

  window.scrollTo({ top: 0, behavior: 'smooth' });

  const btn = document.getElementById('btn-shuffle');
  if (btn) btn.textContent = '🔀 다시 섞기';
}

function handleParsedQuizClick(btn, qId) {
  const selectedOption = btn.dataset.option;
  const correctAnswer = btn.dataset.correct;  // Correct answer (if any)
  const state = parsedQuizStates.find(s => s.qId === qId);

  if (state?.answered) return;

  // status update
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

  // Grade if correct answer
  if (correctAnswer) {
    const isCorrect = selectedOption === correctAnswer;

    options.forEach(opt => {
      opt.disabled = true;
      if (opt.dataset.option === correctAnswer) {
        opt.classList.add("correct");  // The answer is always green
      }
      if (opt.dataset.option === selectedOption && !isCorrect) {
        opt.classList.add("wrong");  // If the answer is wrong, red
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
    // If there is no correct answer, only the choice is displayed
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

// Short answer/blank submission handler (AI grading)
async function handleShortAnswerSubmit(qId, answer) {
  const state = parsedQuizStates.find(s => s.qId === qId);

  if (state?.isCorrect) return;

  if (!answer.trim()) {
LegacyAlerts.requireAnswer();
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
    resultDiv.innerHTML = `<span class="mc-wrong">Scoring error: ${err.message}</span>`;
  }
}

// Short-answer AI grading (very strict)
async function checkShortAnswerWithAI(question, code, userAnswer) {
  const prompt = `You are an extremely strict programming exam grader. Do not be generous.

## Question
${question}

${code ? `## Related code\n\`\`\`\n${code}\n\`\`\`` : ''}

## Student answer
"${userAnswer}"

## Strict grading rules
1) Must be exactly correct (no partial credit).
2) Vague descriptions are WRONG.
3) Numeric answers must be exact.
4) Output questions require the exact output.
5) Nonsense or unrelated answers are WRONG.
6) If uncertain, mark WRONG.

## Response (one word only)
- If 100% confident it's correct: CORRECT
- Otherwise: WRONG`;

  try {
    const response = await callGeminiAPI(prompt, "You are an extremely strict exam grader. When in doubt, mark as WRONG.");
    const upperResponse = response.toUpperCase().trim();
    // Only accept if it contains CORRECT and not WRONG
    if (upperResponse.includes("CORRECT") && !upperResponse.includes("WRONG")) {
      return true;
    }
    return false; // default to wrong
  } catch (err) {
    console.error("AI grading error:", err);
    return false; // on API failure, mark wrong
  }
}

// Reset short-answer attempt
function resetShortAnswer(qId) {
  const state = parsedQuizStates.find(s => s.qId === qId);
  if (!state) return;

  const textarea = document.getElementById(`pq-input-${qId}`);
  const resultDiv = document.getElementById(`pq-result-${qId}`);
  const nav = document.getElementById(`nav-pq-${qId}`);

  // Reset state
  state.answered = false;
  state.isCorrect = null;
  state.userAnswer = "";

  // UI initialization
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

// AI show-answer helper
async function showShortAnswerWithAI(qId, question, code) {
  const resultDiv = document.getElementById(`pq-result-${qId}`);
  const state = parsedQuizStates.find(s => s.qId === qId);

  resultDiv.innerHTML = `<span style="color: var(--accent-2);">🤔 AI is finding the answer...</span>`;

  const prompt = `You are a programming question explainer.

## Question
${question}

${code ? `## Code\n\`\`\`\n${code}\n\`\`\`` : ''}

Provide the correct answer and a brief explanation:
- State the answer first, clearly.
- Explain why in 1-2 lines.

Format: "Answer: [text] / Explanation: [text]"`;

  try {
    const response = await callGeminiAPI(prompt, "Provide the correct answer clearly.");

    // Render answer
    resultDiv.innerHTML = `
      <div style="background: rgba(102, 126, 234, 0.1); border: 1px solid rgba(102, 126, 234, 0.3); border-radius: 8px; padding: 12px; margin-top: 8px;">
        <div style="color: #667eea; font-weight: bold; margin-bottom: 6px;">💡 AI Answer</div>
        <div style="color: var(--fg);">${escapeHtml(response)}</div>
      </div>`;

    // Mark state as revealed
    if (state && !state.answered) {
      state.answered = true;
      state.isCorrect = false; // saw answer, treat as incorrect
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
    btn.textContent = `${idx + 1}`;  // Sequential number (1, 2, 3...)
    btn.title = `[Q${s.qId}] ${s.displayNum}번`;  // Global ID + original number in tooltip
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

  // Show scores if there are gradable questions
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

// ========== MULTIPLE CHOICE (Code Generation) ==========
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

    // problem header
    const headerDiv = document.createElement("div");
    headerDiv.className = "mc-header";
    headerDiv.innerHTML = `<strong>[문제 ${qNum}]</strong> ${escapeHtml(q.text)}`;
    cardDiv.appendChild(headerDiv);

    // code block
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

    // Seonji
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

    // result
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
let mcQuestions = []; // Save multiple choice question state

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

    // problem container
    const questionDiv = document.createElement("div");
    questionDiv.className = "mc-question";
    questionDiv.id = `mc-${questionNum}`;

    // Problem parsing (separating code and lines from text)
    const parts = questionText.split(/```python\n/);
    const header = parts[0] || "";
    const rest = parts[1]?.split(/```\n/) || ["", ""];
    const codeBlock = rest[0] || "";
    const optionsText = rest[1] || "";

    // problem header
    const headerDiv = document.createElement("div");
    headerDiv.className = "mc-header";
    headerDiv.innerHTML = escapeHtml(header.trim());
    questionDiv.appendChild(headerDiv);

    // code block
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

    // Line parsing and rendering
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

    // Results display area
    const resultDiv = document.createElement("div");
    resultDiv.className = "mc-result";
    resultDiv.id = `mc-result-${questionNum}`;
    questionDiv.appendChild(resultDiv);

    frag.appendChild(questionDiv);

    // save state
    mcQuestions.push({
      questionNum,
      correctAnswer,
      answered: false,
      isCorrect: null
    });
  });

  codeArea.appendChild(frag);

  // Rendering a list of issues instead of a blank list
  renderMCNav();

  sessionCount.textContent = questions.length;
  hasAnswers = true;
  updateMCScore();
}

function handleMCClick(btn) {
  const questionNum = parseInt(btn.dataset.question);
  const selectedOption = btn.dataset.option;
  const correctOption = btn.dataset.correct;

  // Ignore questions that have already been answered
  const questionState = mcQuestions.find(q => q.questionNum === questionNum);
  if (questionState?.answered) return;

  const isCorrect = selectedOption === correctOption;

  // status update
  if (questionState) {
    questionState.answered = true;
    questionState.isCorrect = isCorrect;
  }

  // UI updates
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

  // Result message
  const resultDiv = document.getElementById(`mc-result-${questionNum}`);
  if (isCorrect) {
    resultDiv.innerHTML = `<span class="mc-correct">✓ 정답입니다!</span>`;
  } else {
    resultDiv.innerHTML = `<span class="mc-wrong">✗ 오답입니다. 정답: ${correctOption}번</span>`;
  }

  // navigation updates
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

    // header
    const headerDiv = document.createElement("div");
    headerDiv.className = "blank-card-header";
    headerDiv.innerHTML = `<span class="blank-card-num">#${cardNum}</span> <span class="blank-card-line">Line ${blank.line_num}</span>`;
    cardDiv.appendChild(headerDiv);

    // code context
    const codeDiv = document.createElement("pre");
    codeDiv.className = "blank-card-code";

    // Convert _____ to input in code
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

    // Convert _____ to input
    codeHtml = codeHtml.replace(/_____/g,
      `<input type="text" class="blank-card-input" data-key="${cardNum}" data-answer="${escapeHtml(answer)}" placeholder="정답 입력">`
    );

    codeDiv.innerHTML = codeHtml;
    cardDiv.appendChild(codeDiv);

    // Show results
    const resultDiv = document.createElement("div");
    resultDiv.className = "blank-card-result";
    resultDiv.id = `blank-result-${cardNum}`;
    cardDiv.appendChild(resultDiv);

    // help button
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

  // Bind event to input
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

  const isCorrect = compareAnswers(userAnswer, expected);
  const state = blankCardStates.find(s => s.cardNum === cardNum);

  if (state) {
    state.answered = true;
    state.isCorrect = isCorrect;
  }

  // UI updates
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

  // navigation updates
  const nav = document.getElementById(`nav-blank-${cardNum}`);
  if (nav) {
    nav.classList.remove("pending");
    nav.classList.add(isCorrect ? "correct" : "revealed");
  }

  updateBlankCardScore();

  // Focus to next input
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

    // header
    const headerDiv = document.createElement("div");
    headerDiv.className = "challenge-header";
    headerDiv.innerHTML = `<span class="challenge-num">챌린지 ${challengeNum}</span>`;
    cardDiv.appendChild(headerDiv);

    // function signature
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

    // hint
    const hintDiv = document.createElement("div");
    hintDiv.className = "challenge-hint";
    hintDiv.textContent = "↓ 아래에 함수 본문을 구현하세요";
    cardDiv.appendChild(hintDiv);

    // input area
    const textarea = document.createElement("textarea");
    textarea.className = "challenge-input";
    textarea.dataset.key = String(challengeNum);
    textarea.dataset.answer = answer;
    textarea.placeholder = "    # 여기에 코드 구현...";
    textarea.rows = 8;
    textarea.spellcheck = false;

    // Python automatic indentation and Enter key grading
    textarea.addEventListener("keydown", (e) => {
      // Tab key: Add indentation
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = textarea.value;
        textarea.value = value.substring(0, start) + "    " + value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 4;
        return;
      }

      // Shift+Tab: Remove indentation
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

      // ===== Enter Key: Auto Indent + Grading Shortcuts =====
      // VSCode Style: Enter on blank line = cancel one level of indentation
      if (e.key === "Enter") {
        // Shift+Enter: Individual grading (Mode3 only)
        if (e.shiftKey) {
          e.preventDefault();
          handleChallengeCheck(challengeNum);
          return;
        }

        // Ctrl+Enter propagates to entire grading
        if (e.ctrlKey || e.metaKey) {
          return;
        }

        e.preventDefault();
        const start = textarea.selectionStart;
        const value = textarea.value;
        const lineStart = value.lastIndexOf("\n", start - 1) + 1;
        const currentLine = value.substring(lineStart, start);

        // Extract indentation of current line
        const indentMatch = currentLine.match(/^(\s*)/);
        let indent = indentMatch ? indentMatch[1] : "";

        // ★ VSCode Style: If the current line contains only spaces (empty line), cancel one level of indentation.
        if (currentLine.trim() === "" && indent.length >= 4) {
          // Decrease the space of the previous line by 4 spaces (cancel indentation)
          const newIndent = indent.substring(4);
          // Replace current line content with new indentation
          textarea.value = value.substring(0, lineStart) + newIndent + "\n" + newIndent + value.substring(start);
          textarea.selectionStart = textarea.selectionEnd = lineStart + newIndent.length + 1 + newIndent.length;
          return;
        }

        // Additional indentation that ends with : (def, if, for, while, class, try, except, etc.)
        if (currentLine.trim().endsWith(":")) {
          indent += "    ";
        }

        textarea.value = value.substring(0, start) + "\n" + indent + value.substring(start);
        textarea.selectionStart = textarea.selectionEnd = start + 1 + indent.length;
        return;
      }
    });

    cardDiv.appendChild(textarea);

    // button area
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

    // result
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
  const textarea = card?.querySelector("textarea");
  const state = challengeStates.find(s => s.challengeNum === num);
  const resultDiv = document.getElementById(`challenge-result-${num}`);

  if (!card || !textarea || !state || !resultDiv) {
    console.warn("Challenge card missing for grading:", num);
    return;
  }

  const userAnswer = textarea.value.trim();

  // Empty answer check
  if (!userAnswer) {
    resultDiv.innerHTML = `<span class="mc-wrong">✗ Please enter your code</span>`;
    return;
  }

  // If already marked wrong and retrying, show the answer
  if (textarea.classList.contains("wrong") && !textarea.classList.contains("revealed")) {
    handleChallengeShow(num);
    return;
  }

  // Skip if already graded
  if (textarea.classList.contains("correct") || textarea.classList.contains("revealed")) {
    return;
  }

  // Start AI grading
  resultDiv.innerHTML = `<span class="definition-loading">🤖 AI is grading...</span>`;

  const expected = state.answer.trim();
  const signature = state.signature || "";

  try {
    // Count core lines in the reference (exclude comments/blank)
    const expectedLines = expected.split('\n')
      .filter(line => line.trim() && !line.trim().startsWith('#'))
      .length;
    const userLines = userAnswer.split('\n')
      .filter(line => line.trim() && !line.trim().startsWith('#'))
      .length;

    // If line count differs by ≥50%, mark wrong immediately
    if (userLines < expectedLines * 0.5) {
      finishChallengeCheck(num, false, `Code is too short. (Need ≥ ${expectedLines} lines, got ${userLines})`);
      return;
    }

    // AI grading - strict prompt
    const prompt = `Grade this Python code strictly.

## Function signature
${signature}

## Reference solution (all of this must be present)
\`\`\`python
${expected}
\`\`\`

## Student code
\`\`\`python
${userAnswer}
\`\`\`

## Strict grading rules
1) Student code must include every piece of logic in the reference.
2) Include conditionals, loops, and returns if present in the reference.
3) Function calls must match (e.g., print(), current.link).
4) Variable/function names must match.
5) Any missing code → WRONG.
6) Ignore comments when grading.
7) Ignore indentation/whitespace differences.

## Response
Reply only with CORRECT or WRONG. If unsure, reply WRONG.`;

    const response = await callGeminiAPI(prompt, "Grade strictly. Only reply CORRECT if everything is present; otherwise reply WRONG.");

    // Accept only if CORRECT appears and WRONG does not
    const responseUpper = response.toUpperCase().trim();
    const isCorrect = responseUpper.startsWith('CORRECT') ||
      (responseUpper.includes('CORRECT') && !responseUpper.includes('WRONG'));

    const feedback = isCorrect ? 'Correct! 🎉' : 'Please review the code.';
    finishChallengeCheck(num, isCorrect, feedback);

  } catch (err) {
    // Fallback to strict local comparison if AI fails
    const normalize = (s) => s.replace(/\s+/g, '').replace(/#.*$/gm, '').toLowerCase();
    const expectedNorm = normalize(expected);
    const userNorm = normalize(userAnswer);

    // Student code must fully contain the reference
    const isCorrect = userNorm.includes(expectedNorm) || expectedNorm === userNorm;
    finishChallengeCheck(num, isCorrect, `${isCorrect ? "Correct!" : "Please review"} (AI fallback)`);
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

// Why is it wrong?AI Description
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

  const prompt = buildDifferencePrompt(correctAnswer, userAnswer);

  try {
    const response = await callGeminiAPI(prompt, "List only the differences in 2-3 short sentences.");
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
  const textarea = card?.querySelector("textarea");
  const state = challengeStates.find(s => s.challengeNum === num);

  if (!card || !textarea || !state) return;

  textarea.value = state.answer;
  textarea.disabled = true;
  textarea.classList.remove("wrong");
  textarea.classList.add("revealed");

  state.answered = true;
  state.isCorrect = false;

  const resultDiv = document.getElementById(`challenge-result-${num}`);
  if (!resultDiv) return;
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

  // state reset
  textarea.value = "";
  textarea.disabled = false;
  textarea.classList.remove("correct", "wrong", "revealed", "retried");
  textarea.focus();

  state.answered = false;
  state.isCorrect = null;
  state.hasBeenWrong = false;
  challengeReviewQueue.delete(String(num));

  // Result initialization
  const resultDiv = document.getElementById(`challenge-result-${num}`);
  resultDiv.innerHTML = "";

  // Reset navigation
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
  const isCorrect = compareAnswers(user, expected);

  // Show/hide red question mark button
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
  // Mode 7 (English word) processing
  if (vocabStates && vocabStates.length > 0) {
    const unansweredIndices = vocabStates
      .filter(s => !s.answered && !s.needsAi)
      .map(s => s.wordNum);

    if (unansweredIndices.length === 0) {
      LegacyAlerts.allVocabGraded();
      return;
    }

    unansweredIndices.forEach(num => handleVocabCheck(num));
    return;
  }

  // Mode 5 (Definition Quiz) Processing
  if (definitionStates && definitionStates.length > 0) {
    const unansweredIndices = definitionStates
      .filter(s => !s.answered)
      .map(s => s.defNum);

    if (unansweredIndices.length === 0) {
      LegacyAlerts.allDefinitionsGraded();
      return;
    }

    // Score each definition sequentially (when using AI)
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

  // Mode 3 (Blank review / Challenge mode) processing
  if (challengeStates.length > 0) {
    const unansweredIndices = challengeStates
      .filter(s => !s.answered)
      .map(s => s.challengeNum);

    if (unansweredIndices.length === 0) {
      LegacyAlerts.allChallengesGraded();
      return;
    }

    // Begin grading each challenge sequentially
    const checkNextChallenge = async (indices) => {
      if (indices.length === 0) {
        updateChallengeScore();
        return;
      }
      const num = indices[0];
      await handleChallengeCheck(num);
      // Next grading after some delay (avoid API overload)
      setTimeout(() => checkNextChallenge(indices.slice(1)), 500);
    };

    checkNextChallenge(unansweredIndices);
    return;
  }

  // Normal blank mode
  inputs.forEach((input) => checkOne(input));
}

function revealAll() {
  // Mode 1 AI blank processing (.mode1-input)
  const mode1Inputs = document.querySelectorAll('.mode1-input');
  if (mode1Inputs.length > 0) {
    mode1Inputs.forEach((input) => {
      if (input.classList.contains('correct') || input.classList.contains('revealed')) {
        return; // Already processed
      }

      // Get the correct answer from data-answer property (show local answer)
      const answer = input.dataset.answer;
      if (answer) {
        input.value = answer;
        input.classList.remove('wrong', 'pending');
        input.classList.add('revealed');
        input.style.borderColor = 'var(--yellow)';

        // Nav pill update
        const qNum = input.dataset.q;
        const blankNum = input.dataset.blank;
        const navPill = document.getElementById(`nav-mode1-${qNum}-${blankNum}`);
        if (navPill) {
          navPill.classList.remove('wrong', 'pending');
          navPill.classList.add('revealed');
        }
      }
    });
    updateMode1Score();
    return;
  }

  // General blank processing
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
  // Two-step scoring system:
  // Step 1: Only mark correct/incorrect answers
  // Step 2: If the answer is wrong, mark the correct answer (yellow)

  // If you press Enter again when the answer is already marked as incorrect, the correct answer will be displayed.
  if (input.classList.contains("wrong") && !input.classList.contains("revealed")) {
    // Step 2: Mark correct answers (yellow)
    revealOne(input, { autoAdvance: true });
    return;
  }

  // If grading has already been completed, move to next
  if (input.classList.contains("correct") || input.classList.contains("revealed")) {
    focusNext(input);
    return;
  }

  // Step 1: Just do the grading
  const ok = checkOne(input);
  if (ok === null) {
    if (!warnedMissingAnswers && !hasAnswers) {
      LegacyAlerts.missingAnswerKey();
      warnedMissingAnswers = true;
    }
    return;
  }

  if (!ok) {
    // Wrong answer: only red (correct answer not yet shown)
    setState(input, "wrong");
    SoundEffects.play("wrong");
    LearningStats.recordAnswer(false);
    updateScore();
    // Wait for next Enter (remove automatic correct answer display)
  } else {
    // Correct answer
    SoundEffects.play("correct");
    LearningStats.recordAnswer(true);
    focusNext(input);
  }
}

function startReviewCycle() {
  // Prioritize mode 4 (parsed multiple choice/short answer)
  if (parsedQuizStates.length > 0) {
    const reviewTargets = parsedQuizStates.filter(
      (s) => s.isCorrect === false || s.isCorrect === null || !s.answered
    );

    if (!reviewTargets.length) {
      LegacyAlerts.noReviewQuestions();
      return;
    }

    // Add destination after initializing queue
    reviewQueue = new Set(reviewTargets.map((s) => String(s.qId)));

    // Reset UI/state + hide non-target cards
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

  // Mode 3 Challenge (blank sheet practice)
  if (challengeStates.length > 0) {
    const reviewTargets = challengeStates.filter(
      (s) => s.isCorrect === false || !s.answered || s.hasBeenWrong
    );
    if (!reviewTargets.length) {
      LegacyAlerts.noReviewQuestions();
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

  // Definition Quiz / English Vocabulary Card
  if (definitionStates.length > 0 || vocabStates.length > 0) {
    const defTargets = definitionStates.filter((s) => s.isCorrect === false || !s.answered);
    const vocabTargets = vocabStates.filter((s) => s.isCorrect === false || !s.answered);
    if (!defTargets.length && !vocabTargets.length) {
      LegacyAlerts.noReviewCards();
      return;
    }
    reviewQueue = new Set([
      ...defTargets.map((s) => `definition-${s.defNum}`),
      ...vocabTargets.map((s) => `vocab-${s.wordNum}`)
    ]);

    // definition card
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

    // English word card
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

  // Normal blank mode
  const targets = inputs.filter(
    (inp) =>
      inp.classList.contains("wrong") ||
      inp.classList.contains("revealed") ||
      inp.classList.contains("retried")
  );
  if (!targets.length && !reviewQueue.size) {
LegacyAlerts.noReviewBlanks();
    return;
  }
  reviewQueue = new Set(reviewQueue);
  targets.forEach((inp) => {
    reviewQueue.add(inp.dataset.key);
  });
  // Blank spaces other than the target are inactive/hidden, and the target is reset.
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
      LegacyAlerts.emptyReviewQueue();
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
      LegacyAlerts.emptyReviewQueue();
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
      LegacyAlerts.emptyReviewQueue();
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
LegacyAlerts.emptyReviewQueue();
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
// Changed to immediate execution function instead of DOMContentLoaded (corresponds to dynamic script loading)
function initializeButtonHandlers() {
  // Load and display mobile phone access address and ngrok URL
  const mobileUrlEl = document.getElementById("mobile-url");
  const ngrokUrlEl = document.getElementById("ngrok-url");

  // Load IP and ngrok URL from server_info.json
  fetch("/server_info.json")
    .then(r => r.json())
    .then(info => {
      const currentPort = window.location.port || "3000";

      // Mobile URL display
      if (mobileUrlEl) {
        const mobileUrl = `http://${info.local_ip}:${currentPort}`;
        mobileUrlEl.textContent = `📱 ${mobileUrl}`;
        mobileUrlEl.title = "클릭하면 복사";
      }

      // Show ngrok URL (only if present)
      if (ngrokUrlEl && info.ngrok_url) {
        ngrokUrlEl.textContent = `🌐 ${info.ngrok_url}`;
        ngrokUrlEl.title = "클릭하면 복사 (외부 접속용)";
        ngrokUrlEl.style.display = "inline-block";

        // Click to copy
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
      // If server_info.json is not present, use current host
      if (mobileUrlEl) {
        const currentHost = window.location.hostname;
        const currentPort = window.location.port || "3000";
        if (currentHost === "localhost" || currentHost === "127.0.0.1") {
          mobileUrlEl.textContent = "📱 같은 WiFi에서 PC IP:3000";
        } else {
          mobileUrlEl.textContent = `📱 http://${currentHost}:${currentPort}`;
        }
      }
    });

  // Click to copy mobile URL
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

  // Full grading
  const btnCheckLocal = document.getElementById("btn-check");
  if (btnCheckLocal) {
    btnCheckLocal.addEventListener("click", () => {
      // parsed_quiz mode
      if (parsedQuizStates.length > 0) {
        const answered = parsedQuizStates.filter(s => s.answered).length;
        const total = parsedQuizStates.length;
      LegacyAlerts.progressSummary(answered, total);
        return;
      }
      // General blank grading
      inputs.forEach((inp) => checkOne(inp, false));
      updateScore();
    });
  }

  // See all answers
  const btnRevealLocal = document.getElementById("btn-reveal");
  if (btnRevealLocal) {
    btnRevealLocal.addEventListener("click", () => {
      // parsed_quiz mode
      if (parsedQuizStates.length > 0) {
        // Just mark all questions as "selected" (since you don't know the correct answer)
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
      LegacyAlerts.noParsingAnswers();
        return;
      }
      // plain blank space
      inputs.forEach((inp) => revealOne(inp));
      updateScore();
    });
  }

  // Start review mode
  const btnReview = document.getElementById("btn-review");
  if (btnReview) {
    btnReview.addEventListener("click", startReviewCycle);
  }

  // reset
  const btnReset = document.getElementById("btn-reset");
  if (btnReset) {
    btnReset.addEventListener("click", () => {
      if (confirm("모든 답변을 초기화하시겠습니까?")) {
        // parsed_quiz mode
        if (parsedQuizStates.length > 0) {
          parsedQuizStates.forEach(s => {
            s.answered = false;
            s.selected = null;
            s.userAnswer = "";

            // UI initialization
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
        // plain blank space
        inputs.forEach((inp) => {
          inp.value = "";
          setState(inp, "pending");
        });
        reviewQueue.clear();
        updateScore();
      }
    });
  }

  // API key buttons
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
      LegacyAlerts.apiKeySaved();
      }
    });
  }

  const btnCancelApiKey = document.getElementById("btn-cancel-api-key");
  if (btnCancelApiKey) {
    btnCancelApiKey.addEventListener("click", hideApiKeyModal);
  }

  // keyboard shortcut button
  const btnShortcuts = document.getElementById("btn-shortcuts");
  if (btnShortcuts) {
    btnShortcuts.addEventListener("click", () => KeyboardShortcuts.showHelp());
  }

  // top button
  const btnScrollTop = document.getElementById("btn-scroll-top");
  if (btnScrollTop) {
    btnScrollTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // Start learning timer (also starts when session loads)
  StudyTimer.start();

  // Attempt to restore previous session
  setTimeout(() => SessionSaver.restore(), 500);

  // Request notification permission (for Pomodoro notifications)
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// Attach AI panel header button event listener
function attachAIHeaderListeners() {
  const btnAiNew = document.getElementById("btn-ai-new");
  if (btnAiNew && !btnAiNew.dataset.listenerAttached) {
    btnAiNew.dataset.listenerAttached = "true";
    btnAiNew.addEventListener("click", startNewChatSession);
  }

  const btnAiHistory = document.getElementById("btn-ai-history");
  if (btnAiHistory && !btnAiHistory.dataset.listenerAttached) {
    btnAiHistory.dataset.listenerAttached = "true";
    btnAiHistory.addEventListener("click", toggleChatHistory);
  }

  const btnClosePanel = document.getElementById("btn-close-panel");
  if (btnClosePanel && !btnClosePanel.dataset.listenerAttached) {
    btnClosePanel.dataset.listenerAttached = "true";
    btnClosePanel.addEventListener("click", toggleAIPanel);
  }
}

// Wire chat send button and Enter key
function attachAIChatControls() {
  const sendBtn = document.getElementById("btn-send-chat");
  if (sendBtn && !sendBtn.dataset.listenerAttached) {
    sendBtn.dataset.listenerAttached = "true";
    sendBtn.addEventListener("click", sendChatMessage);
  }

  if (chatInput && !chatInput.dataset.listenerAttached) {
    chatInput.dataset.listenerAttached = "true";
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }
}

// If the script loads late, ensure handlers are attached after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeButtonHandlers();
    attachAIHeaderListeners();
    attachAIChatControls();
  });
} else {
  // DOM is already ready
  initializeButtonHandlers();
  attachAIHeaderListeners();
  attachAIChatControls();
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

    // Terminology (Front)
    const termDiv = document.createElement("div");
    termDiv.className = "definition-term";
    termDiv.innerHTML = `<span class="definition-num">#${defNum}</span> <strong>${escapeHtml(def.term)}</strong>이란?`;
    cardDiv.appendChild(termDiv);

    // Input area (Back - blank)
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

    // Show results
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
LegacyAlerts.requireDefinition();
    return;
  }

  const resultDiv = document.getElementById(`def-result-${defNum}`);
  resultDiv.innerHTML = `<span class="definition-loading">🤔 AI가 채점 중...</span>`;
  textarea.disabled = true;

  try {
    const isCorrect = await checkDefinitionWithAI(state.term, userAnswer, state.correctAnswer);

    state.answered = true;
    state.isCorrect = isCorrect;

    // Learning Statistics Record
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

    // Focus on next question (so previous answers are visible)
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
  // Minimum length check (an answer that is too short is always incorrect)
  if (userAnswer.length < 10) {
    return false;
  }

  const prompt = buildDefinitionGradePrompt({ term, correctAnswer, userAnswer });

  try {
    const response = await callGeminiAPI(prompt, "Respond with JSON only. Grade strictly.");
    const jsonMatch = response.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return result.correct === true;
    }
    // Strict comparison when parsing fails
    return false;
  } catch (err) {
    console.error("AI grading error:", err);
    // Strictly even in case of AI failure - the correct answer must be an exact match
    return normalizeAnswerText(userAnswer) === normalizeAnswerText(correctAnswer);
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
    const correctAnswer = word.korean || "[AI generation needed]";

    const cardDiv = document.createElement("div");
    cardDiv.className = "vocab-card";
    cardDiv.id = `vocab-${wordNum}`;

    // english words
    const termDiv = document.createElement("div");
    termDiv.className = "vocab-term";
    termDiv.innerHTML = `<span class="vocab-num">#${wordNum}</span> <strong class="vocab-english">${escapeHtml(word.english)}</strong>`;
    cardDiv.appendChild(termDiv);

    // Enter/display Korean meaning
    const meaningDiv = document.createElement("div");
    meaningDiv.className = "vocab-meaning-area";

    if (word.needs_ai) {
      // When AI needs to generate
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
      // If there is already a meaning - blank test
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

    // Show results
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
  if (!resultDiv) return;
  resultDiv.innerHTML = `<span class="definition-loading">🤖 AI가 뜻을 생성 중...</span>`;

  const prompt = buildVocabMeaningPrompt(english);

  try {
    const response = await callGeminiAPI(prompt, "Respond with JSON only.");
    const jsonMatch = response.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      const meaning = result.meaning || "생성 실패";

      resultDiv.innerHTML = `
        <div class="vocab-generated">
          <strong>뜻:</strong> ${escapeHtml(meaning)}
        </div>`;

      // status update
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

  const normalize = (s) => normalizeAnswerText(s);
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
  if (!resultDiv) return;

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

  // Current selection status
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

  // Modal auto-display function
  function showFileModeModal() {
    if (modal) {
      modal.style.display = "flex";
      if (statusEl) {
        statusEl.textContent = "";
        statusEl.className = "fm-status";
      }
    }
  }

  // Check session status - automatically show modal if empty or fallback session
  function checkSessionAndShowModal() {
    // Check if currentSession does not exist or is a fallback session
    if (!currentSession) {
      console.log("No session detected - showing modal");
      showFileModeModal();
      return;
    }

    // Fallback session detection: if title is "default session" or answer_key is empty
    const isFallbackSession =
      currentSession.title === "기본 세션" ||
      (!currentSession.answer_key) ||
      (currentSession.answer_key._type === "whiteboard" &&
        (!currentSession.answer_key._challenges || currentSession.answer_key._challenges.length === 0));

    if (isFallbackSession) {
      console.log("Fallback session detected - showing modal");
      showFileModeModal();
    }
  }

  // Check session state - check immediately since initializeApp has already loaded the session.
  checkSessionAndShowModal();

  // Open modal
  if (btnOpen) {
    btnOpen.addEventListener("click", () => {
      modal.style.display = "flex";
      statusEl.textContent = "";
      statusEl.className = "fm-status";
    });
  }

  // Close modal
  if (btnCancel) {
    btnCancel.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  // Select preset file
  document.querySelectorAll(".fm-preset:not(.fm-upload)").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".fm-preset").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedPreset = btn.dataset.preset;
      customFileContent = null; // Initialize custom file when selecting preset
      selectedFileEl.textContent = fileNames[selectedPreset] || selectedPreset;

      // Automatic selection of default mode (data-default-mode property)
      const defaultMode = btn.dataset.defaultMode;
      if (defaultMode) {
        selectedMode = parseInt(defaultMode, 10);
        // Mode button UI update
        document.querySelectorAll(".fm-mode").forEach(m => m.classList.remove("active"));
        const modeBtn = document.querySelector(`.fm-mode[data-mode="${defaultMode}"]`);
        if (modeBtn) modeBtn.classList.add("active");

        // Difficulty UI update
        updateDifficultyVisibility(selectedMode);
      }

      // Automatic selection of default method: based on mode/file
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

  // Activate first preset + set default mode
  const firstPreset = document.querySelector('.fm-preset:not(.fm-upload)');
  if (firstPreset) {
    firstPreset.classList.add('active');
    // The default mode of the first preset is also applied.
    const defaultMode = firstPreset.dataset.defaultMode;
    if (defaultMode) {
      selectedMode = parseInt(defaultMode, 10);
      document.querySelectorAll(".fm-mode").forEach(m => m.classList.remove("active"));
      const modeBtn = document.querySelector(`.fm-mode[data-mode="${defaultMode}"]`);
      if (modeBtn) modeBtn.classList.add("active");
    }
  }

  // file upload handler
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
        selectedPreset = "custom"; // Show custom files

        // UI updates
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

  // Select mode


  // Difficulty section display update function
  function updateDifficultyVisibility(mode) {
    const diffSection = document.getElementById("difficulty-section");
    if (diffSection) {
      // Displayed in modes that require difficulty, such as mode 1 (OOP blank), 2 (data structure blank), and 6 (code writing).
      const show = (mode === 1 || mode === 2);
      diffSection.style.display = show ? "block" : "none";
    }
  }

  // Select mode
  document.querySelectorAll(".fm-mode").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".fm-mode").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedMode = parseInt(btn.dataset.mode, 10);

      // Modes 1 and 6 are AI required, the rest are local defaults
      if (selectedMode === 1 || selectedMode === 6) {
        selectedMethod = "ai";
        document.querySelectorAll(".fm-method").forEach(m => m.classList.remove("active"));
        const aiBtn = document.querySelector('.fm-method[data-method="ai"]');
        if (aiBtn) aiBtn.classList.add("active");
      } else {
        selectedMethod = "local";
        // Keep existing selection but default to local
        if (!selectedMethod) selectedMethod = "local";
      }

      updateDifficultyVisibility(selectedMode);
    });
  });

  // Select creation method
  let selectedMethod = "local";
  document.querySelectorAll(".fm-method").forEach(btn => {
    btn.addEventListener("click", () => {
      // Modes 1 and 6 have fixed AI
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

  // ========== Select Difficulty ==========
  let selectedDifficulty = "normal";
  const difficultyHints = {
    easy: "쉬움: 키워드/자료형/리터럴 위주, 낮은 비율 빈칸",
    normal: "보통: 키워드/자료형/리터럴 위주, 중간 비율 빈칸",
    hard: "어려움: 키워드/자료형/리터럴 위주, 높은 비율 빈칸",
    extreme: "매우어려움: 키워드/자료형/리터럴 위주, 매우 높은 비율 빈칸"
  };

  document.querySelectorAll(".fm-diff").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".fm-diff").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedDifficulty = btn.dataset.diff;

      // Hint update
      const hintEl = document.getElementById("diff-hint");
      if (hintEl) {
        hintEl.textContent = difficultyHints[selectedDifficulty] || "";
      }
    });
  });

  // Create session
  if (btnGenerate) {
    btnGenerate.addEventListener("click", async () => {
      // ===== Mode 6: Writing computational math code (processed directly on the frontend) =====
      if (selectedMode === 6) {
        statusEl.textContent = "🤖 AI가 코드 작성 문제를 생성 중...";
        modal.style.display = "none";
        await renderMode6CodeWriting();
        return;
      }

      // ===== Mode 1: C# OOP variant blank (processed directly in frontend) =====
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
        // Configuring request data
        const requestData = {
          preset: selectedPreset,
          mode: selectedMode,
          mode: selectedMode,
          method: selectedMethod,
          difficulty: selectedDifficulty // Added difficulty
        };

        // Include file contents if custom file is selected
        if (selectedPreset === "custom" && customFileContent) {
          requestData.content = customFileContent;
          requestData.fileName = customFileName;
        }

        // Progress Bar UI (shows percent to reduce drop-off during generation)
        const progressContainer = document.getElementById('ai-progress-container');
        const progressFill = document.getElementById('ai-progress-fill');
        const progressText = document.getElementById('ai-progress-text');

        if (progressContainer) {
          progressContainer.style.display = 'block';
          progressFill.style.width = '0%';
          progressText.style.display = 'block';
          progressText.textContent = 'AI가 문제를 분석하고 있습니다... (0%)';

          // FAKE PROGRESS SIMULATION
          let fakeProgress = 0;
          const setProgress = (pct, label) => {
            const clamped = Math.min(100, Math.max(0, pct));
            progressFill.style.width = `${clamped}%`;
            progressText.textContent = `${label} (${Math.round(clamped)}%)`;
            statusEl.textContent = `${label} (${Math.round(clamped)}%)`;
          };

          const progressInterval = setInterval(() => {
            fakeProgress += Math.random() * 5;
            if (fakeProgress > 95) fakeProgress = 95;
            setProgress(fakeProgress, "AI가 문제를 생성하고 있습니다...");
          }, 300);

          try {
            const response = await fetch("/api/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestData)
            });

            clearInterval(progressInterval);
            setProgress(100, "완료!");

            const data = await response.json();


            if (data.error) {
      LegacyAlerts.requestError(data.error);
              progressContainer.style.display = 'none'; // Hide on error
              return;
            }

            // Success
            await loadSession();
            modal.style.display = "none";
            progressContainer.style.display = 'none'; // Reset logic

          } catch (err) {
            clearInterval(progressInterval);
            progressContainer.style.display = 'none';
      LegacyAlerts.requestFailed(err.message);
          }
          return; // EXIT FUNCTION HERE TO AVOID DOUBLE FETCH (original code had fetch below)
        }

        // Fallback if no progress bar (legacy code path)
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

          // Session reload (without reload)
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

  // Close when clicking outside the modal
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
      }
    });
  }
}

// Dynamic script load response + session auto load
async function loadSession() {
  try {
    const response = await fetch('session.json?t=' + Date.now());
    if (!response.ok) throw new Error('session.json not found');
    const data = await response.json();
    setSession(data);
    console.log('Session loaded:', data.title || 'untitled');
  } catch (e) {
    console.warn('loadSession failed:', e.message);
  }
}

async function initializeApp() {
  // Load session first (session.json already created by server)
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

  // Modal initialization (after session load)
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

  // Automatically close when clicking on an item in an empty list (mobile)
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
  // Attempt to reset browser cache
  if ('caches' in window) {
    caches.keys().then(names => {
      names.forEach(name => caches.delete(name));
    });
  }
});

// ============================================================================
// Mode 6: Computational mathematics code writing mode (simple requirements fixed)
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

  // Load basic requirements (hardcode if no files exist)
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

  const aiPrompt = buildMode6ProblemPrompt(baseLines, minorExtras);

  try {
    const response = await callGeminiAPI(aiPrompt, "JSON only. No code fences, no markdown.");

    let problemData;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        problemData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("JSON parse failed");
      }
    } catch (e) {
      throw new Error("Problem generation failed: " + e.message);
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
 * Mode 6 code submission and AI grading
 * - AI grades the student's code
 * - Flexible grading if core logic/flow is correct
 */
async function submitMode6Code() {
  const codeInput = document.getElementById('mode6-code-input');
  const resultDiv = document.getElementById('mode6-result');
  const userCode = codeInput.value.trim();

  if (!userCode) {
LegacyAlerts.requireCode();
    return;
  }

  mode6State.userCode = userCode;
  resultDiv.innerHTML = `<div class="definition-loading">🤖 AI is analyzing and grading the code...</div>`;

  const prompt = `You are a computational math exam grader. Grade flexibly if the core logic is correct.

## Problem description
${mode6State.problem}

## Student code
\`\`\`python
${userCode}
\`\`\`

## Grading criteria (flexible)
1. Core functionality (70% weight):
   - Menu-based while loop exists
   - Arithmetic or core calculation logic exists
   - Data storage structure (list/dict) exists

2. File/visualization (30% weight):
   - CSV save or pandas usage attempt
   - matplotlib graph attempt

3. Passing rules:
   - Score as correct if 70%+ is implemented
   - Core logic structure OK even if variable/output text differs
   - Minor syntax issues are acceptable if logic is correct

## Response format (JSON)
{
  "score": 0-100,
  "passed": true or false (true if score >= 70),
  "feedback": "concise feedback (strengths, gaps)",
  "missing": ["missing feature 1", "missing feature 2"] or []
}`;

  try {
    const response = await callGeminiAPI(prompt, "Respond in JSON only.");

    let result;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("JSON parse failed");
      }
    } catch (e) {
      // Judging from text when JSON parsing fails
      const lowerResponse = (response || "").toLowerCase();
      const passed = lowerResponse.includes('passed": true') ||
        lowerResponse.includes('"passed":true') ||
        lowerResponse.includes("correct") ||
        lowerResponse.includes("pass");
      result = { score: passed ? 80 : 50, passed, feedback: response, missing: [] };
    }

    mode6State.submitted = true;
    mode6State.isCorrect = result.passed;

    // Result UI
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

    // score update
    sessionScore.textContent = `${result.score} / 100`;

    // sound effect
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
 * Mode 6 reset
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
 * Mode 6 hint display
 */
async function showMode6Hint() {
  const resultDiv = document.getElementById('mode6-result');
  resultDiv.innerHTML = `<div class="definition-loading">💡 힌트 생성 중...</div>`;

  const prompt = buildMode6HintPrompt(mode6State.problem);

  try {
    const response = await callGeminiAPI(prompt, "Provide hints only. Do not provide the full answer code.");
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
// Mode 1: C# OOP Fill in the Blanks
// ----------------------------------------------------------------------------
// Parse CSharp_CodeProblem.txt, load the problem, and display it as a blank card UI.
// ============================================================================

// Mode 1 State Management
let mode1State = {
  questions: [],    // Parsed problems { topic, description, code, blanks: [{num, answer}] }
  userAnswers: {},  // user response
  difficulty: 'normal' // easy, normal, hard
};

/**
 * Parse CSharp_코드문제.txt into a problem array.
 */
function parseCSharpQuestions(text) {
  console.log('[Mode1] Parsing start, text length:', text.length);
  const questions = [];

  // ===== Problem N: separated by
  const blocks = text.split(/={5,}\s*문제\s*\d+\s*:\s*/);
  console.log('[Mode1] Split block count:', blocks.length);

  blocks.forEach((block, idx) => {
    if (idx === 0) return; // The first block is the file header

    const lines = block.trim().split('\n');
    let topic = '';
    let description = '';
    let code = '';
    let answers = {};
    let inAnswerKey = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Extract title from first line (line ending with =====)
      if (i === 0 && line.includes('=====')) {
        topic = line.replace(/=+/g, '').trim();
        continue;
      }

      // First line starting with // = Description
      if (line.trim().startsWith('//') && !description && !inAnswerKey) {
        description = line.replace(/^\/\/\s*/, '').trim();
        continue;
      }

      // Start answer key section
      if (line.includes('정답키:')) {
        inAnswerKey = true;
        continue;
      }

      // Answer key parsing
      if (inAnswerKey) {
        const answerMatch = line.match(/^(\d+)=(.+)$/);
        if (answerMatch) {
          answers[answerMatch[1]] = answerMatch[2].trim();
        }
        continue;
      }

      // Collect code (all lines until the start of the answer key)
      code += line + '\n';
    }

    // Check the number of blank spaces
    const blankCount = (code.match(/_____/g) || []).length;
    const answerCount = Object.keys(answers).length;

    console.log(`[Mode1] Question ${idx}: topic="${topic}", blanks=${blankCount}, answers=${answerCount}`);

    if (topic && code.trim() && blankCount > 0 && answerCount > 0) {
      // Create blank information
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

  console.log('[Mode1] Parsing complete, questions:', questions.length);
  return questions;
}

/**
 * Mode 1 rendering (full AI)
 * - Load C# code file
 * - AI generates random blanks
 * - AI grading/answer reveal
 */
async function renderMode1OOPBlanks(difficulty = 'normal') {
  const codeArea = document.getElementById('code-area');
  codeArea.innerHTML = `<div class="definition-loading">🤖 AI가 C# OOP 빈칸 문제를 생성 중...<br><span style="font-size: 12px; color: var(--muted);">잠시만 기다려주세요...</span></div>`;

  // Title update
  sessionTitle.textContent = "C# OOP 빈칸 채우기 (AI)";
  sessionMode.textContent = "OOP 빈칸 채우기";

  try {
    // load file
    const primaryUrl = '/data/3_OOP_Code_Blanks.txt?t=' + Date.now();
    const legacyUrl = '/data/3_OOP_코드빈칸.txt?t=' + Date.now();
    let resp = await fetch(primaryUrl);
    if (!resp.ok) resp = await fetch(legacyUrl);
    if (!resp.ok) throw new Error('Source file not found');
    const rawText = await resp.text();

    // Extract original C# code blocks (without spaces)
    const codeBlocks = extractCSharpCodeBlocks(rawText);

    if (codeBlocks.length === 0) {
      throw new Error('Code block not found');
    }

    // Create blank space in every code block (randomly select X → cover all)
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
      throw new Error('AI blank generation failed');
    }

    // Save state (AI generated data)
    mode1State.questions = aiGeneratedQuestions;
    mode1State.userAnswers = {};
    mode1State.submitted = false;
    mode1State.isAIMode = true; // AI mode flag

    // UI rendering
    let questionsHtml = '';
    let navHtml = '';
    let globalBlankIdx = 0;

    aiGeneratedQuestions.forEach((q, qIdx) => {
      const questionNum = qIdx + 1;

      // Convert code with blank spaces into input fields
      let processedCode = highlightCSharpSyntax(q.codeWithBlanks);
      let blankCounter = 1;

      processedCode = processedCode.replace(/_____/g, () => {
        globalBlankIdx++;
        const blankId = `mode1-${questionNum}-${blankCounter}`;

        navHtml += `<span class="blank-pill pending" id="nav-${blankId}" data-q="${questionNum}" data-blank="${blankCounter}" onclick="document.getElementById('input-${blankId}').focus()">${globalBlankIdx}</span>`;

        // Input field + yellow question mark (hint) + red question mark (what's wrong)
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

    // Update blank list
    const blankList = document.getElementById('blank-list');
    if (blankList) blankList.innerHTML = navHtml;

    // Session count update
    sessionCount.textContent = globalBlankIdx.toString();
    sessionScore.textContent = `0 / ${globalBlankIdx}`;

    // Event listener settings
    setupMode1AIEventListeners();

    // Show control buttons
    updateControlButtonsForMode(1);

  } catch (err) {
    console.error('Mode 1 error:', err);
    codeArea.innerHTML = `<div class="mc-wrong" style="padding: 20px;">❌ 오류: ${err.message}<br><br><button onclick="renderMode1OOPBlanks()" style="padding: 10px 20px; background: var(--accent-2); border: none; border-radius: 6px; cursor: pointer;">🔄 다시 시도</button></div>`;
  }
}

/**
 * Extract C# code blocks (source only) from file content
 */
function extractCSharpCodeBlocks(text) {
  const blocks = [];
  const sections = text.split(/={5,}\s*문제\s*\d+\s*:\s*/);

  sections.forEach((section, idx) => {
    if (idx === 0) return; // skip header

    const lines = section.trim().split('\n');
    let topic = '';
    let code = '';
    let inAnswerKey = false;

    for (const line of lines) {
      // Title extraction
      if (line.includes('=====')) {
        topic = line.replace(/=+/g, '').trim();
        continue;
      }
      // Start answer key section
      if (line.includes('정답키:')) {
        inAnswerKey = true;
        continue;
      }
      // Skip the answer key
      if (inAnswerKey) continue;

      // Remove hint comment (//Blank: XXX format)
      let cleanLine = line.replace(/\s*\/\/\s*빈칸[^:\n]*:[^\n]*/g, '');

      // CODE COLLECTION
      code += cleanLine + '\n';
    }

    // Blank marker _____ is also not removed (AI takes code that already has a blank space and creates a new one)
    // However, the code that already has blank spaces is used as is, but only the comments have been removed.

    if (topic && code.trim()) {
      blocks.push({ topic, code: code.trim() });
    }
  });

  return blocks;
}

/**
 * Request AI-generated blanks for Mode 1
 * @param {string} code - source code
 * @param {string} topic - topic label
 * @param {string} difficulty - difficulty (easy, normal, hard, extreme)
 */
async function generateMode1BlankWithAI(code, topic, difficulty = 'normal') {
  // Difficulty presets: target percent applies to code tokens (exclude comments/variable names)
  const difficultySettings = {
    easy: {
      blankCount: '2-4',
      targetPercent: 0.15,
      focus: 'Only blank keywords, data types, and short literals. Do not blank identifiers or operators.',
      minBlanks: 50,
      description: '쉬움 - 낮은 빈칸 비율 (약 15%)'
    },
    normal: {
      blankCount: '4-7',
      targetPercent: 0.30,
      focus: 'Only blank keywords, data types, and short literals. Never blank identifiers or operators.',
      minBlanks: 70,
      description: '보통 - 중간 빈칸 비율 (약 30%)'
    },
    hard: {
      blankCount: '7-12',
      targetPercent: 0.50,
      focus: 'Only blank keywords, data types, and short literals. Never blank identifiers or operators.',
      minBlanks: 90,
      description: '어려움 - 높은 빈칸 비율 (약 50%)'
    },
    extreme: {
      blankCount: '12-18',
      targetPercent: 0.70,
      focus: 'Only blank keywords, data types, and short literals. Never blank identifiers or operators.',
      minBlanks: 110,
      description: '매우 어려움 - 매우 높은 빈칸 비율 (약 70%)'
    }
  };

  const settings = difficultySettings[difficulty] || difficultySettings.normal;

  // Estimate target blank count based on token count and target percent
  const tokens = (code.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || []).length;
  const percentTarget = Math.round(tokens * settings.targetPercent);
  const maxByCoverage = Math.max(10, Math.floor(tokens * 0.85));
  const desiredBlanks = Math.max(
    settings.minBlanks || 30,
    percentTarget
  );
  const targetBlankCount = Math.max(5, Math.min(desiredBlanks, maxByCoverage));

  const prompt = `Create learning-focused blanks for the following C# code.

## Topic
${topic}
## Difficulty
${settings.description}

## Source code
\`\`\`csharp
${code}
\`\`\`

## Difficulty-specific rules
- Target blank coverage: ~${Math.round(settings.targetPercent * 100)}% of eligible tokens.
- Target blank count: about ${targetBlankCount} (within ±5 is fine). Increase blanks if coverage is below target.
- Eligible blanks: language keywords, data types, and short literals only.
- Do NOT blank operators or any identifiers (class/method/field/variable names).
- If needed, increase blank count beyond ${settings.blankCount} to hit the coverage target.
- ${settings.focus}

## General rules
1) Mark blanks with exactly five underscores _____
2) Number each blank sequentially (1, 2, 3, ...)
3) Place blanks where they maximize learning value

## Response format (return pure JSON, no code fences)
{
  "codeWithBlanks": "code that includes blanks (uses _____)",
  "description": "one-line problem description",
  "blanks": [
    {"num": 1, "hint": "short hint for what belongs here"}
  ]
}`;

  try {
    const response = await callGeminiAPI(prompt, "Respond with JSON only. No code fences.");

    // Extract JSON
    let jsonStr = response;
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    const parsed = JSON.parse(jsonStr);
    return parsed;
  } catch (err) {
    console.error('AI blank generation error:', err);
    // Fallback: return null (no blanks)
    return null;
  }
}

/**
 * Mode 1 AI event listeners (Enter triggers AI grading)
 */
function setupMode1AIEventListeners() {
  const inputs = document.querySelectorAll('.mode1-input');

  inputs.forEach(input => {
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();

        // If already graded
        if (input.classList.contains('correct') || input.classList.contains('revealed')) {
          focusNextMode1Input(input);
          return;
        }

        // Enter again in wrong answer state
        if (input.classList.contains('wrong')) {
          await revealMode1AnswerAI(input);
          focusNextMode1Input(input);
          return;
        }

        // AI scoring
        await checkMode1AnswerAI(input);
      }
    });
  });
}

/**
 * AI grading
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

  // loading indicator
  input.style.borderColor = 'var(--yellow)';

  const prompt = buildMode1GradePrompt({
    code: question.originalCode || question.codeWithBlanks,
    blankNum,
    userAnswer
  });

  try {
    const response = await callGeminiAPI(prompt, "Reply with only CORRECT or WRONG.");
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
 * AI answer reveal
 */
async function revealMode1AnswerAI(input) {
  const qNum = parseInt(input.dataset.q);
  const blankNum = parseInt(input.dataset.blank);

  const question = mode1State.questions[qNum - 1];
  if (!question) return;

  const navPill = document.getElementById(`nav-mode1-${qNum}-${blankNum}`);

  input.value = "정답 로딩중...";
  input.disabled = true;

  const prompt = buildMode1AnswerPrompt({
    code: question.originalCode || question.codeWithBlanks,
    blankNum
  });

  try {
    const response = await callGeminiAPI(prompt, "Return only the answer token. No other text.");
    // Remove unnecessary parts from the response
    let answer = response.trim()
      .replace(/```/g, '')
      .replace(/\n/g, ' ')
      .replace(/\b(answer|blank\s*\d+|correct answer)[:\s-]*/gi, '')
      .replace(/^\s*["`']|["`']\s*$/g, '')
      .trim();

    // Extract only the first word (avoid too long responses)
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
 * Hint (yellow question mark)
 */
async function explainMode1BlankAI(questionNum, blankNum) {
  const question = mode1State.questions[questionNum - 1];
  if (!question) return;

  openAIPanel();
  explanationArea.innerHTML = `<div class="explanation-loading">💡 힌트 생성 중...</div>`;

  const prompt = buildMode1HintPrompt({
    code: question.originalCode || question.codeWithBlanks,
    blankNum
  });

  try {
    const response = await callGeminiAPI(prompt, "Give a hint only and never reveal the exact answer.");
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
 * Why wrong? (red question mark)
 */
async function explainMode1WhyWrong(questionNum, blankNum) {
  const question = mode1State.questions[questionNum - 1];
  if (!question) return;

  const input = document.getElementById(`input-mode1-${questionNum}-${blankNum}`);
  const userAnswer = input?.value || '';

  openAIPanel();
  explanationArea.innerHTML = `<div class="explanation-loading">❓ 분석 중...</div>`;

  const prompt = buildMode1WhyWrongPrompt({
    code: question.originalCode || question.codeWithBlanks,
    blankNum,
    userAnswer
  });

  try {
    const response = await callGeminiAPI(prompt, "Explain briefly why it is wrong and what should be there.");
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
 * C# syntax highlighting
 */
function highlightCSharpSyntax(code) {
  // Keyword Highlighting
  const keywords = ['namespace', 'class', 'interface', 'public', 'private', 'protected', 'static', 'void', 'int', 'string', 'double', 'bool', 'new', 'return', 'if', 'else', 'for', 'foreach', 'while', 'try', 'catch', 'finally', 'throw', 'using', 'lock', 'object', 'in'];

  let result = code;

  // String highlighting (processed first)
  result = result.replace(/"([^"\\]|\\.)*"/g, '<span style="color: #ce9178;">"$&"</span>');
  result = result.replace(/<span style="color: #ce9178;">"("([^"\\]|\\.)*")"/g, '<span style="color: #ce9178;">$1');

  // Comment highlighting
  result = result.replace(/(\/\/[^\n]*)/g, '<span style="color: #6a9955;">$1</span>');
  result = result.replace(/(\/\*[\s\S]*?\*\/)/g, '<span style="color: #6a9955;">$1</span>');

  // Keyword Highlighting
  keywords.forEach(kw => {
    const regex = new RegExp(`\\b(${kw})\\b`, 'g');
    result = result.replace(regex, '<span style="color: #569cd6;">$1</span>');
  });

  // Type highlighting
  const types = ['Console', 'Thread', 'Exception', 'DivideByZeroException', 'ArgumentException', 'ThreadStart'];
  types.forEach(type => {
    const regex = new RegExp(`\\b(${type})\\b`, 'g');
    result = result.replace(regex, '<span style="color: #4ec9b0;">$1</span>');
  });

  // Number highlighting
  result = result.replace(/\b(\d+)\b/g, '<span style="color: #b5cea8;">$1</span>');

  return result;
}

/**
 * Mode 1 event listeners
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
 * Mode 1 single blank check (AI-first, fallback to local)
 */
async function checkMode1Single(input, showAnswer = false) {
  const qNum = input.dataset.q;
  const blankNum = input.dataset.blank;
  const correctAnswer = input.dataset.answer;
  const userAnswer = input.value.trim();

  if (!userAnswer && !showAnswer) return;

  const navPill = document.getElementById(`nav-mode1-${qNum}-${blankNum}`);

  // Skip if already graded
  if (input.classList.contains('correct') || input.classList.contains('revealed')) {
    return;
  }

  // Reveal answer if requested
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

  // Local compare (case/whitespace-insensitive, ignore surrounding quotes)
  const isCorrect = normalizeAnswerText(userAnswer) === normalizeAnswerText(correctAnswer);

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
 * Mode 1 score update
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
 * Mode 1 grade all blanks
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
 * Mode 1 AI hint for a blank
 */
async function explainMode1Blank(questionNum, blankNum) {
  const question = mode1State.questions.find((q, idx) => idx + 1 === questionNum);
  if (!question) return;

  const blank = question.blanks.find(b => b.num === blankNum);
  const answer = blank ? blank.answer : '';

  openAIPanel();
  explanationArea.innerHTML = `<div class="explanation-loading">🤔 Analyzing blank [${blankNum}]...</div>`;

  // Extract nearby context lines for the selected blank
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

  // Three-line window around the blank
  const startLine = Math.max(0, blankLineIdx - 2);
  const endLine = Math.min(codeLines.length, blankLineIdx + 3);
  const contextCode = codeLines.slice(startLine, endLine).join('\n');

  const prompt = `In the C# code, give a concise hint for blank [${blankNum}].
Do NOT reveal the exact answer—only provide a short hint and explanation.

## Topic
${question.topic}

## Code context (blank shown as _____)
\`\`\`csharp
${contextCode}
\`\`\`

## Response format
1. What belongs here? (1 line)
2. Key C# concept (1-2 lines)

Share only hints—never the exact answer.`;

  try {
    const response = await callGeminiAPI(prompt, "Act as a concise C# tutor. Give hints only and never reveal the exact answer.");
    explanationArea.innerHTML = `
      <div class="explanation-content">
        <strong style="color: var(--yellow);">💡 Hint for blank [${blankNum}]</strong>
        <hr style="border: none; border-top: 1px solid var(--border); margin: 12px 0;">
        ${formatMarkdown(response)}
      </div>`;
  } catch (err) {
    explanationArea.innerHTML = `<div class="explanation-content" style="color: var(--red);">❌ Error: ${err.message}</div>`;
  }
}

/**
 * Mode 1 AI grading with code context
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

  // Skip if already graded
  if (input.classList.contains('correct') || input.classList.contains('revealed')) {
    return;
  }

  // When requesting to display the correct answer
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

  const prompt = buildMode1GradePrompt({
    code: question.code.split('\n').slice(0, 30).join('\n'),
    blankNum,
    userAnswer,
    storedAnswer
  });

  try {
    const response = await callGeminiAPI(prompt, "Respond with CORRECT or WRONG only.");
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
    // Fallback to local scoring when AI fails
    checkMode1SingleLocal(input, showAnswer);
  }
}

/**
 * Mode 1 local grading fallback
 */
function checkMode1SingleLocal(input, showAnswer = false) {
  const qNum = input.dataset.q;
  const blankNum = input.dataset.blank;
  const correctAnswer = input.dataset.answer;
  const userAnswer = input.value.trim();

  if (!userAnswer && !showAnswer) return;

  const navPill = document.getElementById(`nav-mode1-${qNum}-${blankNum}`);
  const isCorrect = normalizeAnswerText(userAnswer) === normalizeAnswerText(correctAnswer);

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

// Expose functions needed by inline event handlers
Object.assign(window, {
  explainMode1BlankAI,
  explainMode1WhyWrong,
  explainWhyWrong,
  renderMode1OOPBlanks,
  renderMode6CodeWriting,
  resetMode6,
  showMode6Hint,
  submitMode6Code,
});
