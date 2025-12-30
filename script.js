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
function setStatus(msg, icon = '⏳') {
  statusEl.textContent = `${icon} ${msg}`;
}
function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${type === 'success' ? '✅' : '❌'}</span><span>${message}</span><button class="toast-close">✖</button>`;
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
function gradeLetter(grade) {
  if (grade === 0) return 'N/A';
  if (grade >= 90) return 'A';
  if (grade >= 80) return 'B';
  if (grade >= 70) return 'C';
  if (grade >= 60) return 'D';
  return 'F';
}
function scoreClass(pct) {
  if (pct >= 90) return 'score-good';
  if (pct >= 80) return 'score-warn';
  return 'score-bad';
}
function computeGrade(assignments) {
  const totals = assignments.reduce((acc, a) => {
    acc.earned += Number(a.score) || 0;
    acc.possible += Number(a.outOf) || 0;
    return acc;
  }, { earned: 0, possible: 0 });
  return totals.possible ? Math.round((totals.earned / totals.possible) * 100) : 0;
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
  const studentName = studentInfo?.getAttribute('StudentName') || 'Student';
  const studentId = studentInfo?.getAttribute('StudentNumber') || '';

  const courseNodes = xmlDoc.querySelectorAll('Course');
  const classes = Array.from(courseNodes).map(course => {
    const name = course.getAttribute('Title') || 'Unknown Course';
    const period = course.getAttribute('Period') || '';
    const teacher = course.getAttribute('Staff') || '';
    const marks = course.querySelectorAll('Mark');

    let grade = 0;
    let assignments = [];

    if (marks.length > 0) {
      const currentMark = marks[marks.length - 1];
      const calculatedGrade = currentMark.getAttribute('CalculatedScoreString');
      grade = Math.round(parseFloat(calculatedGrade) || 0);

      const assignmentNodes = currentMark.querySelectorAll('Assignment');
      assignments = Array.from(assignmentNodes).map(assign => {
        const pointsStr = assign.getAttribute('Points') || '0 / 0';
        const [score, outOf] = pointsStr.split(' / ').map(p => parseFloat(p) || 0);
        return {
          name: assign.getAttribute('Measure') || 'Assignment',
          score, outOf
        };
      });
    }

    if (!grade) grade = computeGrade(assignments);

    return {
      name,
      section: period ? `Period ${period}` : 'N/A',
      teacher,
      credits: 1,
      grade,
      assignments
    };
  });

  return { student: { name: studentName, id: studentId }, classes };
}

// ---------- Render ----------
function renderStudentHeader(data) {
  studentNameEl.textContent = data.student.name || 'Student';
  studentIdEl.textContent = data.student.id ? `ID ${data.student.id}` : 'ID —';
  statClassesEl.textContent = data.classes.length.toString();
  const allAssignments = data.classes.reduce((acc, c) => acc + c.assignments.length, 0);
  statAssignmentsEl.textContent = allAssignments.toString();
  const avg = data.classes.length
    ? Math.round(data.classes.reduce((acc, c) => acc + (c.grade || 0), 0) / data.classes.length)
    : 0;
  statAvgEl.textContent = data.classes.length ? `${avg}%` : '—';
}

function renderClassList(data) {
  if (!data || !data.classes || !data.classes.length) {
    classListEl.innerHTML = `
      <div class="class-row">
        <div class="class-title">No classes found</div>
        <div class="class-right"><span class="grade-letter">N/A</span><span class="grade-percent">0%</span>
          <div class="progress"><div class="progress-fill" style="width:0%"></div><div class="progress-trail"></div></div>
        </div>
      </div>
    `;
    return;
  }

  classListEl.innerHTML = data.classes.map((cls, idx) => {
    const pct = cls.grade || 0;
    const letter = gradeLetter(pct);
    return `
      <div class="class-row" onclick="toggleDetails(${idx})">
        <div>
          <div class="class-title">${escapeHtml(cls.name)}</div>
        </div>
        <div class="class-right">
          <span class="grade-letter">${letter}</span>
          <span class="grade-percent">${pct}%</span>
          <div class="progress">
            <div class="progress-fill" style="width:${Math.min(100, Math.max(0, pct))}%"></div>
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
              ${cls.assignments.length ? cls.assignments.map(a => {
                const apct = a.outOf ? Math.round((a.score / a.outOf) * 100) : 0;
                return `
                  <div class="assignment">
                    <div>
                      <div class="assignment-name">${escapeHtml(a.name)}</div>
                      <div class="assignment-points">${a.score} / ${a.outOf} points</div>
                    </div>
                    <div class="assignment-score ${scoreClass(apct)}">${apct}%</div>
                  </div>
                `;
              }).join('') : `<div class="assignment"><div><div class="assignment-name">No assignments yet</div></div></div>`}
            </div>
          </div>

          <div class="hypo-form">
            <div class="hypo-grid">
              <input id="hypo-name-${idx}" placeholder="Assignment name" />
              <input id="hypo-score-${idx}" type="number" min="0" step="0.1" placeholder="Score" />
              <input id="hypo-outof-${idx}" type="number" min="0" step="0.1" placeholder="Out of" />
              <button class="btn btn-primary" onclick="addHypo(${idx})">🧮 What‑If</button>
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

window.addHypo = (idx) => {
  const name = document.getElementById(`hypo-name-${idx}`).value.trim() || 'What‑If Assignment';
  const score = parseFloat(document.getElementById(`hypo-score-${idx}`).value);
  const outOf = parseFloat(document.getElementById(`hypo-outof-${idx}`).value);

  if (isNaN(score) || isNaN(outOf) || outOf <= 0) {
    toast('Enter valid score and total points', 'error');
    return;
  }

  const temp = structuredClone(currentData);
  temp.classes[idx].assignments.push({ name, score, outOf });
  temp.classes[idx].grade = computeGrade(temp.classes[idx].assignments);

  currentData = temp;
  renderStudentHeader(currentData);
  renderClassList(currentData);
  toggleDetails(idx);
  toggleDetails(idx);
  toast(`New grade for ${temp.classes[idx].name}: ${temp.classes[idx].grade}%`, 'success');
};

// ---------- Form handling ----------
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const studentNumber = studentNumberInput.value.trim();
  const password = passwordInput.value;
  const domain = domainInput.value.trim();

  if (!studentNumber || !password || !domain) {
    setStatus('All fields are required', '⚠️');
    toast('All fields are required', 'error');
    return;
  }
  if (!validateDomain(domain)) {
    setStatus('Domain must be edupoint.com', '⚠️');
    toast('Domain must be an edupoint.com host', 'error');
    return;
  }

  loginBtn.disabled = true;
  setStatus('Authenticating with StudentVUE…', '🔄');

  try {
    const data = await fetchRealGrades({ studentNumber, password, domain });
    currentData = data;
    persistInputs();
    setStatus(`Loaded grades for ${data.student.name} (${data.student.id || 'ID —'})`, '✅');
    toast('Grades loaded successfully', 'success');

    studentHeader.classList.remove('hidden');
    renderStudentHeader(currentData);
    renderClassList(currentData);
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Login failed', '❌');
    toast(err.message || 'Login failed', 'error');
  } finally {
    loginBtn.disabled = false;
  }
});

// ---------- Init ----------
restoreInputs();
// skeleton remains until data loads
