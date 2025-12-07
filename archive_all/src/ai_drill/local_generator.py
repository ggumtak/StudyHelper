# 로컬(LLM 없는) 변환용 단순 제너레이터
import re
import random
import math
import os
from .quiz_parser import DrillSession
from .answer_key import MC_ANSWERS as QUIZ_ANSWERS  # 정답표는 answer_key.py에서 import

# 고정 파일 경로
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
MODE2_FILE = os.path.join(DATA_DIR, "4_Data_Structure_Code.txt")
MODE4_FILE = os.path.join(DATA_DIR, "5_Computational_Math_Theory.txt")


def get_fixed_file_for_mode(mode: int) -> str | None:
    """모드별 고정 파일 경로 반환"""
    if mode == 2:
        if os.path.exists(MODE2_FILE):
            return MODE2_FILE
    elif mode == 4:
        if os.path.exists(MODE4_FILE):
            return MODE4_FILE
    return None


def build_local_session(content: str, mode: int, difficulty: int = 2) -> DrillSession:
    """
    ================================================================================
    LLM 없이 로컬에서 학습 세션을 생성하는 함수
    ================================================================================
    
    이 함수는 웹 UI에서 "세션 생성" 버튼을 누르면 호출됩니다.
    입력된 텍스트 파일을 분석하여 학습용 문제 세션을 생성합니다.
    
    Args:
        content: 입력 텍스트 (파일 내용)
        mode: 학습 모드 번호
        difficulty: 난이도 (1=Easy, 2=Normal, 3=Hard, 4=Extreme)
    
    Returns:
        DrillSession: 생성된 학습 세션
    """
    import traceback
    from pathlib import Path
    
    # 로깅용 (서버에서 log_error 함수 사용)
    log_file = Path(__file__).parent.parent / "logs" / "server_error.log"
    def log(msg):
        try:
            from datetime import datetime
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(f"[{timestamp}] [local_generator] {msg}\n")
                f.flush()
        except:
            pass
    
    try:
        log(f"build_local_session 시작: mode={mode}, diff={difficulty}, content_len={len(content)}")
        
        # 1. 모드별 고정 파일 확인 (난이도 무시)
        fixed_file = get_fixed_file_for_mode(mode)
        if fixed_file and os.path.exists(fixed_file):
            log(f"고정 파일 사용: {fixed_file}")
            with open(fixed_file, 'r', encoding='utf-8') as f:
                content = f.read()
        
        # 2. 이미 객관식 문제 형식인지 감지
        if is_existing_quiz(content):
            log(f"기존 문제 형식 감지됨 → parse_existing_quiz 호출")
            result = parse_existing_quiz(content, mode)
            log(f"parse_existing_quiz 완료: {type(result)}")
            return result
        
        # 3. 모드별 처리
        log(f"모드 {mode}에 맞는 변환 함수 호출")
        
        if mode in (1, 2):
            # 난이도별 고정 빈칸 개수 설정
            # 1(Easy): 30개, 2(Normal): 50개, 3(Hard): 60개, 4(Extreme): 80개
            fixed_counts = {1: 30, 2: 50, 3: 60, 4: 80}
            target = fixed_counts.get(difficulty, 50)
            log(f"빈칸 생성 목표: {target}개 (난이도 {difficulty})")
            log(f"난이도별 빈칸 개수: 쉬움=30, 보통=50, 어려움=60, 극한=80")
            
            question, answer_key = make_blanks_with_context(content, target)
            if mode == 2:
                answer_key["_type"] = "fill_in_blank_inline"
            return DrillSession(mode, question, content, answer_key)
            
        if mode == 3:
            question, answer_key = make_implementation_challenge(content)
            return DrillSession(mode, question, content, answer_key)

            
        if mode == 4:
            question, answer_key = make_multiple_choice(content)
            return DrillSession(mode, question, content, answer_key)
            
        if mode == 5:
            question, answer_key = make_definition_quiz(content)
            return DrillSession(mode, question, content, answer_key)
            
        if mode == 7:
            question, answer_key = make_vocabulary_cards(content)
            return DrillSession(mode, question, content, answer_key)
        
        # 기본 반환
        log(f"알 수 없는 모드 {mode}, 기본 세션 반환")
        return DrillSession(mode, content, content, {})
        
    except Exception as e:
        log(f"build_local_session 오류: {e}\n{traceback.format_exc()}")
        # 에러 발생 시에도 빈 세션 반환 (서버 크래시 방지)
        return DrillSession(mode, "세션 생성 중 오류 발생", str(e), {"_error": str(e)})


def is_existing_quiz(content: str) -> bool:
    """이미 객관식 문제 형식인지 감지"""
    quiz_patterns = [
        r'[①②③④⑤]',
        r'^\s*\d+\.\s+.+',
        r'실행\s*결과',
        r'빈칸에\s*들어갈',
    ]
    
    matches = 0
    for pattern in quiz_patterns:
        if re.search(pattern, content, re.MULTILINE):
            matches += 1
    
    return matches >= 2


def parse_existing_quiz(content: str, mode: int) -> DrillSession:
    """
    이미 형식화된 문제 파일 파싱
    - 정답 자동 매칭 기능 추가
    """
    questions = []
    lines = content.split('\n')
    
    i = 0
    seq_num = 0
    current_chapter = 0
    
    while i < len(lines):
        line = lines[i].strip()
        
        # 챕터 감지
        chapter_match = re.match(r'\[Chapter\s*(\d+)\.', line)
        if chapter_match:
            current_chapter = int(chapter_match.group(1))
            i += 1
            continue
        
        # 새 문제 시작 감지
        q_match = re.match(r'^(\d+)\.\s*(.+)', line)
        if q_match:
            original_num = q_match.group(1)
            q_text = q_match.group(2).strip()
            code_lines = []
            options = []
            q_type = "unknown"
            
            # 문제 유형 감지
            if '입력하시오' in q_text or '적으시오' in q_text or '작성하시오' in q_text:
                q_type = "short_answer"
            elif '빈칸' in q_text or '밑줄' in q_text:
                q_type = "fill_blank"
            else:
                q_type = "multiple_choice"
            
            i += 1
            
            while i < len(lines):
                curr_line = lines[i]
                stripped = curr_line.strip()
                
                if re.match(r'^\d+\.\s+.+', stripped):
                    break
                if stripped.startswith('[Chapter') or stripped.startswith('[chapter'):
                    break
                
                # 선지 감지
                opt_match = re.match(r'^[①②③④⑤]\s*(.+)', stripped)
                if opt_match:
                    symbol = stripped[0]
                    opt_num = {'①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5}.get(symbol, 0)
                    opt_text = opt_match.group(1).strip()
                    options.append({
                        'num': opt_num,
                        'text': opt_text
                    })
                    q_type = "multiple_choice"
                    i += 1
                    continue
                
                if stripped.startswith('[') and stripped.endswith(']'):
                    i += 1
                    continue
                
                # 코드 라인
                if stripped and not stripped.startswith('#') and (
                    curr_line.startswith('   ') or 
                    curr_line.startswith('\t') or
                    '=' in stripped or
                    stripped.startswith('print') or
                    stripped.startswith('def ') or
                    stripped.startswith('class ') or
                    stripped.startswith('for ') or
                    stripped.startswith('if ') or
                    stripped.startswith('while ') or
                    stripped.startswith('import ') or
                    stripped.startswith('from ') or
                    stripped.startswith('return ') or
                    re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*\s*[=\[\(]', stripped)
                ):
                    code_lines.append(stripped)
                    i += 1
                    continue
                
                i += 1
            
            # 정답 찾기
            answer_key_id = f"{current_chapter}_{original_num}"
            correct_answer = QUIZ_ANSWERS.get(answer_key_id, None)
            
            seq_num += 1
            questions.append({
                'id': seq_num,
                'original_num': original_num,
                'chapter': current_chapter,
                'text': q_text,
                'code': '\n'.join(code_lines) if code_lines else '',
                'options': options,
                'type': q_type,
                'correct': correct_answer  # 정답 추가!
            })
        else:
            i += 1
    
    # answer_key 구성
    mc_count = len([q for q in questions if q['type'] == 'multiple_choice' and q['options']])
    sa_count = len([q for q in questions if q['type'] == 'short_answer' or not q['options']])
    fb_count = len([q for q in questions if q['type'] == 'fill_blank'])
    answered_count = len([q for q in questions if q['correct'] is not None])
    
    answer_key = {
        "_type": "parsed_quiz",
        "_questions": questions,
        "_total": len(questions),
        "_has_answers": answered_count > 0
    }
    
    for q in questions:
        if q['correct'] is not None:
            answer_key[str(q['id'])] = str(q['correct'])
        else:
            answer_key[str(q['id'])] = ""
    
    question_text = f"총 {len(questions)}개 문제 파싱됨"
    
    answer_text = f"""📝 총 {len(questions)}개의 문제가 로드되었습니다.

📊 문제 유형:
- 객관식: {mc_count}개
- 단답형/빈칸: {sa_count + fb_count}개

✅ 정답이 있는 문제: {answered_count}개
(자동 채점 가능!)

선지를 클릭하면 즉시 채점됩니다."""
    
    return DrillSession(mode, question_text, answer_text, answer_key)


def is_valid_answer(ans: str) -> bool:
    """빈칸 정답으로 적합한지 검증"""
    if not ans or len(ans) <= 1:
        return False
    cleaned = ans.rstrip(")],;").strip()
    if not cleaned:
        return False
    special_only = set("()[]{}:,;'\"` ")
    if all(c in special_only for c in ans):
        return False
    if re.match(r'^[\'\"]\s*[\'\"]?\)?$', ans):
        return False
    if not re.search(r'[a-zA-Z0-9_]', ans):
        return False
    return True


def clean_answer(ans: str) -> str:
    """정답에서 불필요한 후행 괄호/쉼표/콜론 제거"""
    cleaned = ans.rstrip()
    while cleaned.endswith(')') or cleaned.endswith(',') or cleaned.endswith(';') or cleaned.endswith(':'):
        if cleaned.endswith(')'):
            open_count = cleaned.count('(')
            close_count = cleaned.count(')')
            if close_count > open_count:
                cleaned = cleaned[:-1].rstrip()
            else:
                break
        else:
            cleaned = cleaned[:-1].rstrip()
    return cleaned



def build_inline_blank_code(code: str, blanks: list) -> str:
    """
    Render inline __[N]__ markers using recorded positions, with fallbacks if text search fails.
    blanks: [{"line_num": 4, "answer": "None", "col_offset": 10}, ...]
    """
    lines = code.split("\n")
    blanks_by_line: dict[int, list[dict]] = {}
    for blank in blanks:
        line_num = int(blank.get("line_num", 0))
        blanks_by_line.setdefault(line_num, []).append(blank)

    result_lines = []
    for i, line in enumerate(lines):
        line_num = i + 1
        line_blanks = blanks_by_line.get(line_num)
        if not line_blanks:
            result_lines.append(line)
            continue

        modified_line = line
        sorted_blanks = sorted(
            line_blanks,
            key=lambda b: -(b.get("col_offset", -1) if b.get("col_offset", -1) != -1 else b.get("blank_num", 0))
        )

        for blank in sorted_blanks:
            answer = str(blank.get("answer", "")).strip()
            col_offset = blank.get("col_offset", -1)
            marker = f"__[{blank.get('blank_num')}]__"
            insert_at = -1

            if col_offset is not None and col_offset >= 0 and col_offset + len(answer) <= len(modified_line):
                segment = modified_line[col_offset:col_offset + len(answer)]
                if segment == answer:
                    insert_at = col_offset

            if insert_at == -1 and answer:
                insert_at = modified_line.find(answer)

            if insert_at != -1:
                modified_line = modified_line[:insert_at] + marker + modified_line[insert_at + len(answer):]
            else:
                modified_line = f"{modified_line.rstrip()} {marker}".strip()

        result_lines.append(modified_line)

    return "\n".join(result_lines)


def make_blanks_with_context(code: str, target_count: int):
    """
    AST-based blank generation with CONCEPT-UNIT extraction.
    
    Key Principles:
    1. Extract CONCEPT UNITS, not individual tokens
       - Full conditions: "current.link is not None" as one blank
       - Full pointer assignments: "current.link = node" as one blank
    2. Weighted Priority:
       - Pointer/Structure manipulation (weight 3): head=, current.link=, pre.link=
       - Control conditions (weight 3): if/while conditions
       - Boundary checks (weight 2): index < 0, head is None
       - Return values (weight 1): return result
    3. Distribute evenly across FUNCTIONS
    4. Maintain minimum LINE DISTANCE between blanks
    5. Avoid duplicates of same concept pattern
    """
    import ast
    
    # ========== CONFIGURATION ==========
    MIN_LINE_DISTANCE = 2  # Minimum lines between blanks
    
    # Weights for scoring
    WEIGHT_POINTER = 3      # head, current, pre, node, .link assignments
    WEIGHT_CONDITION = 3    # if/while/for conditions
    WEIGHT_BOUNDARY = 2     # index < 0, head is None boundary checks
    WEIGHT_RETURN = 1       # return statements
    WEIGHT_EXCLUDED = 0     # print, menu, file I/O
    
    # Function importance weights for distribution
    FUNCTION_WEIGHTS = {
        'appendNode': 3, 'insertNode': 3, 'insertAt': 3, 'deleteNode': 3,
        'searchNode': 2, 'printNodes': 1, 'get_list_data': 1,
        'Node': 1, '__init__': 1,
        'saveToFile': 0.5, 'loadFromFile': 0.5, 'clearList': 0.5,
        '__main__': 0.3, 'main': 0.3,
    }
    DEFAULT_FUNC_WEIGHT = 1.0
    
    # Pointer-related identifiers to detect
    POINTER_IDENTIFIERS = {'head', 'current', 'pre', 'node', 'newNode', 'temp'}
    
    # Excluded patterns (don't create blanks for these)
    EXCLUDED_LINE_PATTERNS = [
        r'^\s*print\s*\(["\']',      # Print with string literal
        r'^\s*#',                     # Comments
        r'^\s*"""',                   # Docstrings
        r"^\s*'''",                   # Docstrings
        r'^\s*def\s+\w+\s*\(',       # Function definitions (name only)
        r'^\s*class\s+\w+',          # Class definitions
    ]
    
    lines = code.splitlines()
    candidates = []
    
    # ========== HELPER FUNCTIONS ==========
    
    def get_source_segment(code_lines: list, start_line: int, start_col: int, 
                           end_line: int, end_col: int) -> str:
        """Extract source code segment from line/column positions."""
        if start_line == end_line:
            return code_lines[start_line - 1][start_col:end_col]
        result = [code_lines[start_line - 1][start_col:]]
        for line_idx in range(start_line, end_line - 1):
            result.append(code_lines[line_idx])
        result.append(code_lines[end_line - 1][:end_col])
        return '\n'.join(result)
    
    def get_text_from_node(node, code_lines: list) -> str:
        """Get source text for an AST node."""
        if not hasattr(node, 'lineno') or not hasattr(node, 'end_lineno'):
            return ""
        try:
            return get_source_segment(
                code_lines, node.lineno, node.col_offset,
                node.end_lineno, node.end_col_offset
            )
        except (IndexError, AttributeError):
            return ""
    
    def is_pointer_related(node) -> bool:
        """Check if node involves pointer/structure manipulation."""
        text = get_text_from_node(node, lines)
        # Check for pointer identifiers or .link attribute
        if '.link' in text:
            return True
        for ident in POINTER_IDENTIFIERS:
            if re.search(rf'\b{ident}\b', text):
                return True
        return False
    
    def is_excluded_line(line: str) -> bool:
        """Check if line should be excluded from blank generation."""
        for pattern in EXCLUDED_LINE_PATTERNS:
            if re.match(pattern, line):
                return True
        return False
    
    def detect_current_function(node, func_map: dict) -> str:
        """Find which function contains this node based on line number."""
        line = getattr(node, 'lineno', 0)
        containing_func = '__global__'
        for func_name, (start, end) in func_map.items():
            if start <= line <= end:
                containing_func = func_name
        return containing_func
    
    # ========== AST PARSING ==========
    
    try:
        tree = ast.parse(code)
    except SyntaxError:
        # Fallback to simple token-based extraction if AST fails
        return _fallback_token_blanks(code, target_count)
    
    # Build function map: function_name -> (start_line, end_line)
    func_map = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            end_line = node.end_lineno if hasattr(node, 'end_lineno') else node.lineno + 20
            func_map[node.name] = (node.lineno, end_line)
        elif isinstance(node, ast.ClassDef):
            for item in node.body:
                if isinstance(item, ast.FunctionDef):
                    end_line = item.end_lineno if hasattr(item, 'end_lineno') else item.lineno + 10
                    func_map[f"{node.name}.{item.name}"] = (item.lineno, end_line)
    
    # ========== CANDIDATE EXTRACTION ==========
    
    for node in ast.walk(tree):
        line_num = getattr(node, 'lineno', 0)
        if line_num == 0 or line_num > len(lines):
            continue
        
        line_text = lines[line_num - 1]
        if is_excluded_line(line_text):
            continue
        
        func_name = detect_current_function(node, func_map)
        
        # --- 1. If/While/For CONDITIONS (Priority: WEIGHT_CONDITION or WEIGHT_BOUNDARY) ---
        if isinstance(node, (ast.If, ast.While)):
            condition_text = get_text_from_node(node.test, lines)
            if condition_text and len(condition_text) > 2:
                # Determine if this is a boundary check
                is_boundary = any(kw in condition_text for kw in 
                    ['is None', '< 0', '> len', '>= len', 'is not None', '== 0', 'index'])
                score = WEIGHT_BOUNDARY if is_boundary else WEIGHT_CONDITION
                
                # Extra boost for pointer-related conditions
                if is_pointer_related(node.test):
                    score = WEIGHT_CONDITION
                
                candidates.append({
                    'type': 'condition',
                    'text': condition_text,
                    'line_num': line_num,
                    'col_offset': node.test.col_offset,
                    'score': score,
                    'function': func_name,
                    'full_line': line_text,
                })
        
        # --- 2. For loop iterables ---
        elif isinstance(node, ast.For):
            iter_text = get_text_from_node(node.iter, lines)
            if iter_text and len(iter_text) > 2:
                candidates.append({
                    'type': 'for_iter',
                    'text': iter_text,
                    'line_num': line_num,
                    'col_offset': node.iter.col_offset,
                    'score': WEIGHT_CONDITION,
                    'function': func_name,
                    'full_line': line_text,
                })
        
        # --- 3. POINTER/STRUCTURE ASSIGNMENTS (Priority: WEIGHT_POINTER) ---
        elif isinstance(node, ast.Assign):
            # Check if this is a pointer-related assignment
            assign_text = get_text_from_node(node, lines)
            
            # Look for patterns like: head = node, current.link = node, etc.
            target_text = ""
            for target in node.targets:
                target_text = get_text_from_node(target, lines)
                break
            
            value_text = get_text_from_node(node.value, lines)
            
            is_pointer_assign = False
            # Check if LHS has pointer identifiers or .link
            if target_text:
                if '.link' in target_text:
                    is_pointer_assign = True
                for ident in POINTER_IDENTIFIERS:
                    if target_text == ident or target_text.startswith(f"{ident}."):
                        is_pointer_assign = True
                        break
            
            if is_pointer_assign and assign_text and len(assign_text) > 3:
                candidates.append({
                    'type': 'pointer_assign',
                    'text': assign_text.strip(),
                    'line_num': line_num,
                    'col_offset': node.col_offset,
                    'score': WEIGHT_POINTER,
                    'function': func_name,
                    'full_line': line_text,
                })
        
        # --- 4. RETURN STATEMENTS (Priority: WEIGHT_RETURN) ---
        elif isinstance(node, ast.Return):
            if node.value:
                return_val = get_text_from_node(node.value, lines)
                if return_val and len(return_val) > 1:
                    candidates.append({
                        'type': 'return',
                        'text': return_val,
                        'line_num': line_num,
                        'col_offset': node.value.col_offset,
                        'score': WEIGHT_RETURN,
                        'function': func_name,
                        'full_line': line_text,
                    })
    
    # ========== DISTRIBUTION ALGORITHM ==========
    
    # Group candidates by function
    by_function = {}
    for cand in candidates:
        func = cand['function']
        by_function.setdefault(func, []).append(cand)
    
    # Sort candidates within each function by score (descending)
    for func in by_function:
        by_function[func].sort(key=lambda c: -c['score'])
    
    # Calculate target allocation per function
    total_weight = sum(FUNCTION_WEIGHTS.get(f.split('.')[-1], DEFAULT_FUNC_WEIGHT) 
                       for f in by_function.keys())
    if total_weight == 0:
        total_weight = len(by_function)
    
    allocations = {}
    for func in by_function:
        func_base = func.split('.')[-1]  # Handle Class.method names
        weight = FUNCTION_WEIGHTS.get(func_base, DEFAULT_FUNC_WEIGHT)
        alloc = max(1, round(target_count * weight / total_weight))
        allocations[func] = alloc
    
    # Select candidates with line distance constraint
    selected = []
    used_lines = set()
    used_patterns = set()  # Track concept patterns to avoid duplicates
    
    for func_name in sorted(by_function.keys(), 
                           key=lambda f: -FUNCTION_WEIGHTS.get(f.split('.')[-1], DEFAULT_FUNC_WEIGHT)):
        func_candidates = by_function[func_name]
        func_quota = allocations.get(func_name, 1)
        func_selected = 0
        
        for cand in func_candidates:
            if func_selected >= func_quota:
                break
            
            line = cand['line_num']
            
            # Check minimum line distance
            if any(abs(line - used) < MIN_LINE_DISTANCE for used in used_lines):
                continue
            
            # Check for duplicate pattern (same text in same function)
            pattern_key = (func_name, cand['text'][:20])
            if pattern_key in used_patterns:
                continue
            
            selected.append(cand)
            used_lines.add(line)
            used_patterns.add(pattern_key)
            func_selected += 1
    
    # Fill remaining quota from high-score leftovers
    remaining = target_count - len(selected)
    if remaining > 0:
        leftover = [c for c in candidates if c not in selected]
        leftover.sort(key=lambda c: -c['score'])
        
        for cand in leftover:
            if len(selected) >= target_count:
                break
            
            line = cand['line_num']
            if any(abs(line - used) < MIN_LINE_DISTANCE for used in used_lines):
                continue
            
            selected.append(cand)
            used_lines.add(line)
    
    # If still not enough, add more with relaxed constraints
    if len(selected) < target_count:
        leftover = [c for c in candidates if c not in selected]
        leftover.sort(key=lambda c: (-c['score'], c['line_num']))
        for cand in leftover:
            if len(selected) >= target_count:
                break
            selected.append(cand)
    
    selected = selected[:target_count]
    
    # ========== BUILD OUTPUT ==========
    
    # Sort by line/column and assign blank numbers
    selected.sort(key=lambda b: (b['line_num'], b.get('col_offset', 0)))
    for idx, blank in enumerate(selected, 1):
        blank['blank_num'] = idx
        blank['answer'] = blank['text']  # For compatibility with build_inline_blank_code
    
    answer_key = {
        "_type": "fill_in_blank_inline",
        "_blanks": selected,
        "_original_code": code,
    }
    for blank in selected:
        answer_key[str(blank["blank_num"])] = blank["text"]
    
    question_text = build_inline_blank_code(code, selected)
    return question_text, answer_key


def _fallback_token_blanks(code: str, target_count: int):
    """
    Fallback to simple token-based blank generation if AST parsing fails.
    """
    lines = code.splitlines()
    token_re = re.compile(r"[A-Za-z_][A-Za-z0-9_]*|\b\d+\b")
    
    EXCLUDED_KEYWORDS = {
        'print', 'def', 'class', 'import', 'from', 'as', 'pass',
        'True', 'False', 'None', 'self', 'cls',
        '__init__', '__main__', '__name__',
    }
    
    candidates = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        
        for match in token_re.finditer(line):
            answer = match.group().strip()
            if answer in EXCLUDED_KEYWORDS or len(answer) <= 1:
                continue
            
            candidates.append({
                "line_num": i + 1,
                "answer": answer,
                "text": answer,
                "full_line": line.rstrip("\n"),
                "col_offset": match.start(),
            })
    
    random.shuffle(candidates)
    blanks = candidates[:target_count]
    blanks.sort(key=lambda b: (b["line_num"], b.get("col_offset", 0)))
    
    for idx, blank in enumerate(blanks, 1):
        blank["blank_num"] = idx
    
    answer_key = {
        "_type": "fill_in_blank_inline",
        "_blanks": blanks,
        "_original_code": code,
    }
    for blank in blanks:
        answer_key[str(blank["blank_num"])] = blank["answer"]
    
    question_text = build_inline_blank_code(code, blanks)
    return question_text, answer_key

def make_implementation_challenge(code: str):
    """
    코드 전체를 섹션별로 분리하여 백지복습 챌린지 생성
    - 함수 (def)
    - 클래스 (class) 
    - 전역 변수 선언
    - if __name__ == "__main__": 블록
    - 주석으로 구분된 섹션
    """
    lines = code.splitlines()
    challenges = []
    
    # 1단계: 코드를 섹션으로 분리
    sections = []
    current_section = {"type": "code", "header": "", "lines": [], "start_line": 1}
    
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        
        # 주석 섹션 헤더 감지 (## ... ##)
        if stripped.startswith("##") and stripped.endswith("##"):
            if current_section["lines"]:
                sections.append(current_section)
            current_section = {"type": "section_header", "header": stripped, "lines": [], "start_line": i + 1}
            i += 1
            continue
        
        # if __name__ == "__main__": 블록 감지
        if stripped.startswith('if __name__') and '__main__' in stripped:
            if current_section["lines"]:
                sections.append(current_section)
            current_section = {"type": "main_block", "header": line, "lines": [], "start_line": i + 1}
            i += 1
            # 이후 모든 줄을 메인 블록으로 처리
            while i < len(lines):
                current_section["lines"].append(lines[i])
                i += 1
            sections.append(current_section)
            current_section = {"type": "code", "header": "", "lines": [], "start_line": i + 1}
            continue
        
        # 클래스 정의 감지
        if stripped.startswith("class "):
            if current_section["lines"]:
                sections.append(current_section)
            current_section = {"type": "class", "header": line, "lines": [], "start_line": i + 1}
            indent_match = re.match(r"(\s*)", line)
            class_indent = indent_match.group(1) + "    "
            i += 1
            # 클래스 본체 수집
            while i < len(lines):
                curr_line = lines[i]
                curr_stripped = curr_line.strip()
                if curr_stripped == "" or curr_line.startswith(class_indent) or curr_stripped.startswith(("#", '"""', "'''")):
                    current_section["lines"].append(curr_line)
                    i += 1
                else:
                    break
            sections.append(current_section)
            current_section = {"type": "code", "header": "", "lines": [], "start_line": i + 1}
            continue
        
        # 함수 정의 감지
        if stripped.startswith("def "):
            if current_section["lines"]:
                sections.append(current_section)
            current_section = {"type": "function", "header": line, "lines": [], "start_line": i + 1}
            indent_match = re.match(r"(\s*)", line)
            func_indent = indent_match.group(1) + "    "
            i += 1
            # 함수 본체 수집
            while i < len(lines):
                curr_line = lines[i]
                curr_stripped = curr_line.strip()
                if curr_stripped == "" or curr_line.startswith(func_indent) or curr_stripped.startswith(("#", '"""', "'''")):
                    current_section["lines"].append(curr_line)
                    i += 1
                else:
                    break
            sections.append(current_section)
            current_section = {"type": "code", "header": "", "lines": [], "start_line": i + 1}
            continue
        
        # 전역 변수 또는 일반 코드
        current_section["lines"].append(line)
        i += 1
    
    # 마지막 섹션 추가
    if current_section["lines"]:
        sections.append(current_section)
    
    # 2단계: 섹션을 챌린지로 변환
    for section in sections:
        body_text = "\n".join(section["lines"]).strip()
        
        # 빈 섹션 제외
        if not body_text:
            continue
        
        # 섹션 헤더만 있는 경우 제외
        if section["type"] == "section_header":
            continue
        
        # 빈 줄만 있는 경우 제외
        if not body_text.replace("\n", "").strip():
            continue
        
        # 헤더 결정
        if section["type"] == "function":
            header = section["header"]
        elif section["type"] == "class":
            header = section["header"]
        elif section["type"] == "main_block":
            header = section["header"]
        elif section["type"] == "code":
            # 전역 변수나 일반 코드 블록
            first_line = body_text.split("\n")[0].strip()
            if "=" in first_line:
                header = "# 전역 변수 선언"
            else:
                header = "# 코드 블록"
        else:
            header = "# 코드"
        
        challenges.append({
            "signature": header,
            "body": body_text,
            "line_num": section["start_line"],
            "type": section["type"]
        })
    
    answer_key = {
        "_type": "implementation_challenge",
        "_challenges": challenges,
        "_original_code": code
    }
    for idx, ch in enumerate(challenges, 1):
        answer_key[str(idx)] = ch["body"]
    
    question_text = "\n".join([f"[챌린지 {i+1}] {ch['signature'].strip()}" for i, ch in enumerate(challenges)])
    return question_text, answer_key


def make_multiple_choice(code: str, num_questions: int = 10):
    """코드에서 객관식 문제 생성"""
    lines = code.splitlines()
    candidates = []
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(("def ", "class ", "import ", "from ", "#", '"""', "'''")):
            continue
        if not stripped:
            continue
        
        assign_match = re.search(r"=\s*([^#\n=]+)$", line)
        if assign_match:
            raw_ans = assign_match.group(1).strip()
            ans = clean_answer(raw_ans)
            if is_valid_answer(ans):
                context_start = max(0, i - 3)
                context_end = min(len(lines), i + 4)
                context = "\n".join(lines[context_start:context_end])
                question_line = line.replace(ans, "_____", 1)
                context_with_blank = context.replace(line, question_line, 1)
                
                candidates.append({
                    "context": context_with_blank,
                    "answer": ans,
                    "line_num": i + 1,
                    "full_line": line
                })
        
        return_match = re.search(r"return\s+([^#\n]+)$", line)
        if return_match:
            raw_ans = return_match.group(1).strip()
            ans = clean_answer(raw_ans)
            if is_valid_answer(ans):
                context_start = max(0, i - 3)
                context_end = min(len(lines), i + 4)
                context = "\n".join(lines[context_start:context_end])
                question_line = line.replace(ans, "_____", 1)
                context_with_blank = context.replace(line, question_line, 1)
                
                candidates.append({
                    "context": context_with_blank,
                    "answer": ans,
                    "line_num": i + 1,
                    "full_line": line
                })
    
    random.shuffle(candidates)
    selected = candidates[:num_questions]
    all_answers = list(set(c["answer"] for c in candidates))
    
    questions = []
    answer_key = {}
    
    for idx, item in enumerate(selected, 1):
        correct = item["answer"]
        wrong_pool = [a for a in all_answers if a != correct]
        if len(wrong_pool) < 3:
            wrong_pool.extend(["None", "True", "False", "self", "0", "1", "[]", "{}"])
            wrong_pool = list(set(wrong_pool) - {correct})
        
        wrong_choices = random.sample(wrong_pool, min(3, len(wrong_pool)))
        choices = [correct] + wrong_choices
        random.shuffle(choices)
        correct_index = choices.index(correct) + 1
        
        questions.append({
            "num": idx,
            "text": "다음 코드의 빈칸에 들어갈 알맞은 것은?",
            "code": item["context"],
            "options": [{"num": j+1, "text": c} for j, c in enumerate(choices)],
            "correct": correct_index
        })
        answer_key[str(idx)] = str(correct_index)
    
    full_question = f"총 {len(questions)}개 문제 생성됨"
    
    answer_key["_type"] = "multiple_choice"
    answer_key["_questions"] = questions
    
    return full_question, answer_key


def make_definition_quiz(content: str):
    """
    OOP 정의 퀴즈 생성 (Mode 5)
    
    지원 형식:
    1. 쉼표 구분: 용어,정의
    2. 줄바꿈 구분: 용어(영문) / 정의 (교대로)
    
    예시 (쉼표 구분):
    메서드 오버로딩 (Method Overloading),같은 이름의 메서드를 매개변수만 다르게 여러 개 정의하는 것
    
    예시 (줄바꿈 구분):
    메서드 오버로딩(Method Overloading)
    같은 이름의 메서드를 매개변수만 다르게 여러 개 정의하는 것
    """
    lines = content.strip().split('\n')
    definitions = []
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        # 형식 1: 쉼표로 구분 (용어,정의)
        if ',' in line:
            parts = line.split(',', 1)  # 첫 번째 쉼표에서만 분리
            if len(parts) == 2:
                term = parts[0].strip()
                definition = parts[1].strip()
                if term and definition:
                    definitions.append({
                        'term': term,
                        'definition': definition
                    })
                    continue
    
    # 형식 1에서 못 찾았으면 형식 2 시도 (줄바꿈 구분)
    if not definitions:
        i = 0
        while i < len(lines):
            term_line = lines[i].strip()
            if not term_line:
                i += 1
                continue
            
            if i + 1 < len(lines):
                def_line = lines[i + 1].strip()
                if def_line and not re.match(r'^[가-힣a-zA-Z]+\s*\(', def_line):
                    definitions.append({
                        'term': term_line,
                        'definition': def_line
                    })
                    i += 2
                    continue
            i += 1
    
    answer_key = {
        "_type": "definition_quiz",
        "_definitions": definitions,
        "_total": len(definitions)
    }
    
    for idx, item in enumerate(definitions, 1):
        answer_key[str(idx)] = item['definition']
    
    question_text = f"총 {len(definitions)}개 정의 문제 생성됨"
    return question_text, answer_key


def make_vocabulary_cards(content: str):
    """
    영단어 플래시카드 생성 (Mode 7)
    
    지원 형식:
    1. 쉼표 구분: 영단어, 뜻1, 뜻2, ...
    2. 구분자 구분: 영단어 -> 뜻 또는 영단어: 뜻
    3. 영어만: AI 생성 필요
    
    예시:
    inheritance, 상속, 유산
    interface -> 접점
    abstract: 추상적인
    """
    lines = content.strip().split('\n')
    words = []
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        # 형식 1: 쉼표로 구분 (영단어, 뜻1, 뜻2, ...)
        if ',' in line:
            parts = line.split(',')
            if len(parts) >= 2:
                eng = parts[0].strip()
                # 첫 번째 뜻만 사용하거나, 모든 뜻 합치기
                kor = ', '.join(p.strip() for p in parts[1:] if p.strip())
                if eng and kor and re.match(r'^[a-zA-Z\s]+', eng):
                    words.append({
                        'english': eng,
                        'korean': kor,
                        'needs_ai': False
                    })
                    continue
        
        # 형식 2: 구분자로 구분 (-> : = 등)
        if re.search(r'[-:=→]', line):
            parts = re.split(r'\s*[-:=→]\s*', line, 1)
            if len(parts) >= 2:
                eng = parts[0].strip()
                kor = parts[1].strip()
                if eng and kor and re.match(r'^[a-zA-Z]+', eng):
                    if not is_transliteration(eng, kor):
                        words.append({
                            'english': eng,
                            'korean': kor,
                            'needs_ai': False
                        })
                        continue
        
        # 형식 3: 영어만 있는 경우 - AI 생성 필요
        if re.match(r'^[a-zA-Z]+$', line):
            words.append({
                'english': line,
                'korean': '',
                'needs_ai': True
            })
    
    answer_key = {
        "_type": "vocabulary_cards",
        "_words": words,
        "_total": len(words),
        "_needs_ai_generation": any(w['needs_ai'] for w in words)
    }
    
    for idx, item in enumerate(words, 1):
        answer_key[str(idx)] = item['korean'] if item['korean'] else "[AI 생성 필요]"
    
    question_text = f"총 {len(words)}개 영단어 카드 생성됨"
    return question_text, answer_key


def is_transliteration(english: str, korean: str) -> bool:
    """
    단순 음역인지 확인
    예: code -> 코드, interface -> 인터페이스
    """
    transliteration_pairs = {
        'code': '코드',
        'interface': '인터페이스',
        'class': '클래스',
        'object': '오브젝트',
        'method': '메서드',
        'function': '펑션',
        'module': '모듈',
        'package': '패키지',
        'library': '라이브러리',
        'framework': '프레임워크',
        'server': '서버',
        'client': '클라이언트',
        'database': '데이터베이스',
        'process': '프로세스',
        'thread': '스레드',
        'memory': '메모리',
        'file': '파일',
        'system': '시스템',
        'program': '프로그램',
        'data': '데이터',
        'type': '타입',
        'list': '리스트',
        'array': '어레이',
        'string': '스트링',
        'integer': '인티저',
        'boolean': '불리언',
        'null': '널',
        'error': '에러',
        'debug': '디버그',
        'test': '테스트',
        'api': '에이피아이',
        'url': '유알엘',
    }
    
    eng_lower = english.lower()
    kor_clean = korean.strip()
    
    # 직접 매핑 확인
    if eng_lower in transliteration_pairs:
        if transliteration_pairs[eng_lower] == kor_clean:
            return True
    
    # 음역 패턴 확인 (한글이 5자 이내이고 영어와 비슷한 길이)
    if len(kor_clean) <= 5 and len(eng_lower) <= len(kor_clean) * 2:
        # 간단한 휴리스틱: 한글이 너무 짧으면 음역일 가능성 높음
        if len(kor_clean) <= 3:
            return True
    
    return False
