/**
 * AI Chat Panel Module
 */

import { $, formatMarkdown } from '../core/utils.js';
import { callGeminiAPI, loadSystemPrompt } from '../core/api.js';
import { openPanel } from '../core/ui.js';
import { AppState } from '../core/state.js';

// Chat history for context
let chatHistory = [];

/**
 * Initialize chat panel event listeners
 */
export function initChatPanel() {
    const chatInput = $('#chat-input');
    const btnSend = $('#btn-send-chat');
    const btnNew = $('#btn-ai-new');
    const btnHistory = $('#btn-ai-history');
    const btnClose = $('#btn-close-panel');

    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    if (btnSend) btnSend.addEventListener('click', sendMessage);
    if (btnNew) btnNew.addEventListener('click', startNewSession);
    if (btnHistory) btnHistory.addEventListener('click', toggleHistory);
    if (btnClose) {
        btnClose.addEventListener('click', () => {
            const panel = $('#ai-panel');
            if (panel) {
                panel.classList.remove('open');
                document.body.classList.remove('panel-open');
            }
        });
    }
}

/**
 * Send a chat message
 */
async function sendMessage() {
    const chatInput = $('#chat-input');
    const message = chatInput?.value.trim();
    if (!message) return;

    addMessage(message, 'user');
    chatInput.value = '';

    // Add loading indicator
    const loadingId = Date.now();
    addMessage('🤔 생각 중...', 'assistant', loadingId);

    try {
        // Get context from current mode
        const context = getContextForMessage(message);
        const systemPrompt = await loadSystemPrompt();

        // Add context to message if found
        const fullPrompt = context ? `${context}\n\n사용자 질문: ${message}` : message;

        // Update chat history
        chatHistory.push({ role: 'user', parts: [{ text: fullPrompt }] });

        const response = await callGeminiAPI(fullPrompt, systemPrompt, chatHistory.slice(-10));

        // Update history with response
        chatHistory.push({ role: 'model', parts: [{ text: response }] });

        // Replace loading with response
        replaceMessage(loadingId, response);
    } catch (err) {
        replaceMessage(loadingId, `❌ 오류: ${err.message}`);
    }
}

/**
 * Get context for the message based on blank number mentions
 */
function getContextForMessage(message) {
    // Check if user is asking about a specific blank number
    const numMatch = message.match(/(\d+)\s*번/);
    if (!numMatch) return '';

    const blankNum = parseInt(numMatch[1]);

    // Try to find the relevant blank/question
    const selectors = [
        `input[data-global-idx="${blankNum}"]`,
        `input.mode1-input[data-blank="${blankNum}"]`,
        `input.blank-card-input[data-key="${blankNum}"]`,
        `.blank-card[data-num="${blankNum}"]`
    ];

    for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) {
            // Get surrounding code context
            const card = el.closest('.blank-card, .mode1-question, .question-card');
            if (card) {
                const codeEl = card.querySelector('pre, code, .code-content');
                if (codeEl) {
                    return `[빈칸 ${blankNum}번 관련 코드]\n\`\`\`\n${codeEl.textContent.substring(0, 1000)}\n\`\`\``;
                }
            }

            // Get answer if available
            const answer = el.dataset?.answer;
            if (answer) {
                return `[빈칸 ${blankNum}번 정답: ${answer}]`;
            }
        }
    }

    return '';
}

/**
 * Add a message to the chat
 */
function addMessage(text, role, id = null) {
    const chatMessages = $('#chat-messages');
    if (!chatMessages) return;

    const div = document.createElement('div');
    div.className = `chat-message ${role}`;
    if (id) div.id = `msg-${id}`;
    div.innerHTML = formatMarkdown(text);

    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Replace a message by ID
 */
function replaceMessage(id, text) {
    const msg = $(`#msg-${id}`);
    if (msg) {
        msg.innerHTML = formatMarkdown(text);
    }
}

/**
 * Start a new chat session
 */
function startNewSession() {
    chatHistory = [];
    const chatMessages = $('#chat-messages');
    if (chatMessages) {
        chatMessages.innerHTML = '<div class="chat-message assistant">안녕! 무엇이든 물어봐 👋</div>';
    }
}

/**
 * Toggle chat history view
 */
function toggleHistory() {
    // Simple implementation - could be enhanced
    const count = chatHistory.length;
    alert(`현재 대화 ${Math.floor(count / 2)}개의 메시지가 있습니다.`);
}

/**
 * Pre-fill chat input and open panel
 * @param {string} message - Message to pre-fill
 */
export function fillChatAndOpen(message) {
    const chatInput = $('#chat-input');
    if (chatInput) {
        chatInput.value = message;
        chatInput.focus();
    }
    openPanel('ai-panel');
}

/**
 * Open chat with hint request
 */
export function requestHint(blankNum) {
    fillChatAndOpen(`${blankNum}번 힌트 좀 줘`);
}

/**
 * Open chat with "why wrong" request
 */
export function requestWhyWrong(blankNum) {
    fillChatAndOpen(`${blankNum}번 왜 틀렸어?`);
}
