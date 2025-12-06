/**
 * Base Mode Class
 * All quiz modes extend this class
 */

import { AppState, LearningStats } from '../core/state.js';
import { updateScoreDisplay, updateNavPill, setInputState, renderNavPills, focusNextInput } from '../core/ui.js';
import { isAnswerCorrect } from '../core/utils.js';
import { callGeminiAPI, loadSystemPrompt } from '../core/api.js';

export class BaseMode {
    constructor(modeNumber) {
        this.modeNumber = modeNumber;
        this.inputs = [];
        this.states = [];
        this.navPrefix = `nav-mode${modeNumber}`;
    }

    /**
     * Initialize the mode with session data
     * Override in subclass
     */
    async init(session) {
        this.session = session;
        AppState.mode = this.modeNumber;
        AppState.modeStates[this.modeNumber] = this;
    }

    /**
     * Render the mode content
     * Override in subclass
     */
    render() {
        throw new Error('render() must be implemented by subclass');
    }

    /**
     * Render navigation pills
     */
    renderNav() {
        const items = this.states.map((state, idx) => ({
            key: idx + 1,
            label: idx + 1,
            state: state.status || 'pending'
        }));

        renderNavPills({
            containerId: 'blank-list',
            items,
            onClick: (key) => this.scrollToItem(key),
            idPrefix: this.navPrefix
        });
    }

    /**
     * Update score display
     */
    updateScore() {
        const correct = this.states.filter(s => s.status === 'correct').length;
        const total = this.states.length;
        updateScoreDisplay(correct, total);
    }

    /**
     * Check a single answer
     * @param {number} index - Item index
     * @param {string} userAnswer - User's answer
     */
    checkAnswer(index, userAnswer) {
        const state = this.states[index];
        if (!state) return false;

        const expected = state.answer || state.correctAnswer;
        const isCorrect = isAnswerCorrect(userAnswer, expected);

        state.status = isCorrect ? 'correct' : 'wrong';
        state.userAnswer = userAnswer;

        LearningStats.recordAnswer(isCorrect);
        this.updateNavItem(index, state.status);
        this.updateScore();

        return isCorrect;
    }

    /**
     * Check all answers
     */
    checkAll() {
        this.inputs.forEach((input, idx) => {
            if (input.value.trim()) {
                this.checkAnswer(idx, input.value.trim());
                setInputState(input, this.states[idx].status);
            }
        });
        this.updateScore();
    }

    /**
     * Reveal answer for an item
     */
    revealAnswer(index) {
        const state = this.states[index];
        const input = this.inputs[index];
        if (!state || !input) return;

        const answer = state.answer || state.correctAnswer;
        input.value = answer;
        state.status = 'revealed';
        state.userAnswer = answer;

        setInputState(input, 'revealed');
        this.updateNavItem(index, 'revealed');
        this.updateScore();
    }

    /**
     * Reveal all answers
     */
    revealAll() {
        this.states.forEach((_, idx) => {
            if (this.states[idx].status !== 'correct') {
                this.revealAnswer(idx);
            }
        });
    }

    /**
     * Reset all inputs
     */
    reset() {
        this.inputs.forEach((input, idx) => {
            input.value = '';
            this.states[idx].status = 'pending';
            this.states[idx].userAnswer = '';
            setInputState(input, 'pending');
            this.updateNavItem(idx, 'pending');
        });
        this.updateScore();
    }

    /**
     * Update a nav item
     */
    updateNavItem(index, status) {
        updateNavPill(`${this.navPrefix}-${index + 1}`, status);
    }

    /**
     * Scroll to an item
     */
    scrollToItem(key) {
        const input = this.inputs[parseInt(key) - 1];
        if (input) {
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            input.focus();
        }
    }

    /**
     * Focus next unanswered input
     */
    focusNext(currentInput) {
        focusNextInput(currentInput, this.inputs);
    }

    /**
     * Handle Enter key on input
     */
    handleEnter(input) {
        const idx = this.inputs.indexOf(input);
        if (idx === -1) return;

        const userAnswer = input.value.trim();
        if (!userAnswer) return;

        const isCorrect = this.checkAnswer(idx, userAnswer);
        setInputState(input, isCorrect ? 'correct' : 'wrong');

        // Auto-advance on correct
        if (isCorrect) {
            this.focusNext(input);
        }
    }

    /**
     * Setup input event listeners
     */
    setupInputListeners() {
        this.inputs.forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.handleEnter(input);
                }
            });
        });
    }

    /**
     * Get AI explanation for a wrong answer
     */
    async explainWrong(index) {
        const state = this.states[index];
        if (!state) return '';

        const systemPrompt = await loadSystemPrompt();
        const prompt = `왜 틀렸는지 간단히 설명해줘.
학생 답: "${state.userAnswer}"
정답: "${state.answer || state.correctAnswer}"`;

        return callGeminiAPI(prompt, systemPrompt);
    }

    /**
     * Get AI hint for an item
     */
    async getHint(index) {
        const state = this.states[index];
        if (!state) return '';

        const systemPrompt = await loadSystemPrompt();
        const prompt = `힌트를 간략히 제공해줘. 정답은 알려주지 마.
문제: ${state.question || state.code || ''}`;

        return callGeminiAPI(prompt, systemPrompt);
    }
}
