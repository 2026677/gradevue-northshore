// ---------- Configuration ----------
const API_URL = 'https://gradevue-northshore.vercel.app/api/gradebook';

// ---------- Elements ----------
const statusEl = document.getElementById('status');
const loginBtn = document.getElementById('loginBtn');
const loginForm = document.getElementById('loginForm');
const classListEl = document.getElementById('classList');
const toastHost = document.getElementById('toastHost');

const studentHeader = document.getElementById('studentHeader');
const toolsBar = document.getElementById('toolsBar');
const periodSelect = document.getElementById('periodSelect');
const refreshBtn = document.getElementById('refreshBtn');

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
let currentPeriod = '';
let childIntID = '0';

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
function gradeLetter(num) {
  if (num === null) return 'N/A';
  if (num >= 90) return 'A';
  if (num >= 80) return 'B';
  if (num >= 70) return 'C';
  if (num >= 60) return 'D';
  return 'F';
}
function parseDate(str) {
  if (!str) return '';
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`;
}
function isGraded(a) {
  // Not graded if possible points missing or zero, or explicit flag/labels
  if (!a || a.outOf === 0 || a.outOf === null || a.outOf === undefined) return false;
  const scoreStr = String(a.score ?? '');
  const measureStr = String(a.name ?? '');
  return !(scoreStr.toLowerCase().includes('not graded') || measureStr.toLowerCase().includes('not graded'));
}
function computeCategoryPerc(assignments) {
  // Returns map: { category: { earned, possible, pct } } excluding non-graded
  const cat = {};
  for (const a of assignments) {
    if (!isGraded(a)) continue;
    const k = a.category || 'Uncategorized';
    if (!cat[k]) cat[k] = { earned: 0, possible: 0, pct: 0 };
    cat[k].earned += Number(a.score) || 0;
    cat[k].possible += Number(a.outOf) || 0;
  }
  for (const k in cat) {
    cat[k].pct = cat[k].possible ? (cat[k].earned / cat[k].possible) * 100 : 0;
  }
  return cat;
}
function computeWeightedGrade(categoryPerc, weights) {
  // weights: { category: weightNumber } in percent or fraction
  let totalWeight = 0;
  let sum = 0;
  for (const k of Object.keys(categoryPerc)) {
    const w = (weights[k] ?? weights[k.toLowerCase()] ?? 0);
    const pct = categoryPerc[k].pct;
    if (w > 0 && categoryPerc[k].possible > 0) {
      sum += pct * w;
      totalWeight += w;
    }
  }
  if (!totalWeight) return null; // N/A
  // If weights are percentages (e.g., 20, 30), normalize
  if (totalWeight > 1.001) {
    return sum / totalWeight;
  }
  // If weights are fractions (sum ~1), sum already weighted
  return sum;
}

// ---------- API ----------
async function fetchGradebook({ studentNumber, password, domain, reportPeriod = '', childInt = '0' }) {
  const body = { domain, username: studentNumber, password, reportPeriod, childIntID: childInt };
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
  return result.data || '';
}

// ---------- XML Parser ----------
function parseStudentVueXML(xmlString) {
  if (!xmlString || typeof xmlString !== 'string' || !xmlString.trim()) {
    throw new Error('Invalid XML response');
  }
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) throw new Error('Invalid XML response');

  // Student info
  const studentInfo = xmlDoc.querySelector('StudentInfo');
  const studentName = studentInfo?.getAttribute('StudentName') || (studentNumberInput.value ? `Student ${studentNumberInput.value}` : 'Student');
  const studentId = studentInfo?.getAttribute('StudentNumber') || studentNumberInput.value || '';
  childIntID = studentInfo?.getAttribute('ChildIntID') || childIntID;

  // Report periods list (try multiple structures)
  const reportPeriods = [];
  xmlDoc.querySelectorAll('ReportPeriod').forEach(rp => {
    const name = rp.getAttribute('Name') || rp.textContent || '';
    if (name) reportPeriods.push(name);
  });
  if (reportPeriods.length === 0) {
    xmlDoc.querySelectorAll('Mark').forEach(m => {
      const name = m.getAttribute('MarkName') || m.getAttribute('MarkCalc') || '';
      if (name) reportPeriods.push(name);
    });
  }
  const uniquePeriods = [...new Set(reportPeriods)];

  // Courses
  const courseNodes = xmlDoc.querySelectorAll('Course');
  const classes = Array.from(courseNodes).map(course => {
    const name = course.getAttribute('Title') || 'Unknown Course';
    const period = course.getAttribute('Period') || '';
    const teacher = course.getAttribute('Staff') || '';
    const marks = course.querySelectorAll('Mark');
    const currentMark = marks.length ? marks[marks.length - 1] : null;

    // Category weights
    const weights = {};
    currentMark?.querySelectorAll('AssignmentType, Category').forEach(node => {
      const typeName = node.getAttribute('Type') || node.getAttribute('Name') || '';
      const weightRaw = node.getAttribute('Weight') || node.getAttribute('PointsPossibleWeight') || node.textContent || '';
      const w = parseFloat(String(weightRaw).replace('%','').trim());
      if (typeName && !isNaN(w)) {
        weights[typeName] = w;
      }
    });

    // Most precise decimal from StudentVUE
    const gradeStrRaw = currentMark?.getAttribute('CalculatedScoreString') || '';
    const gradeNum = gradeStrRaw && !isNaN(parseFloat(gradeStrRaw)) ? parseFloat(gradeStrRaw) : null;

    // Assignments (with category + dates)
    const assignmentNodes = currentMark ? currentMark.querySelectorAll('Assignment') : [];
    const assignments = Array.from(assignmentNodes).map(assign => {
      const pointsStr = assign.getAttribute('Points') || '';
      let score = NaN, outOf = NaN;
      if (pointsStr.includes('/')) {
        const [s, o] = pointsStr.split('/').map(p => parseFloat(p.trim()));
        score = isNaN(s) ? 0 : s;
        outOf = isNaN(o) ? 0 : o;
      } else {
        const s = parseFloat(assign.getAttribute('Score') || assign.getAttribute('PointsEarned') || '0');
        const o = parseFloat(assign.getAttribute('MaxScore') || assign.getAttribute('PointsPossible') || '0');
        score = isNaN(s) ? 0 : s;
        outOf = isNaN(o) ? 0 : o;
      }

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

      const graded = isGraded({ score, outOf, name: assign.getAttribute('Measure') || '' });
      const pct = graded && outOf ? (score / outOf) * 100 : null;

      return {
        name: assign.getAttribute('Measure') || 'Assignment',
        category,
        dueDate: parseDate(dueDateRaw),
        score,
        outOf,
        graded,
        pct
      };
    });

    // Category grade map
    const categoryPerc = computeCategoryPerc(assignments);

    return {
      name,
      section: period ? `Period ${period}` : 'N/A',
      teacher,
      credits: 1,
      gradeStr: gradeStrRaw,
      gradeNum,       // null if N/A
      assignments,
      categoryPerc,   // {cat:{earned,possible,pct}}
      weights,        // {cat: weight}
      hypoAssignments: [],
      hypoMode: false
    };
  });

  return { student: { name: studentName, id: studentId }, classes, periods: uniquePeriods };
}

// ---------- Render ----------
function renderStudentHeader(data) {
  studentNameEl.textContent = data.student.name || 'Student';
  studentIdEl.textContent = data.student.id ? `ID ${data.student.id}` : 'ID —';
  statClassesEl.textContent = data.classes.length.toString();
  const allAssignments = data.classes.reduce((acc, c) => acc + c.assignments.length + c.hypoAssignments.length, 0);
  statAssignmentsEl.textContent = allAssignments.toString();

  // Average excludes N/A
  const graded = data.classes.filter(c => c.gradeNum !== null);
  const avg = graded.length ? graded.reduce((acc, c) => acc + c.gradeNum, 0) / graded.length : null;
  statAvgEl.textContent = avg === null ? '—' : `${avg.toFixed(2)}%`;
}

function renderPeriods(periods) {
  toolsBar.classList.remove('hidden');
  periodSelect.innerHTML = periods.length ? periods.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('') : '<option>No periods</option>';
  periodSelect.disabled = !periods.length;
  if (!currentPeriod && periods.length) currentPeriod = periods[0];
  if (currentPeriod) periodSelect.value = currentPeriod;
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
    // Display grade only when hypothetical mode is enabled; otherwise hide
    let displayGradeNum = null;
    let displayGradeStr = '—';

    if (cls.hypoMode) {
      const combined = [...cls.assignments, ...cls.hypoAssignments];
      const catPerc = computeCategoryPerc(combined);
      const hypoWeighted = computeWeightedGrade(catPerc, cls.weights);
      if (hypoWeighted === null) {
        displayGradeNum = null;
        displayGradeStr = '—';
      } else {
        displayGradeNum = hypoWeighted;
        displayGradeStr = `${hypoWeighted.toFixed(2)}%`;
      }
    }

    const letter = gradeLetter(displayGradeNum);
    const barWidth = displayGradeNum === null ? 0 : Math.max(0, Math.min(100, displayGradeNum));

    // Category pills (show to nearest tenth; weight display if available)
    const categoriesHtml = (() => {
      const allCategories = new Set([
        ...Object.keys(cls.categoryPerc || {}),
        ...Object.keys(cls.weights || {})
      ]);
      return Array.from(allCategories).map(cat => {
        const pctObj = cls.hypoMode
          ? computeCategoryPerc([...cls.assignments, ...cls.hypoAssignments])[cat]
          : cls.categoryPerc[cat];
        const pct = pctObj ? pctObj.pct : null;
        const weight = cls.weights[cat];
        return `
          <div class="category-pill">
            <span class="category-name">${escapeHtml(cat || 'Uncategorized')}</span>
            <span class="category-weight">${weight ? `Weight ${weight}${weight <= 1.001 ? '' : '%'}` : 'Weight —'}</span>
            <span class="category-pct">${pct === null || isNaN(pct) ? '—' : `${pct.toFixed(1)}%`}</span>
          </div>
        `;
      }).join('');
    })();

    const assignmentsHtml = [...cls.assignments, ...cls.hypoAssignments].map(a => {
      const pct = a.pct;
      const scoreClass =
        pct === null || isNaN(pct) ? 'score-neutral' :
        pct >= 90 ? 'score-good' :
        pct >= 80 ? 'score-warn' : 'score-bad';
      const pctStr = pct === null || isNaN(pct) ? 'Not graded' : `${pct.toFixed(1)}%`;
      return `
        <div class="assignment">
          <div>
            <div class="assignment-name">${escapeHtml(a.name)}</div>
            <div class="assignment-meta">
              ${escapeHtml(a.category || 'Uncategorized')}
              ${a.dueDate ? ' • Due ' + escapeHtml(a.dueDate) : ''}
              • ${a.outOf ? `${a.score} / ${a.outOf} points` : 'No points'}
            </div>
          </div>
          <div class="assignment-score ${scoreClass}">${pctStr}</div>
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
            <button class="btn btn-outline" onclick="toggleDetails(${idx})">Close</button>
          </div>

          <div class="category-list">
            ${categoriesHtml || '<div class="category-pill"><span class="category-name">No categories</span><span class="category-weight">Weight —</span><span class="category-pct">—</span></div>'}
          </div>

          <div class="assignments">
            <div class="assignment-list">
              ${assignmentsHtml || `<div class="assignment"><div><div class="assignment-name">No assignments</div></div></div>`}
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
    name, category, dueDate: parseDate(dueDateRaw), score, outOf, graded: true, pct: (score/outOf)*100
  });

  renderStudentHeader(currentData);
  renderClassList(currentData);
  setTimeout(() => {
    const el = document.getElementById(`details-${idx}`);
    if (el && el.classList.contains('hidden')) el.classList.remove('hidden');
  }, 0);
};

// Period change + refresh
periodSelect.addEventListener('change', async () => {
  currentPeriod = periodSelect.value;
  await refetchPeriod();
});
refreshBtn.addEventListener('click', async () => {
  await refetchPeriod();
});

async function refetchPeriod() {
  if (!currentPeriod) return;
  const studentNumber = studentNumberInput.value.trim();
  const password = passwordInput.value;
  const domain = domainInput.value.trim();
  try {
    setStatus('Refreshing…');
    const xml = await fetchGradebook({ studentNumber, password, domain, reportPeriod: currentPeriod, childInt: childIntID });
    const parsed = parseStudentVueXML(xml);
    // Keep hypo state per class name if possible
    if (currentData) {
      for (const cls of parsed.classes) {
        const prev = currentData.classes.find(c => c.name === cls.name);
        if (prev) {
          cls.hypoAssignments = prev.hypoAssignments || [];
          cls.hypoMode = prev.hypoMode || false;
        }
      }
    }
    currentData = parsed;
    renderStudentHeader(currentData);
    renderPeriods(parsed.periods);
    renderClassList(currentData);
    setStatus('Refreshed');
    toast('Grades refreshed', 'success');
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Refresh failed');
    toast(err.message || 'Refresh failed', 'error');
  }
}

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
    const xml = await fetchGradebook({ studentNumber, password, domain, reportPeriod: '', childInt: '0' });
    const parsed = parseStudentVueXML(xml);
    currentData = parsed;
    persistInputs();
    setStatus(`Loaded grades for ${parsed.student.name} (${parsed.student.id || 'ID —'})`);
    toast('Grades loaded successfully', 'success');

    studentHeader.classList.remove('hidden');
    renderStudentHeader(currentData);
    renderPeriods(parsed.periods);
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
