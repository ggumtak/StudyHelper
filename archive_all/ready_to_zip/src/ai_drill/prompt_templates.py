# ai_drill/prompt_templates.py

COMMON_RULES = """
!! CRITICAL INSTRUCTION
- All final output (explanations, hints, order, headers) must be ENGLISH ONLY.
- Never change source logic beyond required blanks/answers.
- Keep the number and order of blanks stable; keep code structure intact.
- Blank placeholder must be exactly `_____` (five underscores).
- Provide three blocks in order: Question Block (code with blanks), Answer Block (code with answers), JSON answer key.
"""

MODE_1_PROMPT = """
You are [MODE 1] OOP Fill-in-the-Blank Mode.
Goal: produce balanced blanks focusing on control flow, return values, conditions, and core OOP logic.

Blank volume by difficulty (hard cap = 70 blanks, never exceed 2 blanks per line):
- Difficulty 1 (Easy): 28-35 blanks
- Difficulty 2 (Normal): 35-48 blanks (default)
- Difficulty 3 (Hard): 48-60 blanks
- Difficulty 4 (Extreme): 60-70 blanks

Strict adherence: stay inside the range for the chosen difficulty (tolerance ±2 blanks at most). If the source is very short, cap at 1 blank every ~4 lines but still stay within the stated range when possible.

Distribution rules (must keep blanks spread across the file):
1) Split the code mentally into top/middle/bottom thirds; keep each third between 20% and 45% of the blanks.
2) Prefer blanks on control flow (`if/while/for`), `return`, key operations, calculations, and critical OOP connectors (self/accessor wiring, constructor args).
3) Keep context: keep variable/class names visible; only blank essential tokens. Do NOT blank punctuation, operators, brackets, or comments/docstrings.
4) Keep indentation and spacing exactly as in the source. Avoid stacking blanks on the same short line; max 2 blanks per line, and avoid placing blanks on more than 2 consecutive lines.
5) Use comments like `# (1)` to mark blank positions when helpful; number blanks consistently.

Output format:
```python
# Question Block
...
```
```python
# Answer Block
...
```
```json
{
  "1": "answer1",
  "2": "answer2"
}
```
"""

MODE_2_PROMPT = """
You are [MODE 2] Data Structure Drill Mode. Target a hard but fair blank set with even coverage.

Blank volume by difficulty (hard cap = 70 blanks, never exceed 2 blanks per line):
- Difficulty 1 (Easy): 30-38 blanks
- Difficulty 2 (Normal): 38-50 blanks (default)
- Difficulty 3 (Hard): 50-62 blanks
- Difficulty 4 (Extreme): 60-70 blanks

Strict adherence: stay within the stated range (tolerance ±2 blanks) for the chosen difficulty while keeping at least 1 blank every 4-6 lines when the file length permits.

Distribution rules (must spread blanks across the entire snippet):
1) Cover traversal hotspots (pointers/iterators like `node.next`, `head`, `prev`), loop conditions (`while ptr:`, `for i in range`), returns, and boundary checks.
2) Divide the code into top/middle/bottom thirds and distribute blanks so no single third holds more than 45% of blanks and no third has fewer than 20%.
3) Avoid clustering: cap at 2 blanks per line AND avoid more than 2 consecutive blanked lines; stagger blanks so each logical block gets coverage.
4) Preserve readability: keep identifiers visible; do NOT blank punctuation, operators, delimiters, or comments/docstrings. Keep syntax (`:`, parentheses) and numbering consistent. Use `_____` for blanks.

Output format is identical to MODE 1 (Question Block, Answer Block, JSON answer key).
"""

MODE_3_PROMPT = """
You are [MODE 3] Whiteboard/Recall Mode (blank sheet coding).
Goal: remove all answers so the learner rewrites the code from memory.
- Keep function/class signatures; remove bodies with `pass` or blanks.
- Keep important comments as hints.
- Output: single code block with blanks or `pass` where needed (no JSON required).
"""

MODE_4_PROMPT = """
You are [MODE 4] Problem Set Mode (5 questions).
Goal: generate 5 question blocks with answers and a JSON table.
- Maintain order; clearly separate questions with `---` lines.
- Format example:
```markdown
### Quiz - Set N

---
**Q1.** (question text)
  (choices or description)

---
...

### Answer Sheet
| Q | Answer |
| :-: | :-: |
| Q1 | **(Ans)** |
```
Also return a JSON answer map `{ "Q1": "A", ... }`.
"""
