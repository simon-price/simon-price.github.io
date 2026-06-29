/* WinEcon-style economics quiz engine.
   Loads questions from an open-format JSON file, renders them dynamically,
   keeps score and gives per-answer feedback. */

(function () {
  "use strict";

  var quiz = null;          // loaded quiz definition
  var state = {
    current: 0,             // index of the current question
    responses: [],          // user's chosen answer per question (null = unanswered)
    marked: [],             // whether each question has been marked/checked
    correct: [],            // whether each marked answer was correct
    finished: false,
    secondsLeft: 0,
    timerId: null
  };

  // ---- DOM handles ----
  var el = {};
  ["titlebarText", "kindLabel", "quizTitle", "statValue", "statAnswered",
   "statScore", "statTime", "questionArea", "questionText", "optionsList",
   "feedback", "counter", "slider", "markBtn", "explainBtn", "topicBtn",
   "prevBtn", "nextBtn", "instructionsBtn", "contentsBtn"].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  // ---- Load data ----
  fetch("questions.json")
    .then(function (r) {
      if (!r.ok) { throw new Error("HTTP " + r.status); }
      return r.json();
    })
    .then(init)
    .catch(function (err) {
      el.questionText.textContent =
        "Could not load questions (" + err.message + "). " +
        "If you opened this file directly, run it from a web server instead.";
    });

  function init(data) {
    quiz = data;
    var n = quiz.questions.length;

    state.responses = new Array(n).fill(null);
    state.marked = new Array(n).fill(false);
    state.correct = new Array(n).fill(false);
    state.secondsLeft = (quiz.timeLimit || 60);

    // Static labels
    el.quizTitle.textContent = quiz.title;
    el.kindLabel.textContent = quiz.kind || "Test";
    el.titlebarText.innerHTML =
      "WinEcon / " + escapeHtml(quiz.course || "") + " / " +
      escapeHtml(quiz.section || "") + " / " + escapeHtml(quiz.title) + "&hellip;";
    el.statValue.textContent = (quiz.questionValue || Math.round(100 / n)) + "%";
    el.slider.min = 1;
    el.slider.max = n;

    // Wire up controls
    el.markBtn.addEventListener("click", markCurrent);
    el.explainBtn.addEventListener("click", showExplanation);
    el.topicBtn.addEventListener("click", function () {
      flash("Topic: " + quiz.title + " (" + quiz.course + ").");
    });
    el.prevBtn.addEventListener("click", function () { go(state.current - 1); });
    el.nextBtn.addEventListener("click", function () { go(state.current + 1); });
    el.slider.addEventListener("input", function () { go(parseInt(el.slider.value, 10) - 1); });
    el.instructionsBtn.addEventListener("click", showInstructions);
    el.contentsBtn.addEventListener("click", function () {
      flash("Contents: " + n + " questions on " + quiz.title + ".");
    });

    startTimer();
    render();
  }

  // ---- Rendering ----
  function render() {
    if (state.finished) { renderSummary(); return; }

    var q = quiz.questions[state.current];
    var idx = state.current;

    el.questionText.textContent = q.text;
    el.optionsList.innerHTML = "";

    var choices = optionLabels(q);
    choices.forEach(function (label, i) {
      var li = document.createElement("li");
      var lab = document.createElement("label");

      var input = document.createElement("input");
      input.type = "radio";
      input.name = "q" + idx;
      input.value = i;
      input.checked = (state.responses[idx] === i);
      input.disabled = state.marked[idx];
      input.addEventListener("change", function () {
        state.responses[idx] = i;
        updateStats();
      });

      var span = document.createElement("span");
      span.textContent = label;

      lab.appendChild(input);
      lab.appendChild(span);
      li.appendChild(lab);

      // If already marked, show the verdict colouring + markers
      if (state.marked[idx]) {
        var answerIdx = correctIndex(q);
        if (i === answerIdx) {
          li.className = "correct";
          li.appendChild(marker("✓ Correct answer"));
        } else if (state.responses[idx] === i) {
          li.className = "incorrect";
          li.appendChild(marker("✗ Your answer"));
        }
      }

      el.optionsList.appendChild(li);
    });

    // Feedback panel
    if (state.marked[idx]) {
      showFeedback(idx);
    } else {
      el.feedback.className = "feedback";
      el.feedback.innerHTML = "";
    }

    // Toolbar state
    el.counter.textContent = (idx + 1) + " of " + quiz.questions.length;
    el.slider.value = idx + 1;
    el.prevBtn.disabled = (idx === 0);
    el.markBtn.disabled = state.marked[idx];
    el.nextBtn.innerHTML = (idx === quiz.questions.length - 1)
      ? "Finish"
      : '<svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">' +
        '<path d="M7 1 L14 6 L7 11 M14 6 H2" fill="none" stroke="#000" ' +
        'stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>';

    updateStats();
  }

  function renderSummary() {
    var n = quiz.questions.length;
    var score = state.correct.filter(Boolean).length;
    var pct = Math.round((score / n) * 100);
    var grade = pct >= 70 ? "Pass — well done!" :
                pct >= 50 ? "A borderline result — review the topic." :
                            "More revision needed.";

    el.questionArea.innerHTML =
      '<div class="summary">' +
        "<h2>Test complete</h2>" +
        '<div class="score-big">' + pct + "%</div>" +
        "<p>You answered <b>" + score + "</b> of <b>" + n + "</b> questions correctly.</p>" +
        "<p>" + grade + "</p>" +
        '<p><button class="win-btn" id="restartBtn" style="margin-top:8px;">Try again</button></p>' +
      "</div>";

    document.getElementById("restartBtn").addEventListener("click", restart);

    el.markBtn.disabled = true;
    el.explainBtn.disabled = true;
    el.nextBtn.disabled = true;
    el.prevBtn.disabled = false;
    stopTimer();
    updateStats();
  }

  // ---- Actions ----
  function markCurrent() {
    var idx = state.current;
    if (state.marked[idx]) { return; }
    if (state.responses[idx] === null || state.responses[idx] === undefined) {
      flash("Please select an answer before marking.");
      return;
    }
    var q = quiz.questions[idx];
    state.marked[idx] = true;
    state.correct[idx] = (state.responses[idx] === correctIndex(q));
    render();
  }

  function showFeedback(idx) {
    var q = quiz.questions[idx];
    var ok = state.correct[idx];
    el.feedback.className = "feedback show";
    el.feedback.innerHTML =
      '<span class="verdict ' + (ok ? "right" : "wrong") + '">' +
        (ok ? "✓ Correct." : "✗ Not quite.") +
      "</span>" + escapeHtml(q.explanation || "");
  }

  function showExplanation() {
    var idx = state.current;
    var q = quiz.questions[idx];
    if (!state.marked[idx]) {
      // Reveal explanation without scoring the answer
      el.feedback.className = "feedback show";
      el.feedback.innerHTML =
        '<span class="verdict">Explanation</span>' + escapeHtml(q.explanation || "");
    } else {
      showFeedback(idx);
    }
  }

  function go(target) {
    if (state.finished) {
      if (target < quiz.questions.length) {
        state.finished = false;
        // Restore question area markup destroyed by the summary
        rebuildQuestionArea();
      } else {
        return;
      }
    }
    if (target < 0) { return; }
    if (target >= quiz.questions.length) { finish(); return; }
    state.current = target;
    render();
  }

  function finish() {
    state.finished = true;
    render();
  }

  function restart() {
    var n = quiz.questions.length;
    state.current = 0;
    state.responses = new Array(n).fill(null);
    state.marked = new Array(n).fill(false);
    state.correct = new Array(n).fill(false);
    state.finished = false;
    state.secondsLeft = (quiz.timeLimit || 60);
    rebuildQuestionArea();
    el.explainBtn.disabled = false;
    el.nextBtn.disabled = false;
    startTimer();
    render();
  }

  function rebuildQuestionArea() {
    el.questionArea.innerHTML =
      '<p class="question-text" id="questionText"></p>' +
      '<ul class="options" id="optionsList"></ul>' +
      '<div class="feedback" id="feedback" role="status" aria-live="polite"></div>';
    el.questionText = document.getElementById("questionText");
    el.optionsList = document.getElementById("optionsList");
    el.feedback = document.getElementById("feedback");
  }

  // ---- Stats & timer ----
  function updateStats() {
    var n = quiz.questions.length;
    var answered = state.responses.filter(function (r) {
      return r !== null && r !== undefined;
    }).length;
    var score = state.correct.filter(Boolean).length;
    el.statAnswered.textContent = answered + "/" + n;
    el.statScore.textContent = Math.round((score / n) * 100) + "%";
  }

  function startTimer() {
    stopTimer();
    renderTime();
    state.timerId = setInterval(function () {
      state.secondsLeft--;
      if (state.secondsLeft <= 0) {
        state.secondsLeft = 0;
        renderTime();
        stopTimer();
        if (!state.finished) { finish(); }
        return;
      }
      renderTime();
    }, 1000);
  }

  function stopTimer() {
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
  }

  function renderTime() {
    var limit = quiz.timeLimit || 60;
    var elapsed = limit - state.secondsLeft;
    el.statTime.textContent = fmt(elapsed) + " / " + fmt(limit);
  }

  function fmt(s) {
    var m = Math.floor(s / 60);
    var sec = s % 60;
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  }

  // ---- Helpers ----
  function optionLabels(q) {
    if (q.type === "truefalse") { return ["True.", "False."]; }
    return q.options || [];
  }

  function correctIndex(q) {
    if (q.type === "truefalse") { return q.answer === true ? 0 : 1; }
    return q.answer; // numeric index for multiple choice
  }

  function marker(text) {
    var s = document.createElement("span");
    s.className = "marker";
    s.textContent = text;
    return s;
  }

  function flash(msg) {
    el.feedback.className = "feedback show";
    el.feedback.innerHTML = '<span class="verdict">Note</span>' + escapeHtml(msg);
  }

  function showInstructions() {
    flash("Select an answer, then press Mark to check it. Use Explain for the " +
          "reasoning, the arrows or slider to move between questions, and finish " +
          "to see your score.");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
