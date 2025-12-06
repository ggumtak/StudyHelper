/**
 * Common UI Operations Module
 * Shared UI functions used across modes
 */

import { $, $$ } from './utils.js';
import { AppState } from './state.js';

// ========== SCORE DISPLAY ==========
export function updateScoreDisplay(correct, total) {
    const scoreEl = $('#session-score');
    const progressEl = $('#session-progress span');
    const countEl = $('#session-count');

    if (scoreEl) scoreEl.textContent = `${correct} / ${total}`;
    if (countEl) countEl.textContent = total;
    if (progressEl) {
        const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
        progressEl.style.width = `${pct}%`;
    }
}

// ========== NAV RENDERING ==========
/**
 * Generic nav pill renderer for all modes
 * @param {Object} options
 * @param {string} options.containerId - Nav container element ID
 * @param {Array} options.items - Array of {key, label, state}
 * @param {Function} options.onClick - Click handler
 * @param {string} options.idPrefix - ID prefix for pills
 */
export function renderNavPills({ containerId, items, onClick, idPrefix = 'nav' }) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = items.map(({ key, label, state }) => {
        const stateClass = state || 'pending';
        const hidden = AppState.hideCompletedNav && (state === 'correct' || state === 'revealed');
        return `
      <span class="nav-pill ${stateClass}" 
            id="${idPrefix}-${key}"
            data-key="${key}"
            ${hidden ? 'style="display:none"' : ''}>
        ${label}
      </span>
    `;
    }).join('');

    // Add click handlers
    container.querySelectorAll('.nav-pill').forEach(pill => {
        pill.addEventListener('click', () => onClick(pill.dataset.key));
    });
}

/**
 * Update a single nav pill state
 */
export function updateNavPill(id, state) {
    const pill = document.getElementById(id);
    if (!pill) return;

    pill.classList.remove('pending', 'correct', 'wrong', 'revealed', 'partial');
    pill.classList.add(state);

    if (AppState.hideCompletedNav && (state === 'correct' || state === 'revealed')) {
        pill.style.display = 'none';
    }
}

// ========== INPUT STATE MANAGEMENT ==========
export function setInputState(input, state) {
    if (!input) return;

    input.classList.remove('pending', 'correct', 'wrong', 'revealed');
    input.classList.add(state);

    const colors = {
        pending: 'var(--border)',
        correct: 'var(--green)',
        wrong: 'var(--red)',
        revealed: 'var(--yellow)'
    };

    input.style.borderColor = colors[state] || colors.pending;
}

// ========== MODAL UTILITIES ==========
export function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'flex';
}

export function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
}

// ========== TOAST NOTIFICATIONS ==========
export function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ========== LOADING INDICATOR ==========
export function showLoading(container, message = '로딩중...') {
    if (typeof container === 'string') {
        container = document.getElementById(container);
    }
    if (!container) return;

    container.innerHTML = `
    <div class="loading-indicator">
      <span class="spinner"></span>
      <span>${message}</span>
    </div>
  `;
}

// ========== COPY TO CLIPBOARD ==========
export async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('복사됨!', 'success', 1500);
        return true;
    } catch (e) {
        showToast('복사 실패', 'error');
        return false;
    }
}

// ========== PANEL TOGGLE ==========
export function togglePanel(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;

    const isOpen = panel.classList.toggle('open');
    document.body.classList.toggle('panel-open', isOpen);
    return isOpen;
}

export function openPanel(panelId) {
    const panel = document.getElementById(panelId);
    if (panel) {
        panel.classList.add('open');
        document.body.classList.add('panel-open');
    }
}

export function closePanel(panelId) {
    const panel = document.getElementById(panelId);
    if (panel) {
        panel.classList.remove('open');
        document.body.classList.remove('panel-open');
    }
}

// ========== SESSION INFO UPDATE ==========
export function updateSessionInfo({ title, language, mode, count }) {
    const titleEl = $('#session-title');
    const langEl = $('#session-lang');
    const modeEl = $('#session-mode');
    const countEl = $('#session-count');

    if (titleEl && title) titleEl.textContent = title;
    if (langEl && language) langEl.textContent = language;
    if (modeEl && mode !== undefined) modeEl.textContent = `Mode ${mode}`;
    if (countEl && count !== undefined) countEl.textContent = count;
}

// ========== FOCUS MANAGEMENT ==========
export function focusNextInput(currentInput, inputs) {
    if (!currentInput || !inputs.length) return;

    const currentIdx = inputs.indexOf(currentInput);
    if (currentIdx === -1) return;

    // Find next unanswered input
    for (let i = currentIdx + 1; i < inputs.length; i++) {
        if (!inputs[i].classList.contains('correct') &&
            !inputs[i].classList.contains('revealed')) {
            inputs[i].focus();
            inputs[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
    }

    // Wrap around
    for (let i = 0; i < currentIdx; i++) {
        if (!inputs[i].classList.contains('correct') &&
            !inputs[i].classList.contains('revealed')) {
            inputs[i].focus();
            inputs[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
    }
}
