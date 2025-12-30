// ---------- Configuration ----------
const API_URL = 'https://gradevue-northshore.vercel.app/api/gradebook';

// ---------- Elements ----------
const statusEl = document.getElementById('status');
const loginBtn = document.getElementById('loginBtn');
const loginForm = document.getElementById('loginForm');
const classListEl = document.getElementById('classList');
const toastHost = document.getElementById('toastHost');

const studentHeader = document.getElementById('studentHeader');
const studentNameEl = document.getElementById('studentName');
const studentIdEl = document.getElementById('studentId');
const statClassesEl = document.getElementById('statClasses');
const statAvgEl = document.getElementById('statAvg');
const statAssignmentsEl = document.getElementById('statAssignments');

const studentNumberInput = document.getElementById('studentNumber');
const passwordInput = document.getElementById('password');
const domainInput = document.getElementById('domain');

// ---------- State ----------
let currentData = null;

// ---------- Utils ----------
function setStatus(msg) { statusEl.textContent = msg; }
function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${message}</span><button class="toast-close">Close</button>`;
  el.querySelector('.toast-close').onclick = () => el.remove();
  toastHost.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function persistInputs() {
  localStorage.setItem('gv_domain', domainInput.value.trim());
  localStorage.setItem('gv_username', studentNumberInput.value.trim());
}
function restoreInputs() {
  const domain = localStorage.getItem('gv_domain');
  const username = localStorage.getItem('gv_username');
  if (domain) domainInput.value = domain;
  if (username) studentNumberInput.value = username;
}
function validateDomain(url) {
  try {
    const u = new URL(url);
    return /edupoint\.com$/i.test(u.hostname);
  } catch { return false; }
}
function gradeLetter(gradeNum) {
  if (gradeNum === null) return 'N/A';
  if (gradeNum >= 90) return 'A';
  if (gradeNum >= 80) return 'B';
  if (gradeNum >= 70) return 'C';
  if (gradeNum >= 60) return 'D';
  return 'F';
}
function scoreClass(pct) {
  if (pct >= 90) return 'score-good';
  if (pct >= 80) return 'score-warn';
  return 'score-bad';
}
function parseDate(str) {
  if (!str) return '';
  const d = new Date(str);
  if (isNaN(d.getTime())) return str; // fallback if not ISO
  // Show MM/DD/YYYY
  return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`;
}
function computeGradeFromAssignments(assignments) {
  const totals = assignments.reduce((acc, a) => {
    const earned = Number(a.score) || 0;
    const possible = Number(a.outOf) || 0;
    acc.earned += earned;
    acc.possible += possible;
    return acc;
  }, { earned: 0, possible: 0 });
  if (!totals.possible) return null;
  return (totals.earned / totals.possible) * 100;
}

// ---------- API ----------
async function fetchRealGrades({ studentNumber, password, domain }) {
  const body = { domain, username: studentNumber, password };
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    let errMsg = 'Login failed';
    try {
      const err = JSON.parse(errText);
      errMsg = err.error || err.details || errMsg;
    } catch {
      errMsg = errText;
    }
    throw new Error(errMsg);
  }

  const result = await resp.json();
  return parseStudentVueXML(result.data || '');
}

// ---------- XML Parser ----------
function parseStudentVueXML(xmlString) {
  if (!xmlString || typeof xmlString !== 'string' || !xmlString.trim()) {
    throw new Error('Invalid XML response');
  }
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid XML response');
  }

  const studentInfo = xmlDoc.querySelector('StudentInfo');
  // Fallback to login inputs if StudentInfo missing
  const fallbackName = studentNumberInput.value ? `Student ${studentNumberInput.value}` : 'Student';
  const studentName = studentInfo?.getAttribute('StudentName') || fallbackName;
  const studentId = studentInfo?.getAttribute('StudentNumber') || studentNumberInput.value || '';

  const courseNodes = xmlDoc.querySelectorAll('Course');
  const classes = Array.from(courseNodes).map(course => {
    const name = course.getAttribute('Title') || 'Unknown Course';
    const period = course.getAttribute('Period') || '';
    const teacher = course.getAttribute('Staff') || '';
    const marks = course.querySelectorAll('Mark');

    // Select current mark (last)
    const currentMark = marks.length ? marks[marks.length - 1] : null;

    // Most precise decimal available from StudentVUE
    const gradeStrRaw = currentMark?.getAttribute('CalculatedScoreString') || '';
    const gradeNum = gradeStrRaw && !isNaN(parseFloat(gradeStrRaw))
      ? parseFloat(gradeStrRaw)
      : null;

    // Assignments with category + due date
    const assignmentNodes = currentMark ? currentMark.querySelectorAll('Assignment') : [];
    const assignments = Array.from(assignmentNodes).map(assign => {
      // Points can be "x / y" OR separate attributes
      const pointsStr = assign.getAttribute('Points') || '';
      let score = NaN;
      let outOf = NaN;
      if (pointsStr.includes('/')) {
        const [s, o] = pointsStr.split('/').map(p => parseFloat(p.trim()));
        score = isNaN(s) ? 0 : s;
        outOf = isNaN(o) ? 0 : o;
      } else {
        // Fallback attributes commonly present
        const s = parseFloat(assign.getAttribute('Score') || assign.getAttribute('PointsEarned') || '0');
        const o = parseFloat(assign.getAttribute('MaxScore') || assign.getAttribute('PointsPossible') || '0');
        score = isNaN(s) ? 0 : s;
        outOf = isNaN(o) ? 0 : o;
      }

      // Category & due date (support multiple possible attribute names)
      const category =
        assign.getAttribute('Type') ||
        assign.getAttribute('Category') ||
        assign.getAttribute('Group') ||
        assign.getAttribute('ScoreType') ||
        '';

      const dueDateRaw =
        assign.getAttribute('DateDue') ||
        assign.getAttribute('DueDate') ||
        assign.getAttribute('AssignedDate') ||
        '';

      const pct = outOf ? (score / outOf) * 100 : 0;

      return {
        name: assign.getAttribute('Measure') || 'Assignment',
        category,
        dueDate: parseDate(dueDateRaw),
        score,
        outOf,
        pct
      };
    });

    return {
      name,
      section: period ? `Period ${period}` : 'N/A',
      teacher,
      credits: 1,
      gradeStr: gradeStrRaw,   // string from StudentVUE
      gradeNum,                // numeric, null if N/A
      assignments,
      hypoAssignments: [],     // user-added
      hypoMode: false          // per-class toggle
    };
  });

  return { student: { name: studentName, id: studentId }, classes };
}

// ---------- Render ----------
function renderStudentHeader(data) {
  studentNameEl.textContent = data.student.name || 'Student';
  studentIdEl.textContent = data.student.id ? `ID ${data.student.id}` : 'ID —';
  statClassesEl.textContent = data.classes.length.toString();
  const allAssignments = data.classes.reduce((acc, c) => acc + c.assignments.length + c.hypoAssignments.length, 0);
  statAssignmentsEl.textContent = allAssignments.toString();

  // Average excludes N/A grades
  const graded = data.classes.filter(c => c.gradeNum !== null);
  const avg = graded.length
    ? graded.reduce((acc, c) => acc + c.gradeNum, 0) / graded.length
    : null;
  statAvgEl.textContent = avg === null ? '—' : `${avg.toFixed(2)}%`;
}

function renderClassList(data) {
  if (!data || !data.classes || !data.classes.length) {
    classListEl.innerHTML = `
      <div class="class-row">
        <div class="class-title">No classes found</div>
        <div class="class-right"><span class="grade-letter">N/A</span><span class="grade-percent">—</span>
          <div class="progress"><div class="progress-fill" style="width:0%"></div><div class="progress-trail"></div></div>
        </div>
      </div>
    `;
    return;
  }

  classListEl.innerHTML = data.classes.map((cls, idx) => {
    // Decide displayed grade: either precise StudentVUE grade or hypothetical computed
    let displayGradeStr = '—';
    let displayGradeNum = null;

    if (cls.hypoMode) {
      const combined = [...cls.assignments, ...cls.hypoAssignments];
      const hypo = computeGradeFromAssignments(combined);
      if (hypo === null) {
        // No possible points: fall back to original if present
        displayGradeNum = cls.gradeNum;
        displayGradeStr = cls.gradeNum === null ? '—' : cls.gradeNum.toFixed(2) + '%';
      } else {
        displayGradeNum = hypo;
        displayGradeStr = hypo.toFixed(2) + '%';
      }
    } else {
      if (cls.gradeNum === null) {
        displayGradeNum = null;
        displayGradeStr = '—';
      } else {
        displayGradeNum = cls.gradeNum;
        // Most precise decimal available (use original string if present)
        displayGradeStr = cls.gradeStr ? `${cls.gradeStr}%` : `${cls.gradeNum.toFixed(2)}%`;
      }
    }

    const letter = gradeLetter(displayGradeNum);
    const barWidth = displayGradeNum === null ? 0 : Math.max(0, Math.min(100, displayGradeNum));

    const assignmentsHtml = [...cls.assignments, ...cls.hypoAssignments].map(a => {
      const pct = a.outOf ? (a.score / a.outOf) * 100 : 0;
      return `
        <div class="assignment">
          <div>
            <div class="assignment-name">${escapeHtml(a.name)}</div>
            <div class="assignment-meta">
              ${escapeHtml(a.category || 'Uncategorized')}
              ${a.dueDate ? ' • Due ' + escapeHtml(a.dueDate) : ''}
              • ${a.score} / ${a.outOf} points
            </div>
          </div>
          <div class="assignment-score ${scoreClass(pct)}">${pct.toFixed(1)}%</div>
        </div>
      `;
    }).join('');

    return `
      <div class="class-row" onclick="toggleDetails(${idx})">
        <div>
          <div class="class-title">${escapeHtml(cls.name)}</div>
        </div>
        <div class="class-right">
          <span class="grade-letter">${letter}</span>
          <span class="grade-percent">${displayGradeStr}</span>
          <div class="progress">
            <div class="progress-fill" style="width:${barWidth}%"></div>
            <div class="progress-trail"></div>
          </div>
        </div>
        <div id="details-${idx}" class="class-details hidden" onclick="event.stopPropagation()">
          <div class="details-head">
            <div class="detail-meta">${escapeHtml(cls.teacher)} • ${escapeHtml(cls.section)} • ${cls.credits} credit</div>
            <button class="btn" onclick="toggleDetails(${idx})">Close</button>
          </div>

          <div class="assignments">
            <div class="assignment-list">
              ${assignmentsHtml || `<div class="assignment"><div><div class="assignment-name">No assignments yet</div></div></div>`}
            </div>
          </div>

          <div class="hypo-form">
            <div class="hypo-actions">
              <label class="hypo-toggle">
                <input type="checkbox" ${cls.hypoMode ? 'checked' : ''} onchange="toggleHypoMode(${idx}, this.checked)" />
                Hypothetical mode
              </label>
            </div>
            <div class="hypo-grid">
              <input id="hypo-name-${idx}" placeholder="Assignment name" />
              <select id="hypo-cat-${idx}">
                <option value="">Uncategorized</option>
                <option>Homework</option>
                <option>Quiz</option>
                <option>Test</option>
                <option>Project</option>
              </select>
              <input id="hypo-date-${idx}" type="date" />
              <input id="hypo-score-${idx}" type="number" min="0" step="0.1" placeholder="Score" />
              <input id="hypo-outof-${idx}" type="number" min="0" step="0.1" placeholder="Out of" />
            </div>
            <div class="hypo-actions">
              <button class="btn btn-primary" onclick="addHypo(${idx})">Add hypothetical</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ---------- Interactions ----------
window.toggleDetails = (idx) => {
  const el = document.getElementById(`details-${idx}`);
  if (el) el.classList.toggle('hidden');
};

window.toggleHypoMode = (idx, checked) => {
  currentData.classes[idx].hypoMode = checked;
  renderStudentHeader(currentData);
  renderClassList(currentData);
};

window.addHypo = (idx) => {
  const name = document.getElementById(`hypo-name-${idx}`).value.trim() || 'Hypothetical Assignment';
  const category = document.getElementById(`hypo-cat-${idx}`).value || '';
  const dueDateRaw = document.getElementById(`hypo-date-${idx}`).value;
  const score = parseFloat(document.getElementById(`hypo-score-${idx}`).value);
  const outOf = parseFloat(document.getElementById(`hypo-outof-${idx}`).value);

  if (isNaN(score) || isNaN(outOf) || outOf <= 0) {
    toast('Enter valid score and total points', 'error');
    return;
  }

  currentData.classes[idx].hypoAssignments.push({
    name, category, dueDate: parseDate(dueDateRaw), score, outOf
  });

  renderStudentHeader(currentData);
  renderClassList(currentData);
  // Keep details open and re-render it
  setTimeout(() => {
    const el = document.getElementById(`details-${idx}`);
    if (el && el.classList.contains('hidden')) el.classList.remove('hidden');
  }, 0);

  toast('Hypothetical assignment added', 'success');
};

// ---------- Form handling ----------
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const studentNumber = studentNumberInput.value.trim();
  const password = passwordInput.value;
  const domain = domainInput.value.trim();

  if (!studentNumber || !password || !domain) {
    setStatus('All fields are required');
    toast('All fields are required', 'error');
    return;
  }
  if (!validateDomain(domain)) {
    setStatus('Domain must be edupoint.com');
    toast('Domain must be an edupoint.com host', 'error');
    return;
  }

  loginBtn.disabled = true;
  setStatus('Authenticating with StudentVUE…');

  try {
    const data = await fetchRealGrades({ studentNumber, password, domain });
    currentData = data;
    persistInputs();
    setStatus(`Loaded grades for ${data.student.name} (${data.student.id || 'ID —'})`);
    toast('Grades loaded successfully', 'success');

    studentHeader.classList.remove('hidden');
    renderStudentHeader(currentData);
    renderClassList(currentData);
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Login failed');
    toast(err.message || 'Login failed', 'error');
  } finally {
    loginBtn.disabled = false;
  }
});

// ---------- Init ----------
restoreInputs();
