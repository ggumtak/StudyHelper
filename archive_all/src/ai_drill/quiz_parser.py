# ai_drill/quiz_parser.py
import re
import json

class DrillSession:
    def __init__(self, mode, question_text, answer_text, answer_key=None):
        self.mode = mode
        self.question_text = question_text  # 빈칸 코드 또는 문제 세트
        self.answer_text = answer_text      # 정답 코드 또는 정답표
        self.answer_key = answer_key or {}  # {"1": "code", "Q1": "1"}

def _flatten_answer_key(answer_key) -> dict:
    if not isinstance(answer_key, dict):
        return {}
    if "answer_key" in answer_key and isinstance(answer_key["answer_key"], dict):
        answer_key = answer_key["answer_key"]
    return {str(k): v for k, v in answer_key.items()}

def _extract_answers_from_blanks(question_text: str, answer_text: str) -> dict:
    """
    빈칸 문제에서 정답을 자동 추출하는 폴백 로직.
    question_text에서 #숫자 패턴을 찾고, answer_text에서 해당 위치의 값을 추출.
    """
    answer_key = {}
    
    # 방법 1: answer_text에서 #숫자: 정답 패턴 찾기
    # 예: #1: None, #2: start
    matches = re.findall(r'#(\d+)\s*[:\-=]\s*(.+?)(?:\n|$|,)', answer_text)
    if matches:
        for num, ans in matches:
            answer_key[num] = ans.strip().strip('"\'')
        return answer_key
    
    # 방법 2: question_text에서 _____ 또는 #숫자 패턴 개수 세기
    blank_pattern = r'_____'
    blanks = re.findall(blank_pattern, question_text)
    
    # answer_text에서 줄별로 값 추출 시도
    if blanks and answer_text and answer_text != "Parsing failed. Please check raw output.":
        # 정답 코드에서 빈칸 위치의 실제 값을 찾아보기
        q_lines = question_text.split('\n')
        a_lines = answer_text.split('\n')
        
        blank_num = 1
        for i, qline in enumerate(q_lines):
            if '_____' in qline and i < len(a_lines):
                # 해당 줄에서 _____를 정답으로 대체
                aline = a_lines[i] if i < len(a_lines) else ""
                # 간단한 추출: qline의 _____ 위치에 해당하는 aline의 토큰
                if aline:
                    # _____ 매칭 시도
                    q_parts = qline.split('_____')
                    for j in range(len(q_parts) - 1):
                        # 빈칸 번호 할당
                        answer_key[str(blank_num)] = f"#{blank_num}"  # 임시 플레이스홀더
                        blank_num += 1
    
    return answer_key

def parse_response(response_text: str, mode: int) -> DrillSession:
    """
    LLM 응답을 DrillSession으로 파싱.
    """
    
    # 1) JSON Answer Key 추출
    json_match = re.search(r"```json\s*(\{.*?\})\s*```", response_text, re.DOTALL)
    answer_key = {}
    if json_match:
        try:
            answer_key = json.loads(json_match.group(1))
        except json.JSONDecodeError:
            print("Warning: Failed to parse JSON answer key.")
    
    # 2) 코드 블록 추출 (Question, Answer)
    code_blocks = re.findall(r"```(?:\w+)?\s*(.*?)```", response_text, re.DOTALL)
    
    # JSON 블록 제거
    filtered_blocks = []
    for block in code_blocks:
        block_trim = block.strip()
        if block_trim.startswith("{") and block_trim.endswith("}"):
            try:
                json.loads(block_trim)
                continue
            except json.JSONDecodeError:
                pass
        filtered_blocks.append(block)
    
    question_text = ""
    answer_text = ""

    if mode in [1, 2, 3]:
        if len(filtered_blocks) >= 2:
            question_text = filtered_blocks[0]
            answer_text = filtered_blocks[1]
        elif len(filtered_blocks) == 1:
            # 하나의 블록만 있으면 그것을 question으로 사용
            question_text = filtered_blocks[0]
            answer_text = "정답 블록이 생성되지 않았습니다."
        else:
            question_text = response_text
            answer_text = "Parsing failed. Please check raw output."
        
        # JSON 정답 키가 없으면 폴백으로 추출 시도
        if not answer_key and question_text:
            # 빈칸에서 번호 추출
            blank_matches = re.findall(r'#(\d+)', question_text)
            if blank_matches:
                # 빈칸 번호별로 임시 키 생성 (정답은 모름으로 표시)
                for num in set(blank_matches):
                    answer_key[num] = f"[정답 #{num}]"
                print(f"Info: 자동으로 {len(answer_key)}개의 빈칸을 감지했습니다.")
    
    elif mode == 4:
        # "### 🔓 정답 확인"으로 분리
        split_token = "### 🔓 정답 확인"
        parts = response_text.split(split_token)
        question_text = parts[0].strip()
        if len(parts) > 1:
            answer_text = split_token + "\n" + parts[1].strip()
        else:
            answer_text = "정답 표준 형식이 없습니다."

    return DrillSession(mode, question_text, answer_text, _flatten_answer_key(answer_key))

