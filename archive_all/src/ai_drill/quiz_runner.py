from rich.console import Console
from rich.markdown import Markdown
from rich.syntax import Syntax
from rich.panel import Panel
from rich.prompt import Prompt
from rich.align import Align
from rich.text import Text
import re
from .quiz_parser import DrillSession

console = Console()

def run_drill(session: DrillSession):
    """
    모드별 인터랙티브 드릴 실행.
    """
    console.clear()
    
    title_map = {
        1: "논리 강화 (OOP 빈칸)",
        2: "자료구조 마스터 (하드코어 빈칸)",
        3: "백지 복습 (Whiteboard)",
        4: "실전 모의고사"
    }
    
    title = title_map.get(session.mode, "알 수 없는 모드")
    
    console.print(Panel(
        Align.center(f"[bold white]{title}[/bold white]"),
        style="bold blue",
        subtitle="[dim]AI Training Center[/dim]",
        padding=(1, 2)
    ))

    if session.mode in [1, 2]:
        run_fill_in_the_blank(session)
    elif session.mode == 3:
        run_whiteboard(session)
    elif session.mode == 4:
        run_problem_set(session)
    else:
        console.print("[red]지원하지 않는 모드입니다.[/red]")

def run_fill_in_the_blank(session: DrillSession):
    """
    Mode 1 & 2: 빈칸 맞추기.
    """
    question_code = session.question_text
    # 지원되는 플레이스홀더:
    # 1) "_____" 연속 밑줄
    # 2) "__[숫자]__" 형태 (LLM이 이미 번호를 붙인 경우)
    blank_count_plain = question_code.count("_____")
    blank_count_indexed = len(re.findall(r"__\[(\d+)\]__", question_code))
    blank_count = blank_count_plain or blank_count_indexed

    if blank_count == 0:
        console.print(Panel("[yellow]빈칸을 찾을 수 없습니다. 원본 코드를 확인하세요.[/yellow]", title="알림"))
        console.print(Syntax(question_code, "python", theme="monokai", line_numbers=True, word_wrap=True))
        return

    display_code = question_code
    if blank_count_plain:
        for i in range(1, blank_count + 1):
            display_code = display_code.replace("_____", f"__[{i}]__", 1)

    console.print(Panel(
        Syntax(display_code, "python", theme="monokai", line_numbers=True, word_wrap=True),
        title=f"[bold green]문제 코드 (총 {blank_count}칸)[/bold green]",
        border_style="green"
    ))
    
    console.print("\n[dim]번호별로 답을 입력하고 Enter를 누르세요. 즉시 정오답과 정답을 알려줍니다.[/dim]\n")

    correct = 0
    results = []

    # 입력 루프
    for i in range(1, blank_count + 1):
        key = str(i)
        expected_answer = session.answer_key.get(key)
        
        if expected_answer is None:
            console.print(f"[yellow]경고: 빈칸 {i}에 대한 정답 키가 없습니다.[/yellow]")
            results.append((i, None, None))
            continue

        user_input = Prompt.ask(f"[bold cyan]빈칸 [{i}][/bold cyan]")
        is_correct = user_input.strip() == expected_answer.strip()
        if is_correct:
            console.print("[bold green]정답![/bold green]")
            correct += 1
        else:
            console.print(Panel(
                f"입력값: [red]{user_input}[/red]\n정답: [green]{expected_answer}[/green]",
                title="[bold red]오답[/bold red]",
                border_style="red"
            ))
        results.append((i, expected_answer, user_input))

    score_color = "green" if correct == blank_count else "yellow"
    if correct < blank_count / 2:
        score_color = "red"
    
    console.print(Panel(
        Align.center(f"[bold {score_color}]최종 점수: {correct} / {blank_count}[/bold {score_color}]"),
        title="채점 결과",
        padding=(1, 5)
    ))

def run_whiteboard(session: DrillSession):
    """
    Mode 3: 백지 복습.
    """
    console.print(Panel(
        Markdown(session.question_text),
        title="[bold yellow]백지 복습 스켈레톤[/bold yellow]",
        border_style="yellow"
    ))
    
    console.print("\n[bold cyan]설명을 읽고 직접 구현해 보세요. Enter를 누르면 정답 코드가 공개됩니다.[/bold cyan]")
    Prompt.ask("\n준비되면 Enter를 눌러 정답을 확인하세요..")
    
    console.print("\n")
    console.print(Panel(
        Syntax(session.answer_text, "python", theme="monokai", line_numbers=True, word_wrap=True),
        title="[bold green]모범 답안[/bold green]",
        border_style="green"
    ))

def run_problem_set(session: DrillSession):
    """
    Mode 4: 객관식 문제 세트.
    """
    console.print(Panel(
        Markdown(session.question_text),
        title="[bold blue]문제 세트[/bold blue]",
        border_style="blue"
    ))
    
    console.print("\n[bold cyan]문제 풀이를 마쳤으면 Enter를 눌러 정답을 확인하세요.[/bold cyan]")
    Prompt.ask("\nEnter를 누르면 정답/해설을 공개합니다..")
    
    console.print("\n")
    console.print(Panel(
        Markdown(session.answer_text),
        title="[bold green]정답/해설[/bold green]",
        border_style="green"
    ))
