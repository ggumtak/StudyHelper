/**
 * Core Utilities Module
 * Shared helper functions used across the application
 */

// ========== DEBOUNCE & THROTTLE ==========
export function debounce(fn, delay = 300) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export function throttle(fn, limit = 500) {
  let inThrottle;
  return (...args) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// ========== RETRY LOGIC ==========
export async function withRetry(fn, maxRetries = 2, delay = 1000) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries) throw err;
      console.warn(`Retry ${i + 1}/${maxRetries}:`, err.message);
      await new Promise((r) => setTimeout(r, delay * (i + 1)));
    }
  }
}

// ========== TEXT UTILITIES ==========
export function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function formatMarkdown(text) {
  return text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

// ========== ANSWER COMPARISON ==========
/**
 * Flexible answer comparison for code blanks
 * - Case sensitive
 * - Normalizes whitespace
 * - Handles quote formatting differences
 */
export function isAnswerCorrect(userAnswer, expected) {
  if (!userAnswer || !expected) return false;

  const normalize = (s) => {
    return s
      .trim()
      .replace(/\s+/g, " ")
      .replace(/['’]/g, "'")
      .replace(/["“”]/g, '"');
  };

  const normUser = normalize(userAnswer);
  const normExpected = normalize(expected);

  if (normUser === normExpected) return true;

  const stripAll = (s) => s.replace(/\s/g, "");
  return stripAll(normUser) === stripAll(normExpected);
}

// ========== DOM UTILITIES ==========
export function $(selector) {
  return document.querySelector(selector);
}

export function $$(selector) {
  return document.querySelectorAll(selector);
}

export function createElement(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "className") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value);
  });
  children.forEach((child) => {
    if (typeof child === "string") el.appendChild(document.createTextNode(child));
    else if (child) el.appendChild(child);
  });
  return el;
}

// ========== STORAGE UTILITIES ==========
export const Storage = {
  get(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* ignore */
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      /* ignore */
    }
  },
};
