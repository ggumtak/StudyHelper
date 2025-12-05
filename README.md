# 📚 Study Helper

> 코드/문제 연습장 - AI 기반 학습 도우미

## 🚀 시작하기

1. `StudyHelper.exe` 실행
2. 자동으로 브라우저가 열립니다
3. 파일/모드를 선택하고 학습 시작!

## 📁 폴더 구조

```
StudyHelper/
├── StudyHelper.exe    # 👈 이것만 실행하세요!
├── ngrok.exe          # 외부 접속용 (선택)
├── data/              # 학습 자료 폴더
├── config/            # 설정 파일
└── src/               # 소스 코드 (수정 금지)
```

## 🎯 학습 모드

| 모드 | 설명 |
|------|------|
| 1 | C# OOP 빈칸 채우기 |
| 2 | 자료구조 빈칸 |
| 3 | 백지복습 (코드 작성) |
| 4 | 모의고사 |
| 5 | 정의 퀴즈 |
| 6 | 전산수학 코드 작성 |
| 7 | 영단어 |

## ⌨️ 단축키

- `Enter` - 다음 빈칸으로 이동
- `Ctrl+Enter` - 전체 채점
- `Shift+Enter` - 개별 채점 (Mode 3)
- `S` - 문제 순서 섞기
- `R` - 리셋

## 📱 모바일 접속

PC에서 서버 실행 후, 같은 WiFi의 핸드폰에서 화면에 표시된 주소로 접속

## 💡 문의

문제가 있으면 Issues 탭에서 알려주세요!

### �ȵ���̵忡�� ���� ���� ���� (Termux/Pydroid)
1. Python ��ġ �� ����� ��Ʈ�� �̵�
2. `pip install -r requirements.txt`
3. `python scripts/mobile_server.py --port 8000`
4. �޴��� ���������� `http://<�� IP>:8000` ���� (���� WiFi/�ֽ���)
