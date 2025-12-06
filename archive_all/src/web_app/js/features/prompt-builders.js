// Prompt builder utilities shared across modes

function asList(items = []) {
  return items && items.length ? items.map((item) => `- ${item}`).join("\n") : "";
}

export function buildMode1GradePrompt({ code = "", blankNum = "", userAnswer = "", storedAnswer = "" }) {
  const codeBlock = code
    ? `## Full code\n\`\`\`csharp\n${code}\n\`\`\`\n\n`
    : "";
  const savedAnswerLine = storedAnswer ? `- Saved answer: "${storedAnswer}"\n` : "";

  return `Strictly grade the C# fill-in-the-blank answer.

${codeBlock}## Blank #${blankNum}
${savedAnswerLine}- Student answer: "${userAnswer}"

Grading rules:
1) Ignore whitespace differences.
2) Treat case differences as OK unless they change meaning.
3) Accept equivalent tokens (e.g., "new int[]" vs "new int []").
4) Otherwise respond WRONG.

Respond with a single word: CORRECT or WRONG.`;
}

export function buildMode1AnswerPrompt({ code = "", blankNum = "" }) {
  const codeBlock = code
    ? `## Full code\n\`\`\`csharp\n${code}\n\`\`\`\n\n`
    : "";
  return `Return only the token that correctly fills blank #${blankNum} in the C# code.

${codeBlock}Rules:
- Do not include explanations or punctuation.
- No code fences or markdown.
- Respond with the token/keyword only (e.g., public, try, catch).`;
}

export function buildMode1HintPrompt({ code = "", blankNum = "" }) {
  const codeBlock = code
    ? `## Full code\n\`\`\`csharp\n${code}\n\`\`\`\n\n`
    : "";
  return `Give a concise hint for blank #${blankNum} in the C# code.

${codeBlock}Hint format (do NOT reveal the exact answer):
1) What kind of token belongs here (keyword/type/symbol)?
2) One short reminder of the related C# concept (1-2 lines).`;
}

export function buildMode1WhyWrongPrompt({ code = "", blankNum = "", userAnswer = "" }) {
  const codeBlock = code
    ? `## Full code\n\`\`\`csharp\n${code}\n\`\`\`\n\n`
    : "";
  return `Explain briefly why the student's answer for blank #${blankNum} is incorrect.

${codeBlock}Student answer: "${userAnswer || "-"}"

Instructions:
- Identify the specific mistake.
- State what the correct idea/token should be.
- Keep it to 2-3 short sentences, no code fences.`;
}

export function buildDefinitionGradePrompt({ term = "", correctAnswer = "", userAnswer = "" }) {
  return `You are grading a strict OOP definition question.

Term: "${term}"
Reference answer: "${correctAnswer}"
Student answer: "${userAnswer}"

Grading rules:
- Core technical keywords from the reference must appear.
- The definition must cover all essential components.
- Vague, incomplete, or technically wrong answers are WRONG.

Respond with JSON only (no markdown, no prose):
{"correct": true/false, "reason": "one short sentence"}`;
}

export function buildVocabMeaningPrompt(english = "") {
  return `Provide the accurate Korean meaning for the English word "${english}".

Rules:
1) Do NOT transliterate (no code→코드 style).
2) Give the real meaning in Korean in 1-2 short lines.
3) Be concise and academic.

Respond with JSON only:
{"meaning": "Korean definition"}`;
}

export function buildMode6ProblemPrompt(baseLines = [], minorExtras = []) {
  return `You are a computational math instructor creating a small Python coding exercise.
Follow the base requirements exactly and do NOT introduce a new domain.

Base requirements:
${asList(baseLines)}

Pick only 1-2 tiny extra constraints:
${asList(minorExtras)}

Authoring rules:
- Stick to a console-style menu/calculator flow that matches the requirements above.
- Describe what the student must implement; do NOT write the full solution code.
- Keep the scope small and focused on the listed requirements.

Respond with plain JSON only (no markdown, no code fences):
{
  "problem_title": "Title",
  "problem_description": "2-4 lines that restate the task",
  "requirements": ["Requirement 1", "Requirement 2", "..."],
  "hints": ["Hint 1", "Hint 2"]
}`;
}

export function buildMode6HintPrompt(problem = "") {
  return `Provide key hints for solving this problem:
${problem}

Include:
1) Required imports.
2) The basic code structure (pseudocode level).
3) Pitfalls to avoid.

Do NOT provide the full answer code.`;
}

export function buildDifferencePrompt(correctAnswer = "", userAnswer = "") {
  return `Compare the reference solution and the student's code. List only the concrete differences in 2-3 short sentences.

Reference solution:
${correctAnswer}

Student code:
${userAnswer}

Rules:
- Do not summarize the full flow.
- Point out missing lines or wrong constructs directly.
- Keep it concise and actionable.`;
}
