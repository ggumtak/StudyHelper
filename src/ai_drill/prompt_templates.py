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
Goal: produce 40-60 blanks focusing on control flow, return values, conditions, and core OOP logic.

Rules:
1) Prefer blanks on control flow (`if/while/for`), `return`, key operations, and calculations.
2) Keep context: keep variable/class names visible; only blank essential tokens.
3) Keep indentation and spacing exactly as in the source.
4) Use comments like `# (1)` to mark blank positions when helpful.
5) Output format:
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
You are [MODE 2] Data Structure Drill Mode. Produce about 45-50 blanks (Hard).
Focus on pointers/iterators (`node.next`, `head`), loop conditions (`while ptr:`), returns, and boundary checks.
Keep syntax (`:`, parentheses) and numbering consistent. Use `_____` for blanks.
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
