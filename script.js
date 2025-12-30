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
const globalHypoToggle = document.getElementById('globalHypo');

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
let globalHypo = false;

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
  if (num === null || num === undefined) return 'N/A';
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
  if (!a || a.outOf === 0 || a.outOf === null || a.outOf === undefined) return false;
  return true;
}
function computeCategoryPerc(assignments) {
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
function normalizeWeights(weights) {
  const entries = Object.entries(weights || {}).filter(([, w]) => typeof w === 'number' && w > 0);
  if (!entries.length) return {};
  const sum = entries.reduce((acc, [, w]) => acc + w, 0);
  const denom = sum > 1.001 ? sum : 1; // treat <=1 as already fractional
  const norm = {};
  for (const [k, w] of entries) norm[k] = w / denom;
  return norm;
}
function computeWeightedGrade(categoryPerc, weights) {
  const norm = normalizeWeights(weights);
  let sum = 0;
  let total = 0;
  for (const k of Object.keys(categoryPerc)) {
    const w = norm[k] ?? norm[k?.toLowerCase()] ?? 0;
    const pct = categoryPerc[k].pct;
    if (w > 0 && categoryPerc[k].possible > 0) {
      sum += pct * w;
      total += w;
    }
  }
  if (!total) return null;
  return sum;
}

// ---------- Backend ----------
async function callBackend({ studentNumber, password, domain, reportPeriod = '', childInt = '0' }) {
  const body = { domain, username: studentNumber, password, reportPeriod, childIntID: childInt };
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const errText = await resp.text();
    let errMsg = 'Request failed';
    try {
      const err = JSON.parse(errText);
      errMsg = err.error || err.details || errMsg;
    } catch { errMsg = errText; }
    throw new Error(errMsg);
  }
  return resp.json(); // { success, data, student, periods }
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

  // Courses
  const courseNodes = xmlDoc.querySelectorAll('Course');
  const classes = Array.from(courseNodes).map(course => {
    const name = course.getAttribute('Title') || 'Unknown Course';
    const period = course.getAttribute('Period') || '';
    const teacher = course.getAttribute('Staff') || '';

    // Prefer current mark
    const marks = Array.from(course.querySelectorAll('Mark'));
    let currentMark =
      marks.find(m => (m.getAttribute('IsCurrent') || m.getAttribute('IsCurrentReportingPeriod')) === 'true') ||
      marks[marks.length - 1] ||
      null;

    const gradeStrRaw = currentMark?.getAttribute('CalculatedScoreString') || '';
    const gradeNum = gradeStrRaw && !isNaN(parseFloat(gradeStrRaw)) ? parseFloat(gradeStrRaw) : null;

    // Category weights
    const weights = {};
    currentMark?.querySelectorAll('AssignmentType, Category').forEach(node => {
      const typeName = node.getAttribute('Type') || node.getAttribute('Name') || '';
      const raw = node.getAttribute('Weight') || node.getAttribute('PointsPossibleWeight') || '';
      const n = parseFloat(String(raw).replace('%','').trim());
      if (typeName && !isNaN(n) && n > 0) weights[typeName] = n;
    });

    // Assignments
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

      const graded = isGraded({ score, outOf });
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

    const categoryPerc = computeCategoryPerc(assignments);

    // If StudentVUE grade missing, compute weighted from categories
    const fallbackWeighted = computeWeightedGrade(categoryPerc, weights);

    return {
      name,
      section: period ? `Period ${period}` : 'N/A',
      teacher,
      credits: 1,
      gradeStr: gradeStrRaw,
      gradeNum: gradeNum ?? fallbackWeighted ?? null,
      assignments,
      categoryPerc,
      weights,
      hypoAssignments: [],      // added hypotheticals
      hypoOverrides: {},        // assignmentIndex -> {score,outOf}
      open: false               // expanded state
    };
  });

  return { classes };
}

// ---------- Render ----------
function renderStudentHeader(meta, data) {
  studentNameEl.textContent = meta?.name || 'Student';
  studentIdEl.textContent = meta?.id ? `ID ${meta.id}` : 'ID —';

  statClassesEl.textContent = (data?.classes?.length || 0).toString();
  const allAssignments = (data?.classes || []).reduce((acc, c) => acc + c.assignments.length + c.hypoAssignments.length, 0);
  statAssignmentsEl.textContent = allAssignments.toString();

  const graded = (data?.classes || []).filter(c => c.gradeNum !== null);
  const avg = graded.length ? graded.reduce((acc, c) => acc + c.gradeNum, 0) / graded.length : null;
  statAvgEl.textContent = avg === null ? '—' : `${avg.toFixed(2)}%`;
}

function categoryLine(catName, catObj, weightsNorm) {
  const wFrac = (weightsNorm[catName] ?? weightsNorm[catName?.toLowerCase()] ?? 0);
  const weightLabel = wFrac ? `${(wFrac * 100).toFixed(0)}% of total` : 'Weight —';
  const rawPct = catObj?.pct ?? null;
  const contrib = rawPct != null ? rawPct * wFrac : null;
  return `
    <div class="category-pill">
      <span class="category-name">${escapeHtml(catName || 'Uncategorized')}</span>
      <span class="category-weight">${weightLabel}</span>
      <span class="category-earned">${contrib == null ? '—' : `${contrib.toFixed(1)}% of total`}</span>
      <span class="category-pct">${rawPct == null ? '—' : `${rawPct.toFixed(1)}%`}</span>
    </div>
  `;
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
    // Always show class grade
    let displayNum;
    let displayStr;

    if (globalHypo && cls.open) {
      const effective = buildEffectiveAssignments(cls);
      const catPerc = computeCategoryPerc(effective);
      const weighted = computeWeightedGrade(catPerc, cls.weights);
      displayNum = weighted ?? cls.gradeNum ?? null;
      displayStr = displayNum == null ? '—' : `${displayNum.toFixed(2)}%`;
    } else {
      displayNum = cls.gradeNum ?? null;
      displayStr = displayNum == null
        ? '—'
        : (cls.gradeStr ? `${cls.gradeStr}%` : `${displayNum.toFixed(2)}%`);
    }

    const letter = gradeLetter(displayNum);
    const barWidth = displayNum == null ? 0 : Math.max(0, Math.min(100, displayNum));

    // Effective categories for display (respect global hypo only while open)
    const effectiveCats = (() => {
      if (globalHypo && cls.open) {
        const eff = buildEffectiveAssignments(cls);
        return computeCategoryPerc(eff);
      }
      return cls.categoryPerc;
    })();

    const norm = normalizeWeights(cls.weights);
    const allCats = new Set([...Object.keys(effectiveCats || {}), ...Object.keys(cls.weights || {})]);
    const categoriesHtml = Array.from(allCats).map(cat => categoryLine(cat, effectiveCats[cat], norm)).join('');

    const assignmentsHtml = buildAssignmentListHtml(cls, idx);

    return `
      <div class="class-row" onclick="toggleDetails(${idx})">
        <div>
          <div class="class-title">${escapeHtml(cls.name)}</div>
        </div>
        <div class="class-right">
          <span class="grade-letter">${letter}</span>
          <span class="grade-percent">${displayStr}</span>
          <div class="progress">
            <div class="progress-fill" style="width:${barWidth}%"></div>
            <div class="progress-trail"></div>
          </div>
        </div>

        <div id="details-${idx}" class="class-details ${cls.open ? '' : 'hidden'}" onclick="event.stopPropagation()">
          <div class="details-head">
            <div class="detail-meta">${escapeHtml(cls.teacher)} • ${escapeHtml(cls.section)} • ${cls.credits} credit</div>
            <button class="btn btn-outline" onclick="collapseClass(${idx})">Close</button>
          </div>

          <div class="category-list">
            ${categoriesHtml || '<div class="category-pill"><span class="category-name">No categories</span><span class="category-weight">Weight —</span><span class="category-earned">—</span><span class="category-pct">—</span></div>'}
          </div>

          <div class="assignments">
            <div class="assignment-list">
              ${assignmentsHtml || `<div class="assignment"><div><div class="assignment-name">No assignments</div></div></div>`}
            </div>
          </div>

          <div class="hypo-form">
            <div class="hypo-actions">
              <span>Hypothetical tools (apply while this class is open)</span>
            </div>

            <!-- Add hypothetical assignment -->
            <div class="hypo-grid">
              <input id="hypo-name-${idx}" placeholder="Assignment name" />
              <select id="hypo-cat-${idx}">
                ${realCategoryOptions(cls)}
              </select>
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

function realCategoryOptions(cls) {
  const cats = Object.keys(cls.weights || {});
  if (!cats.length) return `<option value="">Uncategorized</option>`;
  return cats.map(c => `<option>${escapeHtml(c)}</option>`).join('');
}

function buildAssignmentListHtml(cls, idx) {
  const eff = buildEffectiveAssignments(cls); // use overrides for display flags
  return eff.map((a, aIdx) => {
    const pct = a.pct;
    const scoreClass =
      pct === null || isNaN(pct) ? 'score-neutral' :
      pct >= 90 ? 'score-good' :
      pct >= 80 ? 'score-warn' : 'score-bad';
    const pctStr = pct === null || isNaN(pct) ? 'Not graded' : `${pct.toFixed(1)}%`;

    // If original ungraded and override missing, allow inline hypothetical entry for that assignment
    const original = cls.assignments[aIdx];
    const canInlineHypo = original && !isGraded(original);

    const inlineHypo = canInlineHypo ? `
      <div style="display:flex; gap:8px; align-items:center; margin-top:6px;">
        <input id="hypo-ov-score-${idx}-${aIdx}" type="number" min="0" step="0.1" placeholder="Hypo score" style="width:120px; padding:8px; border-radius:8px; border:1px solid var(--border); background:var(--bg-elev); color:var(--text);" />
        <input id="hypo-ov-outof-${idx}-${aIdx}" type="number" min="0" step="0.1" placeholder="Out of" style="width:120px; padding:8px; border-radius:8px; border:1px solid var(--border); background:var(--bg-elev); color:var(--text);" />
        <button class="btn btn-outline" onclick="applyHypoOverride(${idx}, ${aIdx})">Apply</button>
        ${cls.hypoOverrides[aIdx] ? `<button class="btn btn-danger hypo-delete" onclick="removeHypoOverride(${idx}, ${aIdx})">Remove</button>` : ''}
      </div>
    ` : '';

    const isHypoAdded = a.__hypo === true;
    const deleteHypoButton = isHypoAdded
      ? `<button class="btn btn-danger hypo-delete" onclick="deleteHypo(${idx}, ${aIdx})">Remove</button>`
      : '';

    return `
      <div class="assignment">
        <div>
          <div class="assignment-name">${escapeHtml(a.name)}${isHypoAdded ? ' (Hypothetical)' : ''}</div>
          <div class="assignment-meta">
            ${escapeHtml(a.category || 'Uncategorized')}
            ${a.dueDate ? ' • Due ' + escapeHtml(a.dueDate) : ''}
            • ${a.outOf ? `${a.score} / ${a.outOf} points` : 'No points'}
          </div>
          ${inlineHypo}
        </div>
        <div>
          <div class="assignment-score ${scoreClass}">${pctStr}</div>
          ${deleteHypoButton}
        </div>
      </div>
    `;
  }).join('');
}

// Build effective assignments list for calculations and display
function buildEffectiveAssignments(cls) {
  // Start with originals, apply overrides for ungraded items
  const base = cls.assignments.map((a, idx) => {
    const ov = cls.hypoOverrides[idx];
    if (ov && !isGraded(a)) {
      const score = Number(ov.score) || 0;
      const outOf = Number(ov.outOf) || 0;
      const graded = outOf > 0;
      return {
        name: a.name,
        category: a.category,
        dueDate: a.dueDate,
        score,
        outOf,
        graded,
        pct: graded ? (score / outOf) * 100 : null
      };
    }
    return a;
  });

  // Add hypothetical assignments (no date)
  const added = cls.hypoAssignments.map(h => ({
    name: h.name,
    category: h.category,
    dueDate: '', // per requirement
    score: Number(h.score) || 0,
    outOf: Number(h.outOf) || 0,
    graded: (Number(h.outOf) || 0) > 0,
    pct: (Number(h.outOf) || 0) > 0 ? (Number(h.score) / Number(h.outOf)) * 100 : null,
    __hypo: true
  }));

  return [...base, ...added];
}

// ---------- Interactions ----------
window.toggleDetails = (idx) => {
  const cls = currentData.classes[idx];
  cls.open = !cls.open;
  renderClassList(currentData);
};
window.collapseClass = (idx) => {
  const cls = currentData.classes[idx];
  cls.open = false;
  // Reset view to exclude hypotheticals once collapsed
  renderClassList(currentData);
};

window.addHypo = (idx) => {
  const name = document.getElementById(`hypo-name-${idx}`).value.trim() || 'Hypothetical Assignment';
  const category = document.getElementById(`hypo-cat-${idx}`).value || '';
  const score = parseFloat(document.getElementById(`hypo-score-${idx}`).value);
  const outOf = parseFloat(document.getElementById(`hypo-outof-${idx}`).value);

  if (isNaN(score) || isNaN(outOf) || outOf <= 0) {
    toast('Enter valid score and total points', 'error');
    return;
  }
  currentData.classes[idx].hypoAssignments.push({ name, category, score, outOf });

  renderStudentHeader(currentData.meta, currentData);
  renderClassList(currentData);
  setTimeout(() => {
    const el = document.getElementById(`details-${idx}`);
    if (el && el.classList.contains('hidden')) el.classList.remove('hidden');
  }, 0);
};

window.deleteHypo = (idx, effIndex) => {
  const cls = currentData.classes[idx];
  // effIndex indexes into effective list; originals come first.
  const originalsLen = cls.assignments.length;
  const hypoIdx = effIndex - originalsLen;
  if (hypoIdx >= 0 && hypoIdx < cls.hypoAssignments.length) {
    cls.hypoAssignments.splice(hypoIdx, 1);
    renderClassList(currentData);
  }
};

window.applyHypoOverride = (idx, aIdx) => {
  const scoreEl = document.getElementById(`hypo-ov-score-${idx}-${aIdx}`);
  const outEl = document.getElementById(`hypo-ov-outof-${idx}-${aIdx}`);
  const score = parseFloat(scoreEl.value);
  const outOf = parseFloat(outEl.value);
  if (isNaN(score) || isNaN(outOf) || outOf <= 0) {
    toast('Enter valid hypothetical score and total points', 'error');
    return;
  }
  currentData.classes[idx].hypoOverrides[aIdx] = { score, outOf };
  renderClassList(currentData);
};

window.removeHypoOverride = (idx, aIdx) => {
  delete currentData.classes[idx].hypoOverrides[aIdx];
  renderClassList(currentData);
};

// Global hypothetical toggle
globalHypoToggle.addEventListener('change', () => {
  globalHypo = globalHypoToggle.checked;
  renderClassList(currentData);
});

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
    const resp = await callBackend({ studentNumber, password, domain, reportPeriod: currentPeriod, childInt: childIntID });
    const parsed = parseStudentVueXML(resp.data);
    currentData = { ...parsed, meta: resp.student };
    childIntID = resp.student?.childIntID || childIntID;
    // Select active period if present in response; otherwise keep user selection
    const active = (resp.periods || []).find(p => p.active);
    if (active) {
      currentPeriod = active.name;
      periodSelect.value = active.name;
    }

    renderStudentHeader(currentData.meta, currentData);
    renderPeriods(resp.periods);
    renderClassList(currentData);
    setStatus('Refreshed');
    toast('Grades refreshed', 'success');
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Refresh failed');
    toast(err.message || 'Refresh failed', 'error');
  }
}

// ---------- Periods ----------
function renderPeriods(periods) {
  toolsBar.classList.remove('hidden');
  const opts = (periods || []).map(p => `<option value="${escapeHtml(p.name)}"${p.active ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  periodSelect.innerHTML = opts || '<option>No periods</option>';
  periodSelect.disabled = !(periods && periods.length);
  const active = (periods || []).find(p => p.active);
  currentPeriod = active ? active.name : (periods?.[0]?.name || '');
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
    const resp = await callBackend({ studentNumber, password, domain, reportPeriod: '', childInt: '0' });
    const parsed = parseStudentVueXML(resp.data);
    currentData = { ...parsed, meta: resp.student };
    childIntID = resp.student?.childIntID || '0';
    persistInputs();

    renderStudentHeader(currentData.meta, currentData);
    renderPeriods(resp.periods);
    renderClassList(currentData);
    studentHeader.classList.remove('hidden');
    toolsBar.classList.remove('hidden');

    setStatus(`Loaded grades for ${currentData.meta?.name || 'Student'} (${currentData.meta?.id || 'ID —'})`);
    toast('Grades loaded successfully', 'success');
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
