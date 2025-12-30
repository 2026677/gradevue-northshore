// ---------- Configuration ----------
const API_URL = 'https://gradevue-northshore.vercel.app/api/gradebook';

// ---------- Elements ----------
const statusEl = document.getElementById('status');
const loginBtn = document.getElementById('loginBtn');
const loginForm = document.getElementById('loginForm');
const loadSampleBtn = document.getElementById('loadSampleBtn');
const classesEl = document.getElementById('classes');
const themeToggle = document.getElementById('themeToggle');

const studentHeader = document.getElementById('studentHeader');
const toolsBar = document.getElementById('toolsBar');
const studentNameEl = document.getElementById('studentName');
const studentIdEl = document.getElementById('studentId');
const statClassesEl = document.getElementById('statClasses');
const statAvgEl = document.getElementById('statAvg');
const statAssignmentsEl = document.getElementById('statAssignments');

const studentNumberInput = document.getElementById('studentNumber');
const passwordInput = document.getElementById('password');
const domainInput = document.getElementById('domain');

const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');

const toastHost = document.getElementById('toastHost');

// ---------- State ----------
let currentData = null;
let filteredData = null;

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
function gradeClass(grade) {
  if (grade >= 90) return 'grade-good';
  if (grade >= 80) return 'grade-warn';
  return 'grade-bad';
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

// ---------- Theme ----------
themeToggle.addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'light';
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  toast(`Switched to ${dark ? 'Light' : 'Dark'} theme`, 'success');
});

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
  return parseStudentVueXML(result.data || result.raw || '');
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

  // Student info
  const studentInfo = xmlDoc.querySelector('StudentInfo');
  const studentName = studentInfo?.getAttribute('StudentName') || 'Student';
  const studentId = studentInfo?.getAttribute('StudentNumber') || '';

  // Courses
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

    if (!grade) {
      grade = computeGrade(assignments);
    }

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

function renderClasses(data) {
  if (!data || !data.classes || !data.classes.length) {
    classesEl.innerHTML = `
      <div class="class-card">
        <div class="class-top">
          <div>
            <div class="class-name">No classes found</div>
            <div class="class-meta">Try logging in again</div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  classesEl.innerHTML = data.classes.map((cls, idx) => {
    const badgeClass = gradeClass(cls.grade || 0);
    const assignmentsHtml = cls.assignments.map(a => {
      const pct = a.outOf ? Math.round((a.score / a.outOf) * 100) : 0;
      return `
        <div class="assignment">
          <div>
            <div class="assignment-name">${escapeHtml(a.name)}</div>
            <div class="assignment-points">${a.score} / ${a.outOf} points</div>
          </div>
          <div class="assignment-score ${scoreClass(pct)}">${pct}%</div>
        </div>
      `;
    }).join('');

    return `
      <div class="class-card">
        <div class="class-top">
          <div>
            <div class="class-name">${escapeHtml(cls.name)}</div>
            <div class="class-meta">${escapeHtml(cls.teacher)} • ${escapeHtml(cls.section)}</div>
            <div class="tags">
              <span class="tag tag-period">${escapeHtml(cls.section)}</span>
              <span class="tag tag-credits">${cls.credits} credit</span>
            </div>
          </div>
          <div class="grade-badge ${badgeClass}">${cls.grade || 0}%</div>
        </div>

        <div class="assignments">
          <div class="assignments-title">Assignments</div>
          <div id="assign-list-${idx}">
            ${assignmentsHtml || `<div class="assignment"><div><div class="assignment-name">No assignments yet</div></div></div>`}
          </div>
        </div>

        <div class="actions">
          <button class="btn collapse-btn" onclick="toggleAssignments(${idx})">📂 Toggle Assignments</button>
          <button class="btn btn-secondary" onclick="toggleHypo(${idx})">➕ What‑If</button>
        </div>

        <div id="hypo-${idx}" class="assignments hidden">
          <div class="assignments-title">Hypothetical Assignment</div>
          <div class="form-grid">
            <div class="form-group">
              <label for="hypo-name-${idx}">Name</label>
              <input id="hypo-name-${idx}" placeholder="Assignment name" />
            </div>
            <div class="form-group">
              <label for="hypo-score-${idx}">Score</label>
              <input id="hypo-score-${idx}" type="number" min="0" step="0.1" placeholder="Score" />
            </div>
            <div class="form-group">
              <label for="hypo-outof-${idx}">Out of</label>
              <input id="hypo-outof-${idx}" type="number" min="0" step="0.1" placeholder="Out of" />
            </div>
          </div>
          <div class="actions">
            <button class="btn btn-primary" onclick="addHypo(${idx})">🧮 Calculate</button>
            <button class="btn btn-secondary" onclick="toggleHypo(${idx})">Cancel</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ---------- DOM helpers ----------
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Global actions for inline handlers
window.toggleAssignments = (idx) => {
  const el = document.getElementById(`assign-list-${idx}`);
  if (el) el.classList.toggle('hidden');
};
window.toggleHypo = (idx) => {
  const el = document.getElementById(`hypo-${idx}`);
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
  renderClasses(temp);
  renderStudentHeader(temp);
  toast(`New grade for ${temp.classes[idx].name}: ${temp.classes[idx].grade}%`, 'success');
};

// ---------- Filters ----------
function applyFilters() {
  if (!currentData) return;
  const q = searchInput.value.trim().toLowerCase();
  const sort = sortSelect.value;

  let result = [...currentData.classes];

  if (q) {
    result = result.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.teacher.toLowerCase().includes(q) ||
      c.section.toLowerCase().includes(q)
    );
  }

  switch (sort) {
    case 'name-asc': result.sort((a,b) => a.name.localeCompare(b.name)); break;
    case 'name-desc': result.sort((a,b) => b.name.localeCompare(a.name)); break;
    case 'grade-desc': result.sort((a,b) => (b.grade||0) - (a.grade||0)); break;
    case 'grade-asc': result.sort((a,b) => (a.grade||0) - (b.grade||0)); break;
  }

  filteredData = { student: currentData.student, classes: result };
  renderClasses(filteredData);
}

searchInput.addEventListener('input', applyFilters);
sortSelect.addEventListener('change', applyFilters);

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
    toolsBar.classList.remove('hidden');

    renderStudentHeader(currentData);
    renderClasses(currentData);
    applyFilters();
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Login failed', '❌');
    toast(err.message || 'Login failed', 'error');
  } finally {
    loginBtn.disabled = false;
  }
});

loadSampleBtn.addEventListener('click', () => {
  currentData = {
    student: { name: 'Alex Rivera', id: '123456' },
    classes: [
      {
        name: 'AP Calculus AB',
        section: 'Period 1',
        teacher: 'Ms. Johnson',
        credits: 1,
        grade: 93,
        assignments: [
          { name: 'Unit 4 Quiz', score: 18, outOf: 20 },
          { name: 'Homework 12', score: 10, outOf: 10 },
          { name: 'Chapter Test', score: 44, outOf: 50 }
        ]
      },
      {
        name: 'English 11',
        section: 'Period 2',
        teacher: 'Mr. Lewis',
        credits: 1,
        grade: 87,
        assignments: [
          { name: 'Essay Draft', score: 42, outOf: 50 },
          { name: 'Reading Quiz', score: 9, outOf: 10 },
          { name: 'Presentation', score: 18, outOf: 20 }
        ]
      },
      {
        name: 'Physics',
        section: 'Period 3',
        teacher: 'Dr. Chen',
        credits: 1,
        grade: 78,
        assignments: [
          { name: 'Lab Report', score: 34, outOf: 50 },
          { name: 'Homework Set 5', score: 14, outOf: 20 },
          { name: 'Kinematics Quiz', score: 16, outOf: 20 }
        ]
      },
      {
        name: 'US History',
        section: 'Period 4',
        teacher: 'Ms. Patel',
        credits: 1,
        grade: 91,
        assignments: [
          { name: 'DBQ Essay', score: 46, outOf: 50 },
          { name: 'Map Quiz', score: 19, outOf: 20 },
          { name: 'Project', score: 28, outOf: 30 }
        ]
      }
    ]
  };

  studentHeader.classList.remove('hidden');
  toolsBar.classList.remove('hidden');
  renderStudentHeader(currentData);
  renderClasses(currentData);
  applyFilters();
  setStatus('Loaded sample data (demo)', '📊');
  toast('Sample data loaded', 'success');
});

// ---------- Init ----------
restoreInputs();
// initial skeleton remains until data loads