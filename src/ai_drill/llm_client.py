# ai_drill/llm_client.py
"""
Lightweight Gemini client with lazy SDK loading so offline/local-only
features can run without google-generativeai installed.
"""

from __future__ import annotations

import os
from typing import Any

from .prompt_templates import (
    COMMON_RULES,
    MODE_1_PROMPT,
    MODE_2_PROMPT,
    MODE_3_PROMPT,
    MODE_4_PROMPT,
)

DEFAULT_MODEL = "gemini-2.5-flash"


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

        genai.configure(api_key=api_key)
        self.model_name = model_to_use
        self.model = genai.GenerativeModel(model_to_use, system_instruction=COMMON_RULES)
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
