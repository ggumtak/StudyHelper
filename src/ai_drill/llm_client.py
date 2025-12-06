# ai_drill/llm_client.py
"""
Lightweight Gemini client with lazy SDK loading so offline/local-only
features can run without google-generativeai installed.
"""

from __future__ import annotations

import os
from typing import Any
from pathlib import Path

from .prompt_templates import (
    COMMON_RULES,
    MODE_1_PROMPT,
    MODE_2_PROMPT,
    MODE_3_PROMPT,
    MODE_4_PROMPT,
)

DEFAULT_MODEL = "gemini-2.5-flash"


def _scrub_system_prompt(raw: str) -> str:
    if not raw:
        return ""
    lines = []
    for line in raw.splitlines():
        lower = line.lower()
        has_html = "<" in line or "html" in lower
        is_canvas_html = "canvas" in lower and (has_html or "html" in lower)
        if has_html or is_canvas_html:
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def _load_base_prompt() -> str:
    """
    Load the shared Ailey & Bailey system prompt, skipping HTML/canvas-specific lines.
    """
    root_dir = Path(__file__).resolve().parents[1]
    candidates = [
        root_dir / "data" / "gemini_system_prompt.txt",
        root_dir / "src" / "web_app" / "data" / "gemini_system_prompt.txt",
    ]
    for path in candidates:
        if not path.exists():
            continue
        try:
            raw = path.read_text(encoding="utf-8")
            cleaned = _scrub_system_prompt(raw)
            if cleaned:
                return cleaned
        except OSError:
            continue
    return ""


class LLMClient:
    def __init__(self, api_key: str | None = None, model_name: str | None = None):
        genai = self._load_genai_sdk()

        # Pick up key/model from env when not provided directly.
        if not api_key:
            api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError(
                "API Key not found. Set GEMINI_API_KEY or pass --api_key before using LLM mode."
            )

        model_env = os.getenv("GEMINI_MODEL")
        model_to_use = model_name or model_env or DEFAULT_MODEL

        system_prompt = COMMON_RULES
        base_prompt = _load_base_prompt()
        if base_prompt:
            system_prompt = "\n\n".join([base_prompt, COMMON_RULES]).strip()

        genai.configure(api_key=api_key)
        self.model_name = model_to_use
        self.model = genai.GenerativeModel(
            model_to_use,
            system_instruction=system_prompt
        )
        self._genai: Any = genai

    def generate_drill(self, content: str, mode: int) -> str:
        """
        Build prompt text for the requested mode and fetch completion text.
        """
        prompt_map = {
            1: MODE_1_PROMPT,
            2: MODE_2_PROMPT,
            3: MODE_3_PROMPT,
            4: MODE_4_PROMPT,
        }

        if mode not in prompt_map:
            raise ValueError(f"Invalid mode: {mode}")

        user_message = f"""{prompt_map[mode]}

학습 파일 내용:
------------------------------------------------------------
{content}
------------------------------------------------------------

위 규칙에 따라 [MODE {mode}] 변환을 실행해주세요.
"""

        response = self.model.generate_content(
            contents=user_message,
            generation_config=self._genai.types.GenerationConfig(temperature=0.2),
        )
        return response.text

    @staticmethod
    def _load_genai_sdk():
        """
        Lazy-import google-generativeai to avoid import errors in pure offline mode.
        """
        try:
            import google.generativeai as genai  # type: ignore
            return genai
        except ImportError as exc:
            raise RuntimeError(
                "google-generativeai package is missing. Install it with "
                "`pip install google-generativeai` before using LLM features."
            ) from exc
