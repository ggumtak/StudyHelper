/**
 * AI Chat Panel Module
 */

import { $, formatMarkdown } from "../core/utils.js";
import { callGeminiAPI, loadSystemPrompt } from "../core/api.js";
import { openPanel } from "../core/ui.js";
import { AppState } from "../core/state.js";

// Chat history for context
let chatHistory = [];

export function initChatPanel() {
  const chatInput = $("#chat-input");
  const btnSend = $("#btn-send-chat");
  const btnNew = $("#btn-ai-new");
  const btnHistory = $("#btn-ai-history");
  const btnClose = $("#btn-close-panel");

  if (chatInput) {
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  if (btnSend) btnSend.addEventListener("click", sendMessage);
  if (btnNew) btnNew.addEventListener("click", startNewSession);
  if (btnHistory) btnHistory.addEventListener("click", toggleHistory);
  if (btnClose) {
    btnClose.addEventListener("click", () => {
      const panel = $("#ai-panel");
      if (panel) {
        panel.classList.remove("open");
        document.body.classList.remove("panel-open");
      }
    });
  }
}

async function sendMessage() {
  const chatInput = $("#chat-input");
  const message = chatInput?.value.trim();
  if (!message) return;

  addMessage(message, "user");
  chatInput.value = "";

  const loadingId = Date.now();
  addMessage("Thinking...", "assistant", loadingId);

  try {
    const context = getContextForMessage(message);
    const systemPrompt = await loadSystemPrompt();
    const fullPrompt = context ? `${context}\n\nUser question: ${message}` : message;

    chatHistory.push({ role: "user", parts: [{ text: fullPrompt }] });
    const response = await callGeminiAPI(fullPrompt, systemPrompt, chatHistory.slice(-10));

    chatHistory.push({ role: "model", parts: [{ text: response }] });
    replaceMessage(loadingId, response);
  } catch (err) {
    replaceMessage(loadingId, `Error: ${err.message}`);
  }
}

function getContextForMessage(message) {
  const numMatch = message.match(/blank\s*(\d+)|(\d+)/i);
  if (!numMatch) return "";

  const blankNum = parseInt(numMatch[1] || numMatch[2]);

  const selectors = [
    `input[data-global-idx="${blankNum}"]`,
    `input.mode1-input[data-blank="${blankNum}"]`,
    `input.blank-card-input[data-key="${blankNum}"]`,
    `.blank-card[data-num="${blankNum}"]`,
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) {
      const card = el.closest(".blank-card, .mode1-question, .question-card");
      if (card) {
        const codeEl = card.querySelector("pre, code, .code-content");
        if (codeEl) {
          return `[Blank ${blankNum} code]\n
${codeEl.textContent.substring(0, 1000)}`;
        }
      }

      const answer = el.dataset?.answer;
      if (answer) {
        return `[Blank ${blankNum} answer: ${answer}]`;
      }
    }
  }

  return "";
}

function addMessage(text, role, id = null) {
  const chatMessages = $("#chat-messages");
  if (!chatMessages) return;

  const div = document.createElement("div");
  div.className = `chat-message ${role}`;
  if (id) div.id = `msg-${id}`;
  div.innerHTML = formatMarkdown(text);

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function replaceMessage(id, text) {
  const msg = $(`#msg-${id}`);
  if (msg) {
    msg.innerHTML = formatMarkdown(text);
  }
}

function startNewSession() {
  chatHistory = [];
  const chatMessages = $("#chat-messages");
  if (chatMessages) {
    chatMessages.innerHTML = '<div class="chat-message assistant">Hello! Ask me anything. 👋</div>';
  }
}

function toggleHistory() {
  const count = chatHistory.length;
  alert(`Current chat contains ${Math.floor(count / 2)} exchanges.`);
}

export function fillChatAndOpen(message) {
  const chatInput = $("#chat-input");
  if (chatInput) {
    chatInput.value = message;
    chatInput.focus();
  }
  openPanel("ai-panel");
}

export function requestHint(blankNum) {
  fillChatAndOpen(`Give me a hint for blank ${blankNum}`);
}

export function requestWhyWrong(blankNum) {
  fillChatAndOpen(`Why is blank ${blankNum} wrong?`);
}
