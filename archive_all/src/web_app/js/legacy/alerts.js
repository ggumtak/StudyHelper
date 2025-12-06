// Centralized legacy alert helpers (Korean UI, UTF-8)
(function (global) {
  const Alerts = {
    noChatHistory() {
      alert("저장된 대화 기록이 없습니다.");
    },
    chatHistoryStats(userMsgs, aiMsgs, total) {
      alert(`📜 대화 기록\n\n사용자 메시지: ${userMsgs}개\nAI 응답: ${aiMsgs}개\n\n총 ${total}개의 메시지가 저장되어 있습니다.`);
    },
    mode1Reload() {
      alert("Mode 1에서는 파일/모드 버튼으로 다시 로드해주세요.");
    },
    noAnswerCode() {
      alert("정답 코드가 없어 새 빈칸을 생성할 수 없습니다.");
    },
    jsonParseFail(message) {
      alert(`JSON 파싱 실패: ${message}`);
    },
    genericError(message) {
      alert(message);
    },
    requireAnswer() {
      alert("답을 입력해주세요.");
    },
    allVocabGraded() {
      alert("모든 영단어가 이미 채점되었습니다.");
    },
    allDefinitionsGraded() {
      alert("모든 정의가 이미 채점되었습니다.");
    },
    allChallengesGraded() {
      alert("모든 챌린지가 이미 채점되었습니다.");
    },
    missingAnswerKey() {
      alert("정답 키가 없어 채점할 수 없습니다. 세션을 다시 생성해 주세요.");
    },
    noReviewQuestions() {
      alert("복습할 문제가 없습니다. 먼저 틀린 문제나 미응답 문제를 만들어주세요.");
    },
    noReviewCards() {
      alert("복습할 카드가 없습니다.");
    },
    noReviewBlanks() {
      alert("복습할 빈칸이 없습니다. 먼저 채점/정답을 확인해주세요.");
    },
    emptyReviewQueue() {
      alert("복습 큐가 비어 있습니다.");
    },
    progressSummary(answered, total) {
      alert(`📊 현재 진행 상황\n\n완료: ${answered} / ${total}개\n남은 문제: ${total - answered}개\n\n※ 파싱된 문제는 정답을 알 수 없어 채점이 불가합니다.`);
    },
    noParsingAnswers() {
      alert("📚 파싱된 문제에는 정답 정보가 포함되어 있지 않습니다.\n\nPython 코드 파일로 세션을 생성하면 자동 채점이 가능합니다.");
    },
    apiKeySaved() {
      alert("API 키가 저장되었습니다.");
    },
    requireDefinition() {
      alert("정의를 입력해주세요.");
    },
    requestError(message) {
      alert(`오류: ${message}`);
    },
    requestFailed(message) {
      alert(`요청 실패: ${message}`);
    },
    requireCode() {
      alert("코드를 입력해주세요!");
    },
  };

  global.LegacyAlerts = Alerts;
})(window);
