/**
 * Gemini API Module
 * Centralized API calls with rate limiting and retry logic
 */

// Rate limiter state (client-side throttle to reduce spam to server proxy)
let lastApiCall = 0;
const MIN_API_INTERVAL = 500;

// System prompt cache (kept client-side; API key is NOT stored here)
let systemPromptCache = null;

/**
 * Load system prompt (cached)
 */
export async function loadSystemPrompt() {
  if (systemPromptCache) return systemPromptCache;

  try {
    const response = await fetch("/data/gemini_system_prompt.txt");
    if (response.ok) {
      systemPromptCache = await response.text();
    }
  } catch (e) {
    console.warn("Failed to load system prompt:", e);
  }

  return systemPromptCache || "";
}

/**
 * Call Gemini API with rate limiting
 * @param {string} prompt - User prompt
 * @param {string} systemInstruction - Optional system instruction
 * @param {Array} chatHistory - Optional chat history
 * @returns {Promise<string>} API response text
 */
export async function callGeminiAPI(prompt, systemInstruction = "", chatHistory = null) {
  const now = Date.now();
  const timeSinceLastCall = now - lastApiCall;
  if (timeSinceLastCall < MIN_API_INTERVAL) {
    await new Promise((r) => setTimeout(r, MIN_API_INTERVAL - timeSinceLastCall));
  }
  lastApiCall = Date.now();

  const requestBody = {
    prompt,
    systemInstruction: systemInstruction || "",
    chatHistory: Array.isArray(chatHistory) ? chatHistory : [],
  };

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch("/api/gemini-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || `API Error: ${response.status}`);
      }

      const data = await response.json();
      return data.text || "";
    } catch (err) {
      if (attempt === maxRetries) throw err;
      console.warn(`API retry ${attempt + 1}/${maxRetries}:`, err.message);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

/**
 * Simple grading prompt - returns CORRECT or WRONG
 */
export async function gradeAnswer(question, userAnswer, correctAnswer) {
  const prompt = `Grading request:\nQuestion: ${question}\nAnswer: ${correctAnswer}\nStudent: ${userAnswer}\n\nIf correct, respond CORRECT. If wrong, respond WRONG. Only one word.`;
  const response = await callGeminiAPI(prompt);
  return response.trim().toUpperCase().includes("CORRECT");
}

/**
 * Get hint for a blank
 */
export async function getHint(codeContext, blankNum) {
  const systemPrompt = await loadSystemPrompt();
  const prompt = `Give a concise hint for blank #${blankNum}. Do not reveal the answer.\n\nCode:\n\n${codeContext}`;
  return callGeminiAPI(prompt, systemPrompt);
}

/**
 * Explain why answer is wrong
 */
export async function explainWrong(codeContext, blankNum, userAnswer, correctAnswer) {
  const systemPrompt = await loadSystemPrompt();
  const prompt = `Explain wrong answer for blank #${blankNum}:\nStudent answer: "${userAnswer}"\nCorrect answer: "${correctAnswer}"\n\nExplain briefly why it is wrong.\n\nCode:\n\n${codeContext}`;
  return callGeminiAPI(prompt, systemPrompt);
}
