/**
 * Keyboard Shortcuts Module
 */

import { $, $$ } from '../core/utils.js';
import { togglePanel, closePanel } from '../core/ui.js';
import { AppState } from '../core/state.js';

export const KeyboardShortcuts = {
    enabled: true,

    init() {
        document.addEventListener('keydown', (e) => {
            if (!this.enabled) return;

            // Skip if in input/textarea
            const inInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);

            // Ctrl+Enter - check all (works even in input)
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('btn-check')?.click();
                return;
            }

            // Ctrl+L - toggle AI panel (works even in input)
            if (e.ctrlKey && e.key.toLowerCase() === 'l') {
                e.preventDefault();
                togglePanel('ai-panel');
                return;
            }

            // Skip other shortcuts if in input
            if (inInput) return;

            switch (e.key.toLowerCase()) {
                case 'n':
                    e.preventDefault();
                    this.focusNextUnanswered();
                    break;
                case 'arrowup':
                    e.preventDefault();
                    this.navigateQuestion(-1);
                    break;
                case 'arrowdown':
                    e.preventDefault();
                    this.navigateQuestion(1);
                    break;
                case 'a':
                    e.preventDefault();
                    togglePanel('ai-panel');
                    break;
                case 's':
                    e.preventDefault();
                    document.getElementById('btn-shuffle')?.click();
                    break;
                case 'c':
                    e.preventDefault();
                    document.getElementById('btn-check')?.click();
                    break;
                case 'v':
                    e.preventDefault();
                    document.getElementById('btn-reveal')?.click();
                    break;
                case 'r':
                    e.preventDefault();
                    document.getElementById('btn-reset')?.click();
                    break;
                case 'escape':
                    document.activeElement?.blur();
                    closePanel('ai-panel');
                    break;
                case '?':
                    e.preventDefault();
                    this.showHelp();
                    break;
            }
        });
    },

    focusNextUnanswered() {
        const inputs = [...$$('input.blank, input.mode1-input, input.blank-card-input, textarea.challenge-input')];
        const unanswered = inputs.find(inp =>
            !inp.classList.contains('correct') &&
            !inp.classList.contains('revealed') &&
            !inp.value.trim()
        );
        if (unanswered) {
            unanswered.focus();
            unanswered.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    },

    navigateQuestion(direction) {
        const inputs = [...$$('input.blank, input.mode1-input, input.blank-card-input')];
        const currentIdx = inputs.indexOf(document.activeElement);
        const nextIdx = currentIdx + direction;

        if (nextIdx >= 0 && nextIdx < inputs.length) {
            inputs[nextIdx].focus();
            inputs[nextIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    },

    showHelp() {
        // Remove existing modal if any
        document.querySelector('.shortcuts-modal')?.remove();

        const modal = document.createElement('div');
        modal.className = 'shortcuts-modal modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
      <div class="shortcuts-content modal-content">
        <h3>⌨️ 키보드 단축키</h3>
        <div class="shortcut-list">
          <div><kbd>N</kbd> 다음 미답 문제로 이동</div>
          <div><kbd>↑</kbd><kbd>↓</kbd> 이전/다음 문제</div>
          <div><kbd>A</kbd> 또는 <kbd>Ctrl+L</kbd> AI 패널 토글</div>
          <div><kbd>S</kbd> 순서 섞기</div>
          <div><kbd>C</kbd> 또는 <kbd>Ctrl+Enter</kbd> 전체 채점</div>
          <div><kbd>V</kbd> 정답 보기</div>
          <div><kbd>R</kbd> 리셋</div>
          <div><kbd>Esc</kbd> 입력 필드 탈출 / 패널 닫기</div>
          <div><kbd>?</kbd> 이 도움말</div>
        </div>
        <button onclick="this.closest('.shortcuts-modal').remove()">닫기</button>
      </div>
    `;

        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }
};
