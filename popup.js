// MV3 popup for reviewing today's Todoist tasks with grouped labels + calendar date (robust updates)
const API_BASE = 'https://api.todoist.com/rest/v2';
const KEY = 'pmd_todoist_token_v1';
const APP_BASE = 'https://app.todoist.com';

// Screens
const scrStart = document.getElementById('screen-start');
const scrToken = document.getElementById('screen-token');
const scrTask  = document.getElementById('screen-task');
const scrDone  = document.getElementById('screen-done');
const scrFocus = document.getElementById('screen-focus');

// Controls
const planBtn = document.getElementById('planBtn');
const saveTokenBtn = document.getElementById('saveToken');
const tokenInput = document.getElementById('tokenInput');
const submitUpdateBtn = document.getElementById('submitUpdate');
const skipTaskBtn = document.getElementById('skipTask');
const restartBtn = document.getElementById('restart');
const statusEl = document.getElementById('status');
const taskCounterEl = document.getElementById('taskCounter');
const prevTaskBtn = document.getElementById('prevTask');
const deleteTaskBtn = document.getElementById('deleteTask');
const doneTaskBtn = document.getElementById('doneTask');
const focusStartBtn = document.getElementById('focusStartBtn');
const focusMinutesSel = document.getElementById('focusMinutes');
// back button removed
const focusCloseTaskBtn = document.getElementById('focusCloseTask');
const focusTaskTitleEl = document.getElementById('focusTaskTitle');
const focusTimerEl = document.getElementById('focusTimer');
const focusStatusEl = document.getElementById('focusStatus');
const focusSubtasksEl = document.getElementById('focusSubtasks');
const chartTooltipEl = document.getElementById('chartTooltip');
// Search
const scrSearch = document.getElementById('screen-search');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchList = document.getElementById('searchList');
const backHomeBtn = document.getElementById('backHome');
const searchHeader = document.getElementById('searchHeader');


// Task UI
const taskTitleEl = document.getElementById('taskTitle');
const taskMetaEl  = document.getElementById('taskMeta');

// Calendar controls
// const openCalendarBtn = document.getElementById('openCalendar');
// const customDateInput = document.getElementById('customDate');
// const customDateLabel = document.getElementById('customDateLabel');

let tasks = [];
let idx = 0;
let token = '';
let customDateISO = null; // YYYY-MM-DD
let labelIndexByName = new Map(); // name -> id
let labelNameById = new Map(); // id -> name
let projectIdToName = new Map(); // id -> name
let cameFromSearch = false; // whether current task view was opened from search
let cameFromTop5 = false;   // whether current task view was opened from Top 5

const nudgeRow = null;
const nudgeContinueBtn = null;
const nudgeStopBtn = null;

const focusPauseBtn = document.getElementById('focusPause');
const focusStopBtn = document.getElementById('focusStop');
const focusMinutesInput = document.getElementById('focusMinutesInput');

function show(el){
  [scrStart, scrToken, scrTask, scrDone, scrSearch, scrFocus].forEach(s => s && s.classList.add('hidden'));
  el && el.classList.remove('hidden');
  // Widen popup only for task review to reduce vertical overflow
  if (el === scrTask) {
    document.body.classList.add('is-task');
  } else {
    document.body.classList.remove('is-task');
  }
}
function qAll(sel){ return Array.from(document.querySelectorAll(sel)); }

function setDateControlsEnabled(enabled){
  qAll('input[name="dateChoice"]').forEach(r => { r.disabled = !enabled; });
  // calendar removed
}

// Token storage
function getToken(){
return new Promise(res => chrome.storage.sync.get([KEY], r => res(r[KEY] || '')));
}
function setToken(v){
return new Promise(res => chrome.storage.sync.set({ [KEY]: v }, res));
}

// ----- Date helpers (timezone-safe) -----
function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); // strip time
  x.setDate(x.getDate() + n);
  return x;
}
function toLocalISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`; // YYYY-MM-DD
}
function nextWeekdayISO(targetDow /* 0=Sun..6=Sat */) {
  const now = new Date();
  const todayDow = now.getDay();
  let delta = (targetDow - todayDow + 7) % 7;
  if (delta === 0) delta = 7; // “next” => next week if today is that day
  return toLocalISO(addDays(now, delta));
}
function presetChoiceToISO(choice) {
  const now = new Date();
  switch (choice) {
    case 'today':         return toLocalISO(now);
    case 'tomorrow':      return toLocalISO(addDays(now, 1));
    case 'next_mon':      return nextWeekdayISO(1);
    case 'next_tue':      return nextWeekdayISO(2);
    case 'next_wed':      return nextWeekdayISO(3);
    case 'next_thu':      return nextWeekdayISO(4);
    case 'next_fri':      return nextWeekdayISO(5);
    case 'next_sat':      return nextWeekdayISO(6);
    case 'next_sun':      return nextWeekdayISO(0);
    case 'next_28th': {
      // 28th of current month if strictly after today; otherwise 28th of next month
      const d = new Date(now.getFullYear(), now.getMonth(), 28);
      const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (d > todayOnly) return toLocalISO(d);
      const d2 = new Date(now.getFullYear(), now.getMonth() + 1, 28);
      return toLocalISO(d2);
    }
    case 'next_1st': {
      const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return toLocalISO(d);
    }
    default:              return toLocalISO(now);
  }
}
function humanDateFromISO(iso) {
  // e.g., "7 Sep 2025"
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

// ----- API helpers -----
async function tdFetch(path, opts){
  const method = (opts && opts.method) ? opts.method : 'GET';
  const body   = (opts && opts.body)   ? opts.body   : undefined;
  if (!token) throw new Error('Missing Todoist token');

  const url = API_BASE + path;
  console.log('=== API REQUEST ===');
  console.log('Method:', method);
  console.log('URL:', url);
  console.log('Body:', body);
  console.log('Token (first 10 chars):', token ? token.substring(0, 10) + '...' : 'NO TOKEN');

  const res = await fetch(url, {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data = null;
  
  console.log('=== API RESPONSE ===');
  console.log('Status:', res.status);
  console.log('Status Text:', res.statusText);
  console.log('Response Text:', text);
  console.log('Response Headers:', Object.fromEntries(res.headers.entries()));
  
  // Handle different response types
  if (res.status === 204) {
    // 204 No Content - successful update, no response body
    console.log('API Response: 204 No Content (success)');
    return { success: true };
  } else if (text) {
    try { 
      data = JSON.parse(text); 
      console.log('Parsed JSON data:', data);
    } catch (_e) { 
      data = text; 
      console.log('Non-JSON response data:', data);
    }
  }

  if (!res.ok) {
    const errorMsg = (data && data.error) ? data.error : ('HTTP ' + res.status + ': ' + text);
    console.error('=== API ERROR ===');
    console.error('Error message:', errorMsg);
    try { console.error('Full response:', JSON.stringify({ status: res.status, statusText: res.statusText, text, data }, null, 2)); } catch(_e){ console.error('Full response:', { status: res.status, statusText: res.statusText }); }
    throw new Error(errorMsg);
  }
  return data;
}

async function appFetch(path, { method='GET', body } = {}){
if (!token) throw new Error('Missing Todoist token');
	const url = APP_BASE + path;
	const res = await fetch(url, {
method,
		headers: {
			'Authorization': 'Bearer ' + token,
			'Content-Type': 'application/json',
			'doist-locale': 'en',
			'doist-os': 'Linux',
			'doist-platform': 'web'
		},
body: body ? JSON.stringify(body) : undefined
});
const text = await res.text();
let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
	if (!res.ok) throw new Error((data && data.error) ? data.error : ('HTTP ' + res.status + ': ' + text));
return data;
}

function getDueTimestamp(task){
  if (!task || !task.due) return Number.POSITIVE_INFINITY;
  const dt = task.due.datetime || task.due.date;
  if (!dt) return Number.POSITIVE_INFINITY;
  const ts = Date.parse(dt);
  return Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
}

async function fetchTodayTasks(){
	const filter = 'overdue | today';
	const data = await tdFetch('/tasks?filter=' + encodeURIComponent(filter));
	console.log('Fetched today+overdue tasks:', data);
	const list = Array.isArray(data) ? data.slice() : [];
	list.sort((a,b) => getDueTimestamp(a) - getDueTimestamp(b));
	console.log('Number of tasks (sorted):', list.length);
	if (list.length > 0) {
		console.log('First task sample:', list[0]);
	}
	return list;
}

async function preloadLabels(){
  const labels = await tdFetch('/labels');
  labelIndexByName.clear();
  labelNameById.clear();
  for (const l of (labels || [])) {
    if (l.name && l.id){
      labelIndexByName.set(l.name.toLowerCase(), l.id);
      labelNameById.set(Number(l.id), String(l.name));
    }
  }
}

async function preloadProjects(){
  const projects = await tdFetch('/projects');
  projectIdToName.clear();
  for (const p of (projects || [])){
    if (p.id && p.name) projectIdToName.set(String(p.id), p.name);
  }
}
async function ensureProjectsLoaded(){
	if (projectIdToName.size === 0){
		try { await preloadProjects(); } catch(_e){}
	}
}

function namesToLabelIds(names){
  const ids = [];
  for (const n of names) {
    const id = labelIndexByName.get(String(n).toLowerCase());
    if (id) ids.push(id);
  }
  return ids;
}

function getTaskLabelIds(task){
  const raw = Array.isArray(task.labels) ? task.labels : (Array.isArray(task.label_ids) ? task.label_ids : []);
  return raw.map(x => Number(x)).filter(x => Number.isFinite(x));
}

async function ensureLabelsExist(names){
  // Refresh current labels to avoid duplicate-create attempts logging errors
  try { await preloadLabels(); } catch(_e) {}
  const unique = Array.from(new Set((names || []).map(s => String(s))));
  for (const n of unique) {
    const key = String(n).toLowerCase();
    if (labelIndexByName.has(key)) continue;
    try {
      // Use a silent direct fetch to avoid noisy error logs for duplicates
      if (!token) throw new Error('Missing Todoist token');
      const res = await fetch(API_BASE + '/labels', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: n })
      });
      const text = await res.text();
      if (res.ok) {
        let created = null; try { created = text ? JSON.parse(text) : null; } catch { created = null; }
        if (created && created.id) {
          labelIndexByName.set(key, created.id);
          labelNameById.set(Number(created.id), String(created.name));
        }
      } else {
        const lower = String(text || '').toLowerCase();
        if (lower.includes('already exists')) {
          // Swallow expected duplicate error
        } else {
          console.warn('Label create issue for', n, text || res.status);
        }
      }
    } catch(e){
      console.warn('Label create exception for', n, String(e && e.message || e));
    }
  }
  // Refresh labels to ensure map is fully in sync after potential creations
  try { await preloadLabels(); } catch(_e) {}
}

async function fetchTaskById(id){
  return await tdFetch('/tasks/' + String(id));
}

async function refreshCurrentTask(){
  const t = tasks[idx];
  if (!t) return;
  try{
    const latest = await fetchTaskById(t.id);
    tasks[idx] = latest || t;
    renderCurrentTask();
  }catch(e){
    console.error('Failed to refresh task', t.id, e);
    // keep old data but re-render
    renderCurrentTask();
  }
}

async function fetchByFilter(filter){
	return await tdFetch('/tasks?filter=' + encodeURIComponent(filter));
}

async function searchTasksByKeyword(keyword){
	const kw = String(keyword || '').trim();
	if (!kw) return [];
	// Try new app endpoint for search
	try{
		const data = await appFetch('/api/v1/completed/search?query=' + encodeURIComponent(kw));
		// The endpoint returns completed matches; we only want active tasks.
		// As a follow-up, also fetch active tasks and filter client-side.
		const all = await tdFetch('/tasks');
		const lower = kw.toLowerCase();
		const activeMatches = (Array.isArray(all) ? all : []).filter(t => t && typeof t.content === 'string' && t.content.toLowerCase().includes(lower));
		return activeMatches.slice(0, 50);
	}catch(e){
		console.warn('app.todoist search failed, using REST fallback:', e?.message || e);
		// Fallback: REST filter-only and/or client filter
		const safeKw = kw.replace(/"/g, '\\"');
		try {
			const res = await fetchByFilter(`search: "${safeKw}"`);
			return Array.isArray(res) ? res.slice(0, 50) : [];
		} catch(_e){
			const all = await tdFetch('/tasks');
			const lower = kw.toLowerCase();
			const matches = Array.isArray(all) ? all.filter(t => t && typeof t.content === 'string' && t.content.toLowerCase().includes(lower)) : [];
			return matches.slice(0, 50);
		}
	}
}

function renderSearchResults(list){
	searchList.innerHTML = '';
	if (!list.length){
		searchHeader.innerHTML = 'Search results <span class="count">(0)</span>';
		searchList.innerHTML = '<p class="muted">No matching active tasks found.</p>';
		return;
	}
	searchHeader.innerHTML = `Search results <span class="count">(${list.length})</span>`;
	for (const t of list){
		const div = document.createElement('div');
		div.className = 'task-card';
		const pname = t.project_id ? (projectIdToName.get(String(t.project_id)) || t.project_id) : '';
		const due = (t.due && t.due.string) ? t.due.string : '';
		const labels = Array.isArray(t.labels) ? t.labels : [];
		const urgency = labels.find(l => ['urgent-now','urgent-morning','urgent-afternoon','urgent-today','urgent-soon'].includes(String(l).toLowerCase()));
		const pressure = labels.find(l => ['high-pressure','low-pressure'].includes(String(l).toLowerCase()));
		const lhf = labels.find(l => String(l).toLowerCase() === 'low-hanging-fruit');
		const urgencyBadge = urgency ? `<span class="badge red">${urgency}</span>` : '';
		const pressureBadge = pressure ? `<span class="badge amber">${pressure}</span>` : '';
		const lhfBadge = lhf ? `<span class="badge green">${lhf}</span>` : '';
		const projectPill = pname ? `<span class="pill">${pname}</span>` : '';
		div.innerHTML = `<div class="task-title">${projectPill}<span>${t.content || '(Untitled)'}</span></div><div class="task-meta">${due} ${urgencyBadge} ${pressureBadge} ${lhfBadge}</div>`;
		div.addEventListener('click', async () => {
			cameFromSearch = true;
			await ensureProjectsLoaded();
			const pos = tasks.findIndex(x => String(x.id) === String(t.id));
			if (pos >= 0){
				idx = pos;
				show(scrTask);
				renderCurrentTask();
			} else {
				tasks.unshift(t);
				idx = 0;
				show(scrTask);
				renderCurrentTask();
			}
		});
		searchList.appendChild(div);
	}
}

// ----- UI flow -----
function renderCurrentTask(){
  const t = tasks[idx];
  if (!t){ show(scrDone); return; }
  
  // Debug: Log task data
  console.log('Current task data:', t);
  console.log('Task ID:', t.id);
  console.log('Task content:', t.content);
  
  const titleText = t.content || '(Untitled)';
  const href = t.url || (t.id ? ('https://app.todoist.com/app/task/' + String(t.id)) : null);
  if (href){
    taskTitleEl.innerHTML = `<a href="${href}" target="_blank" rel="noopener noreferrer">${titleText}</a>`;
  } else {
    taskTitleEl.textContent = titleText;
  }
  const dueStr = (t.due && t.due.string) ? t.due.string : null;
  const isRecurring = !!(t.due && t.due.is_recurring);
  const pname = t.project_id ? (projectIdToName.get(String(t.project_id)) || t.project_id) : null;
  let dueDateISO = null;
  if (t && t.due){
    if (t.due.date) {
      dueDateISO = String(t.due.date);
    } else if (t.due.datetime) {
      const dt = new Date(t.due.datetime);
      dueDateISO = toLocalISO(dt);
    }
  }
  const dueDateHuman = dueDateISO ? humanDateFromISO(dueDateISO) : null;
  const chips = [];
  if (pname) chips.push(`<span class="chip blue">${pname}</span>`);
  if (dueStr) chips.push(`<span class="chip amber">Due: ${dueStr}</span>`);
  if (dueDateHuman) chips.push(`<span class="chip">Date: ${dueDateHuman}</span>`);
  if (isRecurring) chips.push(`<span class="chip purple">Recurring</span>`);
  taskMetaEl.innerHTML = chips.join(' ');

  // Reset UI: select Today only if task is due today; otherwise, nothing selected
  (function(){
    const todayISO = toLocalISO(new Date());
    let dueDateISO = null;
    if (t && t.due){
      if (t.due.date) {
        dueDateISO = String(t.due.date);
      } else if (t.due.datetime) {
        const dt = new Date(t.due.datetime);
        dueDateISO = toLocalISO(dt);
      }
    }
    const isDueToday = (dueDateISO === todayISO);
    qAll('input[name="dateChoice"]').forEach(r => { r.checked = isDueToday && (r.value === 'today'); });
  })();
  qAll('.checks input[type=checkbox]').forEach(c => { c.checked = false; });

  // Pre-check labels that already exist on the task (prefer names; fallback to ids)
  const existingLabelNames = new Set(
    Array.isArray(t.labels) ? t.labels.map(s => String(s).toLowerCase()) : []
  );
  const existingLabelIds = new Set(
    Array.isArray(t.label_ids) ? t.label_ids.map(n => Number(n)).filter(n => Number.isFinite(n)) : []
  );

  // Clear radios
  qAll('input[name="urgencyChoice"]').forEach(r => { r.checked = false; });
  qAll('input[name="pressureChoice"]').forEach(r => { r.checked = false; });
  qAll('input[name="durationChoice"]').forEach(r => { r.checked = false; });

  // Apply existing labels to radios
  function checkIfHasLabel(labelName){
    const key = String(labelName).toLowerCase();
    if (existingLabelNames.has(key)) return true;
    const id = labelIndexByName.get(key);
    return !!(id && existingLabelIds.has(Number(id)));
  }

  const urgencyMap = ['urgent-now','urgent-morning','urgent-afternoon','urgent-today','urgent-soon'];
  const pressureMap = ['high-pressure','low-pressure'];
  const durationMap = ['estimated-under-5m','estimated-5m-to-15m','estimated-15m-to-30m','estimated-30m-to-1h','estimated-1h-2h','estimated-over-2h'];

  for (const u of urgencyMap){
    if (checkIfHasLabel(u)){
      const el = document.querySelector(`input[name="urgencyChoice"][value="${u}"]`);
      if (el) el.checked = true;
      break;
    }
  }
  for (const p of pressureMap){
    if (checkIfHasLabel(p)){
      const el = document.querySelector(`input[name="pressureChoice"][value="${p}"]`);
      if (el) el.checked = true;
      break;
    }
  }
  for (const d of durationMap){
    if (checkIfHasLabel(d)){
      const el = document.querySelector(`input[name="durationChoice"][value="${d}"]`);
      if (el) el.checked = true;
      break;
    }
  }

  customDateISO = null;
  if (statusEl) statusEl.textContent = '';

  // Update bottom-right counter (e.g., "1 of 60")
  if (taskCounterEl){
    const total = tasks.length || 0;
    const current = Math.min(idx + 1, total);
    taskCounterEl.textContent = total ? (current + ' of ' + total) : '';
  }

  // Nav state: enable Previous if came from search or Top 5, else based on idx
  if (prevTaskBtn) prevTaskBtn.disabled = (cameFromSearch || cameFromTop5) ? false : (idx <= 0);

  // Always enable date controls (including for recurring)
  setDateControlsEnabled(true);

  // Show/hide "Skip to next occurrence" for recurring only
  const skipInput = document.querySelector('input[name="dateChoice"][value="skip_next"]');
  if (skipInput){
    const skipLabel = skipInput.closest('label');
    if (skipLabel){
      if (isRecurring){
        skipLabel.classList.remove('hidden');
      } else {
        // If it was selected, revert to Today
        if (skipInput.checked){
          const todayInput = document.querySelector('input[name="dateChoice"][value="today"]');
          if (todayInput) todayInput.checked = true;
        }
        skipLabel.classList.add('hidden');
      }
    }
  }
}

async function startFlow(){
  show(scrStart);
  if (planBtn){ planBtn.disabled = true; planBtn.textContent = 'Fetching…'; }
  try{
    console.log('=== STARTING FLOW ===');
    console.log('Token available:', !!token);
    
    await Promise.all([preloadLabels(), preloadProjects()]); // load labels and projects first
    tasks = await fetchTodayTasks(); // then load tasks
    
    console.log('Tasks loaded:', tasks.length);
    if (tasks.length > 0) {
      console.log('First task ID:', tasks[0].id);
      console.log('First task content:', tasks[0].content);
    }
    
    idx = 0;
    if (!tasks.length){ show(scrDone); return; }
    show(scrTask);
    renderCurrentTask();
  }catch(e){
    console.error('Flow failed:', e);
    alert('Failed to fetch tasks: ' + e.message);
  }finally{
    if (planBtn){ planBtn.disabled = false; planBtn.textContent = 'Plan my day'; }
  }
}


async function submitCurrent(){
  const t = tasks[idx];
  if (!t) return;

  // Debug: Log task details before update
  console.log('Attempting to update task:', t.id, t.content);
  console.log('Task object keys:', Object.keys(t));

  // Validate task id early
  const idStr = (t && t.id != null) ? String(t.id) : '';
  if (!/^\d+$/.test(idStr)){
    if (statusEl) statusEl.textContent = 'Invalid task id: ' + idStr;
    console.error('Invalid task id:', t.id, 'raw:', t);
    return;
  }

  const chosenRadio = document.querySelector('input[name="dateChoice"]:checked');
  const dateChoice = chosenRadio ? chosenRadio.value : 'today';

  // Compute final labels: start from existing, remove old duration labels, then apply selected radios
  const uEl = document.querySelector('input[name="urgencyChoice"]:checked');
  const pEl = document.querySelector('input[name="pressureChoice"]:checked');
  const dEl = document.querySelector('input[name="durationChoice"]:checked');

  // Build existing label names (case-preserving where possible)
  const existingRaw = Array.isArray(t.labels) ? t.labels.slice() : (Array.isArray(t.label_ids) ? t.label_ids.slice() : []);
  const existingNames = [];
  for (const v of existingRaw){
    if (typeof v === 'number' || String(v).match(/^\d+$/)){
      const nm = labelNameById.get(Number(v));
      if (nm) existingNames.push(nm);
    } else {
      existingNames.push(String(v));
    }
  }

  const URGENCY = ['urgent-now','urgent-morning','urgent-afternoon','urgent-today','urgent-soon'];
  const PRESSURE = ['high-pressure','low-pressure'];
  const OLD_DURATION = ['under-15m','15m-to-30m','30m-to-1h','1h-2h','2h-3h','over-3h'];
  const NEW_DURATION = ['estimated-under-5m','estimated-5m-to-15m','estimated-15m-to-30m','estimated-30m-to-1h','estimated-1h-2h','estimated-over-2h'];

  function withoutCategories(arr, cats){
    const lowers = new Set(cats.map(s => s.toLowerCase()));
    return arr.filter(nm => !lowers.has(String(nm).toLowerCase()));
  }

  let finalLabels = existingNames.slice();
  // Strip old and any existing new duration labels
  finalLabels = withoutCategories(finalLabels, OLD_DURATION);
  finalLabels = withoutCategories(finalLabels, NEW_DURATION);
  // If selecting urgency, replace existing urgency
  if (uEl){
    finalLabels = withoutCategories(finalLabels, URGENCY);
    finalLabels.push(uEl.value);
  }
  // If selecting pressure, replace existing pressure
  if (pEl){
    finalLabels = withoutCategories(finalLabels, PRESSURE);
    finalLabels.push(pEl.value);
  }
  // If selecting duration, add new estimated duration
  if (dEl){
    finalLabels.push(dEl.value);
  }

  // Ensure to create any new labels we might have added
  const toEnsure = [];
  if (uEl) toEnsure.push(uEl.value);
  if (pEl) toEnsure.push(pEl.value);
  if (dEl) toEnsure.push(dEl.value);

  try {
    // Ensure labels exist for any newly added ones
    await ensureLabelsExist(toEnsure);
    // Use names array for REST updates; preserve all non-target labels via names
    const finalLabelNames = finalLabels.slice();

    // Compute explicit date (YYYY-MM-DD) for update
    const targetISO = presetChoiceToISO(dateChoice);
    const isRecurring = !!(t.due && t.due.is_recurring);

    if (isRecurring) {
      // Recurring rules
      if (dateChoice === 'skip_next'){
        // Best-practice for recurring tasks: complete current instance to advance to next
        try {
          await tdFetch('/tasks/' + idStr + '/close', { method: 'POST' });
          if (statusEl) statusEl.textContent = 'Skipped to next occurrence ✔';
          idx += 1;
          if (idx >= tasks.length){ show(scrDone); } else { renderCurrentTask(); }
          return;
        } catch (e) {
          console.error('Skip to next (close) failed:', e);
          if (statusEl) statusEl.textContent = 'Skip failed: ' + e.message;
          return;
        }
      }

      if (dateChoice === 'today'){
        // Update original to today; no duplicate
        try {
          const todayISO = presetChoiceToISO('today');
          const updateBody = { due_date: todayISO };
          // Always send labels (names) to ensure old duration labels are removed
          updateBody.labels = finalLabelNames;
          await tdFetch('/tasks/' + idStr, { method: 'POST', body: updateBody });
          if (statusEl) statusEl.textContent = 'Updated ✔';
          idx += 1;
          if (idx >= tasks.length){ show(scrDone); } else { renderCurrentTask(); }
          return;
        } catch (e) {
          console.error('Set today (update) failed:', e);
          if (statusEl) statusEl.textContent = 'Update failed: ' + e.message;
          return;
        }
      }

      // Other presets (tomorrow, next Mon–Sun): reschedule recurring task in-place via Sync API (avoid duplicate)
      try {
        const dueString = (t && t.due && t.due.string) ? String(t.due.string) : undefined;
        const cmd = {
          type: 'item_update',
          uuid: uuidv4(),
          args: {
            id: idStr,
            due: {
              date: targetISO,
              timezone: null,
              is_recurring: true,
              ...(dueString ? { string: dueString, lang: 'en' } : { is_recurring: true })
            }
          }
        };
        await syncPost([cmd]);
        // Apply labels via REST (names) to ensure duration label replacements are reflected
        await tdFetch('/tasks/' + idStr, { method: 'POST', body: { labels: finalLabelNames } });
        if (statusEl) statusEl.textContent = 'Updated ✔';
        idx += 1;
        if (idx >= tasks.length){ show(scrDone); } else { renderCurrentTask(); }
        return;
      } catch (e) {
        console.error('Reschedule recurring (sync) failed:', e);
        if (statusEl) statusEl.textContent = 'Update failed: ' + e.message;
        return;
      }
    }

    // Non-recurring: update due_date and labels directly
    const body = {};
    // Always send labels to remove old duration labels (names)
    body.labels = finalLabelNames;
    body.due_date = targetISO; // due_string not set

    console.log('Updating task (due_date only) with labels (names):', targetISO, finalLabels);
    await tdFetch('/tasks/' + idStr, { method: 'POST', body });

    if (statusEl) statusEl.textContent = 'Updated ✔';
    idx += 1;
    if (idx >= tasks.length){ show(scrDone); } else { renderCurrentTask(); }

  } catch (error) {
    console.error('Task update failed:', error);
    if (statusEl) statusEl.textContent = 'Update failed: ' + error.message;
  }
}

function skipCurrent(){
  idx += 1;
  if (idx >= tasks.length){ show(scrDone); } else { renderCurrentTask(); }
}

async function completeTask(idStr){
  await tdFetch('/tasks/' + idStr + '/close', { method: 'POST' });
}
async function deleteTask(idStr){
  await tdFetch('/tasks/' + idStr, { method: 'DELETE' });
}

// Events
if (planBtn){
  planBtn.addEventListener('click', async function(){
    token = await getToken();
    if (!token){ show(scrToken); return; }
    startFlow();
  });
}
if (saveTokenBtn){
  saveTokenBtn.addEventListener('click', async function(){
    const v = tokenInput ? (tokenInput.value || '').trim() : '';
    if (!v) { alert('Please paste your Todoist API token'); return; }
    await setToken(v); token = v;
    if (tokenInput) tokenInput.value = '';
    startFlow();
  });
}
if (submitUpdateBtn) submitUpdateBtn.addEventListener('click', async function(){
  try {
    if (statusEl) statusEl.textContent = 'Updating…';
    await submitCurrent();
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Update failed: ' + e.message;
  }
});
if (skipTaskBtn)     skipTaskBtn.addEventListener('click', skipCurrent);
if (restartBtn)      restartBtn.addEventListener('click', function(){ show(scrStart); });
if (prevTaskBtn)     prevTaskBtn.addEventListener('click', async function(){
	if (cameFromSearch){
		cameFromSearch = false;
		show(scrSearch);
		return;
	}
  if (cameFromTop5){
    cameFromTop5 = false;
    show(scrStart);
    try { renderTop5Today(); } catch(_e) {}
    return;
  }
	if (idx > 0){
		idx -= 1;
		await refreshCurrentTask();
	}
});
if (searchBtn){
	searchBtn.addEventListener('click', async function(){
		const kw = (searchInput && searchInput.value || '').trim();
		if (!kw) return;
		show(scrSearch);
		if (searchList) searchList.innerHTML = '<p class="muted">Searching… please wait</p>';
		const prevBtnDisabled = !!searchBtn.disabled;
		const prevInpDisabled = !!(searchInput && searchInput.disabled);
		searchBtn.disabled = true;
		if (searchInput) searchInput.disabled = true;
		try{
			await ensureProjectsLoaded();
			const results = await searchTasksByKeyword(kw);
			renderSearchResults(results);
		}catch(e){
			searchList.innerHTML = `<p class="muted">Search failed: ${e.message}</p>`;
		} finally {
			searchBtn.disabled = prevBtnDisabled ? true : false;
			if (searchInput) searchInput.disabled = prevInpDisabled ? true : false;
		}
	});
}
if (searchInput){
	searchInput.addEventListener('keydown', function(e){
		if (e.key === 'Enter'){
			e.preventDefault();
			if (searchBtn) searchBtn.click();
		}
	});
}
if (backHomeBtn){
  backHomeBtn.addEventListener('click', function(){
    cameFromSearch = false;
    if (searchList) searchList.innerHTML = '';
    show(scrStart);
    try { renderTop5Today(); } catch(_e) {}
  });
}
if (deleteTaskBtn){
  deleteTaskBtn.addEventListener('click', async function(){
    const t = tasks[idx];
    if (!t) return;
    const idStr = String(t.id);
    try{
      if (statusEl) statusEl.textContent = 'Deleting…';
      await deleteTask(idStr);
      if (statusEl) statusEl.textContent = 'Deleted ✔';
      idx += 1;
      if (idx >= tasks.length){ show(scrDone); } else { renderCurrentTask(); }
    }catch(e){
      if (statusEl) statusEl.textContent = 'Delete failed: ' + e.message;
    }
  });
}
if (doneTaskBtn){
  doneTaskBtn.addEventListener('click', async function(){
    const t = tasks[idx];
    if (!t) return;
    const idStr = String(t.id);
    try{
      if (statusEl) statusEl.textContent = 'Completing…';
      await completeTask(idStr);
      if (statusEl) statusEl.textContent = 'Completed ✔';
      idx += 1;
      if (idx >= tasks.length){ show(scrDone); } else { renderCurrentTask(); }
    }catch(e){
      if (statusEl) statusEl.textContent = 'Complete failed: ' + e.message;
    }
  });
}
if (focusStartBtn){
  focusStartBtn.addEventListener('click', function(){
    const t = tasks[idx]; if (!t) return; 
    let sel = focusMinutesSel ? String(focusMinutesSel.value) : '5';
    if (sel === '5s'){
      // Special test mode: 5 seconds
      startFocusTimerFor(t, 1/12); // 5 seconds
    } else {
      const m = Number(sel) || 5; startFocusTimerFor(t, m);
    }
  });
}
// back button removed

// Calendar interactions removed

// ----- Top 5 for today (home screen) -----
function formatLocalHM(isoDateTime){
  const d = new Date(isoDateTime);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
function normalizeLabelNames(arr){
  return (Array.isArray(arr) ? arr : []).map(s => String(s).toLowerCase());
}
function taskHasLabel(task, name){
  const key = String(name).toLowerCase();
  const labels = Array.isArray(task.labels) ? normalizeLabelNames(task.labels) : [];
  if (labels.includes(key)) return true;
  const ids = Array.isArray(task.label_ids) ? task.label_ids.map(n => Number(n)).filter(n => Number.isFinite(n)) : [];
  const id = labelIndexByName.get(key);
  return !!(id && ids.includes(Number(id)));
}
async function toggleFocusLabel(task){
  try{
    await ensureLabelsExist(['focus']);
  }catch(_e){}
  const has = taskHasLabel(task, 'focus');
  const existing = Array.isArray(task.labels) ? task.labels.slice() : [];
  const next = has ? existing.filter(x => String(x).toLowerCase() !== 'focus') : existing.concat(['focus']);
  const nextNames = next.map(x => String(x));
  const nextIds = Array.from(new Set(namesToLabelIds(nextNames)));
  await tdFetch('/tasks/' + String(task.id), { method: 'POST', body: { labels: nextIds } });
  task.labels = nextNames; // keep names locally for UI state
}
async function renderTop5Today(){
  const el = document.getElementById('top5List');
  if (!el) return;
  el.innerHTML = '<p class="muted">Loading…</p>';
  // Ensure token is available
  try{
    if (!token){ token = await getToken(); }
  }catch(_e){}
  if (!token){ el.innerHTML = '<p class="muted">Connect your Todoist token to see Top 5.</p>'; return; }
  try{
    const todayISO = toLocalISO(new Date());
    const res = await tdFetch('/tasks?filter=' + encodeURIComponent('today'));
    const all = Array.isArray(res) ? res : [];
    // Filter only those with a due time today
    const withTimeToday = all.filter(t => {
      if (!t || !t.due || !t.due.datetime) return false;
      const dt = new Date(t.due.datetime);
      return toLocalISO(dt) === todayISO;
    });
    withTimeToday.sort((a,b) => {
      const ta = Date.parse(a.due.datetime);
      const tb = Date.parse(b.due.datetime);
      return ta - tb;
    });
    const top = withTimeToday.slice(0, 5);
    if (!top.length){ el.innerHTML = '<p class="muted">No timed tasks for today.</p>'; return; }
    el.innerHTML = '';
    for (const t of top){
      const row = document.createElement('div');
      row.className = 'task-card';
      const time = t.due && t.due.datetime ? formatLocalHM(t.due.datetime) : '';
      const title = t.content || '';
      const focusOn = taskHasLabel(t, 'focus');
      row.innerHTML = `<div class="task-title"><span class="pill">${time}</span><span>${title}</span><button class="icon-btn" data-role="focus" style="margin-left:auto" title="Focus">🎯</button></div>`;
      const btn = row.querySelector('button[data-role="focus"]');
      if (btn){
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          // Start focus timer page directly
          try { startFocusTimerFor(t, 5); } catch(_e){}
        });
      }
      // Clicking the row jumps to task review for this task
      row.addEventListener('click', async () => {
        try{ await ensureProjectsLoaded(); } catch(_e){}
        cameFromTop5 = true;
        const pos = tasks.findIndex(x => String(x.id) === String(t.id));
        if (pos >= 0){
          idx = pos; show(scrTask); renderCurrentTask();
        } else {
          tasks.unshift(t); idx = 0; show(scrTask); renderCurrentTask();
        }
      });
      el.appendChild(row);
    }
  }catch(e){
    el.innerHTML = `<p class="muted">Failed to load top 5: ${e.message}</p>`;
  }
}

// Sync API helper for in-place updates (e.g., recurring reschedule)
async function syncPost(commands){
  if (!token) throw new Error('Missing Todoist token');
  const url = 'https://api.todoist.com/sync/v9/sync';
  const payload = { resource_types: ['items'], sync_token: '*', commands: commands };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error((data && data.error) ? data.error : ('HTTP ' + res.status + ': ' + text));
  return data;
}
function uuidv4(){
  try {
    const buf = new Uint8Array(16); crypto.getRandomValues(buf);
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    const hex = Array.from(buf, b => b.toString(16).padStart(2, '0'));
    return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
  } catch(_e){
    return String(Date.now()) + '-' + Math.random().toString(16).slice(2);
  }
}

// Focus timer state
let focusTimerId = null;
let focusStartTs = 0;
let focusTask = null;
let focusPaused = false;
let focusAccumulatedMs = 0; // sum of active focus intervals
let focusLastTickTs = 0;
function formatMMSS(ms){
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
function startFocusTimerFor(task, minutes){
  focusTask = task;
  if (focusTaskTitleEl){
    const href = task.url || (task.id ? ('https://app.todoist.com/app/task/' + String(task.id)) : null);
    const titleText = task.content || '(Untitled)';
    const projectName = task.project_id ? (projectIdToName.get(String(task.project_id)) || '') : '';
    const prefix = projectName ? `<span class="pill">${projectName}</span>` : '';
    focusTaskTitleEl.innerHTML = href ? `${prefix}<a href="${href}" target="_blank" rel="noopener noreferrer">${titleText}</a>` : `${prefix}${titleText}`;
  }
  if (focusStatusEl) focusStatusEl.textContent = '';
  if (focusSubtasksEl){
    focusSubtasksEl.innerHTML = '<div class="subtasks-title">Subtasks</div><div class="muted">Loading…</div>';
    try{ focusSubtasksEl.style.display = ''; }catch(_e){}
  }
  const mins = Math.max(1, Number(minutes) || 5);
  focusStartTs = Date.now();
  focusAccumulatedMs = 0;
  focusPaused = false;
  focusLastTickTs = focusStartTs;
  if (focusTimerEl) focusTimerEl.textContent = '00:00';
  if (focusTimerId) { clearInterval(focusTimerId); focusTimerId = null; }
  focusTimerId = setInterval(() => {
    if (!focusPaused){
      const now = Date.now();
      focusAccumulatedMs += (now - focusLastTickTs);
      focusLastTickTs = now;
      if (focusTimerEl) focusTimerEl.textContent = formatMMSS(focusAccumulatedMs);
    }
  }, 250);
  // Record start for potential resume; no nudges
  try{ chrome.runtime.sendMessage({ type: 'focus_start', taskId: task.id, taskTitle: task.content || '', startAt: focusStartTs }, function(_res){ /* ignore */ }); }catch(_e){}
  show(scrFocus);
  try { renderFocusSubtasks(task); } catch(_e) {}
  try { renderFocusInsights(); } catch(_e) {}
}
async function fetchCompletedSince(days){
  const now = new Date();
  const since = new Date(now.getTime() - days*24*60*60*1000);
  const sinceIso = since.toISOString();
  // Use Sync completed API via fetch; reuse token
  const url = 'https://api.todoist.com/sync/v9/completed/get_all?since=' + encodeURIComponent(sinceIso) + '&limit=200&offset=0';
  const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
  const data = await res.json().catch(() => ({ items: [] }));
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map(it => ({
    completed_at: it.completed_at || it.completed_date || null,
    project_id: String(it.project_id || ''),
    content: it.content || '',
  }));
}
function groupByDate(items){
  const by = new Map();
  for (const it of items){
    if (!it.completed_at) continue;
    const d = new Date(it.completed_at);
    const ymd = toLocalISO(d);
    by.set(ymd, (by.get(ymd)||0)+1);
  }
  // fill gaps for nicer charts
  const keys = Array.from(by.keys()).sort();
  return { map: by, keys };
}
async function fetchProjectsIndex(){
  try{
    const res = await tdFetch('/projects');
    const idx = new Map();
    for (const p of (Array.isArray(res)?res:[])) idx.set(String(p.id), p.name);
    return idx;
  }catch(_e){ return new Map(); }
}
function groupByProjectPerDay(items){
  const by = new Map(); // ymd -> Map<project, count>
  for (const it of items){
    if (!it.completed_at) continue;
    const d = new Date(it.completed_at);
    const ymd = toLocalISO(d);
    const proj = String(it.project_id||'');
    let m = by.get(ymd); if (!m){ m = new Map(); by.set(ymd, m); }
    m.set(proj, (m.get(proj)||0)+1);
  }
  const keys = Array.from(by.keys()).sort();
  return { map: by, keys };
}
function pickPalette(names){
  // Balanced professional palette - muted tones with one accent color
  const base = ['#64748b','#6b7280','#71717a','#78716c','#84cc16','#22c55e','#10b981','#06b6d4','#0ea5e9','#3b82f6','#8b5cf6','#a855f7'];
  const out = new Map(); let i=0;
  for (const n of names){ out.set(n, base[i%base.length]); i++; }
  return out;
}
function drawBarChart(canvasId, series, tooltipFmt){
  const canvas = document.getElementById(canvasId); if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const W = rect.width || canvas.width; const H = rect.height || canvas.height;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0,0,W,H);
  
  const allY = series.flatMap(s => s.points.map(p=>p.y));
  const rawMax = Math.max(1, ...allY, 1);
  const maxY = Math.ceil(rawMax / 4) * 4;
  const padLeft = 34, padRight = 12, padTop = 16, padBottom = 18;
  
  // axes
  ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padLeft, H-padBottom); ctx.lineTo(W-padRight, H-padBottom); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(padLeft, padTop); ctx.lineTo(padLeft, H-padBottom); ctx.stroke();
  
  // y ticks in multiples of 4 - cleaner styling
  ctx.fillStyle = '#374151'; ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  for (let v=0; v<=maxY; v+=4){
    const y = H-padBottom - (H-padTop-padBottom) * (v / maxY);
    ctx.beginPath(); ctx.moveTo(padLeft-6, y); ctx.lineTo(W-padRight, y); 
    ctx.strokeStyle = v===0? '#e5e7eb':'#f8fafc'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillText(String(v), 6, y+4);
  }
  
  // draw bars with dynamic dark blue shading based on height
  const N = series[0]?.points?.length || 0;
  const barSpacing = (W-padLeft-padRight) / N;
  const barWidth = barSpacing * 0.95; // 95% width = minimal gaps
  
  // Dark blue color palette - lighter to darker based on height
  const baseBlue = '#1e40af'; // Dark blue base
  
  for (const s of series){
    s.points.forEach((p,i)=>{
      const x = padLeft + barSpacing * i + (barSpacing - barWidth) / 2;
      const barHeight = (H-padTop-padBottom) * (p.y / maxY);
      const y = H-padBottom - barHeight;
      
      // Calculate color intensity based on bar height (0 to 1)
      const heightRatio = p.y / maxY;
      
            // Create subtle gradient from light teal to medium teal
            let color;
            if (heightRatio < 0.2) {
              // Very light teal for small bars
              color = '#ccfbf1';
            } else if (heightRatio < 0.4) {
              // Light teal
              color = '#99f6e4';
            } else if (heightRatio < 0.6) {
              // Medium teal
              color = '#5eead4';
            } else if (heightRatio < 0.8) {
              // Darker teal
              color = '#2dd4bf';
            } else {
              // Darkest teal for tallest bars
              color = '#14b8a6';
            }
      
      // Solid fill with dynamic color
      ctx.fillStyle = color;
      ctx.fillRect(x, y, barWidth, barHeight);
      
            // Border with slightly darker teal shade
            ctx.strokeStyle = '#0d9488';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, barWidth, barHeight);
      
      p._x = x + barWidth/2;
      p._y = y;
    });
  }
  
  // average and peak lines - cleaner styling
  const all = series.flatMap(s=>s.points.map(p=>p.y));
  const avg = all.length ? all.reduce((a,b)=>a+b,0)/all.length : 0;
  const peak = all.length ? Math.max(...all) : 0;
  const yAvg = H-padBottom - (H-padTop-padBottom) * (avg / maxY);
  const yPeak = H-padBottom - (H-padTop-padBottom) * (peak / maxY);
  
  // Cleaner dashed lines
  ctx.setLineDash([6,4]);
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(padLeft, yAvg); ctx.lineTo(W-padRight, yAvg); ctx.stroke();
  ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(padLeft, yPeak); ctx.lineTo(W-padRight, yPeak); ctx.stroke();
  ctx.setLineDash([]);
  
  // Cleaner labels with better positioning
  ctx.fillStyle = '#64748b'; ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(`avg ${avg.toFixed(1)}`, W-padRight-50, yAvg-6);
  ctx.fillStyle = '#dc2626'; ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(`peak ${peak}`, W-padRight-50, yPeak-6);
  
  // tooltip
  canvas.addEventListener('mousemove', (e)=>{
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let found = null;
    for (const s of series){
      for (const p of s.points){
        if (Math.abs(x-p._x)<8 && Math.abs(y-p._y)<8){ found = {s,p}; break; }
      }
      if (found) break;
    }
    const tip = document.getElementById('chartTooltip');
    if (found){
      tip.textContent = tooltipFmt ? tooltipFmt(found.p, found.s) : `${found.s.label}: ${found.p.y}`;
      tip.style.display = 'block';
      tip.style.left = (e.clientX + 8) + 'px';
      tip.style.top = (e.clientY - 8) + 'px';
    } else {
      tip.style.display = 'none';
    }
  });
}

function drawLineChart(canvasId, series, tooltipFmt){
  const canvas = document.getElementById(canvasId); if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const W = rect.width || canvas.width; const H = rect.height || canvas.height;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0,0,W,H);
  // series: [{label,color,points:[{label,y}], maxY}]
  const allY = series.flatMap(s => s.points.map(p=>p.y));
  const rawMax = Math.max(1, ...allY, 1);
  // y-axis max rounded up to nearest multiple of 4
  const maxY = Math.ceil(rawMax / 4) * 4;
  const padLeft = 34, padRight = 12, padTop = 16, padBottom = 18;
  // axes
  ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padLeft, H-padBottom); ctx.lineTo(W-padRight, H-padBottom); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(padLeft, padTop); ctx.lineTo(padLeft, H-padBottom); ctx.stroke();
  // y ticks in multiples of 4 - cleaner styling
  ctx.fillStyle = '#374151'; ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  for (let v=0; v<=maxY; v+=4){
    const y = H-padBottom - (H-padTop-padBottom) * (v / maxY);
    ctx.beginPath(); ctx.moveTo(padLeft-6, y); ctx.lineTo(W-padRight, y); 
    ctx.strokeStyle = v===0? '#e5e7eb':'#f8fafc'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillText(String(v), 6, y+4);
  }
  // plot each series - cleaner lines
  const N = series[0]?.points?.length || 0;
  for (const s of series){
    ctx.strokeStyle = s.color; ctx.lineWidth = 2.5; ctx.beginPath();
    s.points.forEach((p,i)=>{
      const x = padLeft + (W-padLeft-padRight) * (N<=1? 0.5 : (i/(N-1)));
      const y = H-padBottom - (H-padTop-padBottom) * (p.y / maxY);
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      p._x=x; p._y=y;
    });
    ctx.stroke();
  }
  // average and peak lines
  const all = series.flatMap(s=>s.points.map(p=>p.y));
  const avg = all.length ? all.reduce((a,b)=>a+b,0)/all.length : 0;
  const peak = all.length ? Math.max(...all) : 0;
  const yAvg = H-padBottom - (H-padTop-padBottom) * (avg / maxY);
  const yPeak = H-padBottom - (H-padTop-padBottom) * (peak / maxY);
  // Cleaner dashed lines for line charts
  ctx.setLineDash([6,4]);
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(padLeft, yAvg); ctx.lineTo(W-padRight, yAvg); ctx.stroke();
  ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(padLeft, yPeak); ctx.lineTo(W-padRight, yPeak); ctx.stroke();
  ctx.setLineDash([]);
  
  // Cleaner labels with better positioning
  ctx.fillStyle = '#64748b'; ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('avg ' + Math.round(avg*10)/10, W-padRight-60, Math.max(padTop+12, yAvg-6));
  ctx.fillStyle = '#dc2626'; ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('peak ' + peak, W-padRight-60, Math.max(padTop+12, yPeak-6));
  // basic hover tooltip
  canvas.onmousemove = (e)=>{
    if (!chartTooltipEl) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left; const my = e.clientY - rect.top;
    let hit=null, hitSeries=null;
    for (const s of series){
      for (const p of s.points){
        if (Math.hypot(mx-p._x, my-p._y) < 6){ hit=p; hitSeries=s; break; }
      }
      if (hit) break;
    }
    if (hit){
      chartTooltipEl.style.display='block';
      chartTooltipEl.textContent = tooltipFmt ? tooltipFmt(hit, hitSeries) : (hit.label+': '+hit.y);
      chartTooltipEl.style.left = (e.clientX+10)+'px';
      chartTooltipEl.style.top = (e.clientY+10)+'px';
    } else {
      chartTooltipEl.style.display='none';
    }
  };
}
async function renderFocusInsights(){
  if (!token) try{ token = await getToken(); }catch(_e){}
  if (!token) return;
  // totals
  const [i30,i7] = await Promise.all([
    fetchCompletedSince(30), fetchCompletedSince(7)
  ]);
  const g30 = groupByDate(i30), g7 = groupByDate(i7);
  function toSeries(g){
    const keys = g.keys.sort();
    const pts = keys.map(k=>({label:k.slice(5), y:g.map.get(k)||0}));
    // Use vibrant teal for task completion - light and energetic
    return [{ label:'Total', color:'#14b8a6', points: pts }];
  }
  drawBarChart('chartTotal30', toSeries(g30));
  drawBarChart('chartTotal7', toSeries(g7));

  // projectwise
  const projIdx = await fetchProjectsIndex();
  function toProjSeries(items){
    const gp = groupByProjectPerDay(items);
    const allProjects = new Set();
    gp.map.forEach(m => m.forEach((_,pid)=> allProjects.add(pid)));
    const names = Array.from(allProjects).map(pid => projIdx.get(String(pid)) || pid);
    const palette = pickPalette(names);
    const keys = gp.keys.sort();
    const series = names.map(name => ({ label:name, color:palette.get(name), points: keys.map(k=>({label:k.slice(5), y:(gp.map.get(k)?.get(Array.from(projIdx.entries()).find(([id,n])=>n===name)?.[0]||name) || 0)})) }));
    // Normalize point access by project id mapping
    const idByName = {}; projIdx.forEach((n,id)=>{ idByName[n]=String(id); });
    return { series: names.map(n=>({ label:n, color:palette.get(n), points: keys.map(k=>({label:k.slice(5), y:(gp.map.get(k)?.get(idByName[n]||'')||0)})) })) };
  }
  const s30 = toProjSeries(i30).series;
  const s7  = toProjSeries(i7).series;
  drawLineChart('chartProj30', s30, (p,s)=> `${s.label} — ${p.label}: ${p.y}`);
  drawLineChart('chartProj7',  s7 , (p,s)=> `${s.label} — ${p.label}: ${p.y}`);

  // summary
  function summaryHtml(items, days){
    const by = groupByDate(items);
    const keys = by.keys;
    let sum=0, max=0; for (const k of keys){ const v = by.map.get(k)||0; sum+=v; if (v>max) max=v; }
    const avg = keys.length ? Math.round(sum/keys.length*10)/10 : 0;
    return `<div class="card"><div class="title">Last ${days} days</div><div class="vals"><span class="pill">Avg ${avg}/day</span><span class="pill">Max ${max}/day</span></div></div>`;
  }
  const summaryEl = document.getElementById('chartSummary');
  if (summaryEl){
    summaryEl.innerHTML = [
      summaryHtml(i30,30),
      summaryHtml(i7,7)
    ].join('');
  }

  // Project summary table (rows: overall and projects sorted by 90d avg; cols: 90d/30d/7d avg)
  function projectSummaryTableHtml(items90, items30, items7, itemsToday){
    function computeAverages(items){
      const by = groupByProjectPerDay(items);
      const days = by.keys.length || 1;
      const totals = new Map();
      for (const k of by.keys){
        const m = by.map.get(k) || new Map();
        for (const [pid, cnt] of m.entries()){
          const name = projIdx.get(String(pid)) || String(pid);
          totals.set(name, (totals.get(name)||0) + (cnt||0));
        }
      }
      const avg = new Map();
      totals.forEach((sum, name)=> avg.set(name, sum / days));
      const overall = (Array.from(totals.values()).reduce((a,b)=>a+b,0) / days) || 0;
      return { avg, overall };
    }
    const a90 = computeAverages(items90);
    const a30 = computeAverages(items30);
    const a7  = computeAverages(items7);
    const aToday = computeAverages(itemsToday);
    const names = new Set([...a90.avg.keys(), ...a30.avg.keys(), ...a7.avg.keys(), ...aToday.avg.keys()]);
    const rows = Array.from(names).map(n => ({
      name: n,
      v90: a90.avg.get(n)||0,
      v30: a30.avg.get(n)||0,
      v7:  a7.avg.get(n)||0,
      vToday: aToday.avg.get(n)||0,
    }));
    rows.sort((x,y) => y.v90 - x.v90);
    const head = `<table class="summary-table"><thead><tr><th>Project</th><th class="num">Last 90d</th><th class="num">Last 30d</th><th class="num">Last 7d</th><th class="num">Today</th></tr></thead><tbody>`;
    const overallRow = `<tr><td><strong>Overall avg</strong></td><td class="num">${a90.overall.toFixed(1)}</td><td class="num">${a30.overall.toFixed(1)}</td><td class="num">${a7.overall.toFixed(1)}</td><td class="num">${aToday.overall.toFixed(1)}</td></tr>`;
    const body = rows.map(r => `<tr><td>${r.name}</td><td class="num">${r.v90.toFixed(1)}</td><td class="num">${r.v30.toFixed(1)}</td><td class="num">${r.v7.toFixed(1)}</td><td class="num">${r.vToday.toFixed(1)}</td></tr>`).join('');
    return head + overallRow + body + '</tbody></table>';
  }
  const projSummaryTableEl = document.getElementById('projSummaryTable');
  if (projSummaryTableEl){
    const items90 = await fetchCompletedSince(90);
    const itemsToday = await fetchCompletedSince(1);
    projSummaryTableEl.innerHTML = projectSummaryTableHtml(items90, i30, i7, itemsToday);
  }
}
function safeDateFrom(x){
  if (!x) return null;
  const ts = Date.parse(x);
  return Number.isFinite(ts) ? new Date(ts) : null;
}
function compareSubtasks(a, b){
  const ad = a && a.due && (a.due.datetime || a.due.date);
  const bd = b && b.due && (b.due.datetime || b.due.date);
  const aDue = safeDateFrom(ad);
  const bDue = safeDateFrom(bd);
  if (aDue && bDue) return aDue - bDue;
  if (aDue && !bDue) return -1;
  if (!aDue && bDue) return 1;
  const ac = safeDateFrom(a && a.created_at);
  const bc = safeDateFrom(b && b.created_at);
  if (ac && bc) return ac - bc;
  if (ac && !bc) return -1;
  if (!ac && bc) return 1;
  return 0;
}
async function fetchSubtasksForTask(parentId){
  const all = await tdFetch('/tasks');
  const list = Array.isArray(all) ? all.filter(t => String(t.parent_id || '') === String(parentId)) : [];
  return list;
}
async function renderFocusSubtasks(task){
  if (!focusSubtasksEl) return;
  try{
    const subs = await fetchSubtasksForTask(task.id);
    if (!subs.length){
      try{ focusSubtasksEl.style.display = 'none'; }catch(_e){}
      focusSubtasksEl.innerHTML = '';
      return;
    }
    try{ focusSubtasksEl.style.display = ''; }catch(_e){}
    subs.sort(compareSubtasks);
    const top = subs.slice(0, 5);
    const rows = top.map(st => {
      const title = st.content || '(Untitled)';
      // No project pill here to reduce redundancy with parent
      let meta = '';
      if (st.due && (st.due.datetime || st.due.date)){
        const d = st.due.datetime ? new Date(st.due.datetime) : safeDateFrom(st.due.date);
        meta = d ? `${toLocalISO(d)}` : '';
      } else if (st.created_at){
        const dc = safeDateFrom(st.created_at);
        meta = dc ? `${toLocalISO(dc)}` : '';
      }
      const href = st.url || (st.id ? (`https://app.todoist.com/app/task/${String(st.id)}`) : '#');
      return `<div class=\"subtask-row\"><a class=\"title\" href=\"${href}\" target=\"_blank\" rel=\"noopener noreferrer\">${title}</a>${meta ? `<span class=\"meta\">${meta}</span>` : ''}</div>`;
    }).join('');
    focusSubtasksEl.innerHTML = `<div class=\"subtasks-title\">Subtasks</div>${rows}`;
  }catch(e){
    focusSubtasksEl.innerHTML = `<div class=\"subtasks-title\">Subtasks</div><div class=\"muted\">Failed to load</div>`;
  }
}

function resumeFocusIfAny(){
  try{
    chrome.storage?.local?.get(['focus_timer_state_v1'], (data) => {
      const st = data && data['focus_timer_state_v1'];
      if (!st || !st.startAt) return;
      // Seed minimal task for actions like complete
      focusTask = { id: st.taskId, content: st.taskTitle };
      focusStartTs = st.startAt;
      focusAccumulatedMs = Date.now() - focusStartTs; // approximate when resuming
      focusPaused = false;
      focusLastTickTs = Date.now();
      // Render title link
      if (focusTaskTitleEl){
        const href = st.taskId ? ('https://app.todoist.com/app/task/' + String(st.taskId)) : null;
        const titleText = st.taskTitle || '(Task)';
        focusTaskTitleEl.innerHTML = href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${titleText}</a>` : titleText;
      }
      if (focusTimerId){ clearInterval(focusTimerId); focusTimerId = null; }
      if (focusTimerEl) focusTimerEl.textContent = formatMMSS(focusAccumulatedMs);
      focusTimerId = setInterval(() => {
        if (!focusPaused){
          const now = Date.now();
          focusAccumulatedMs += (now - focusLastTickTs);
          focusLastTickTs = now;
          if (focusTimerEl) focusTimerEl.textContent = formatMMSS(focusAccumulatedMs);
        }
      }, 250);
      show(scrFocus);
      try { renderFocusInsights(); } catch(_e) {}
      // Nudging removed
    });
  }catch(_e){}
}

// Init
(function init(){
  getToken().then(function(tok){
    token = tok;
    show(token ? scrStart : scrToken);
    // If a focus session is active, resume it instead of showing home
    if (token){ resumeFocusIfAny(); }
    if (token){ try { renderTop5Today(); } catch(_e) {} }
  });
})();

document.addEventListener('DOMContentLoaded', function(){
  // Resume focus mode view if requested
  if (location.hash === '#focus-resume'){
    // Fetch stored state from background
    try{
      chrome.storage?.local?.get(['focus_timer_state_v1'], (data) => {
        const st = data && data['focus_timer_state_v1'];
        if (!st) return;
        focusStartTs = st.startAt || Date.now();
        focusAccumulatedMs = Date.now() - focusStartTs; // approximate when resuming
        focusPaused = false;
        focusLastTickTs = Date.now();
        if (focusTimerId) { clearInterval(focusTimerId); focusTimerId = null; }
        if (focusTimerEl) focusTimerEl.textContent = formatMMSS(focusAccumulatedMs);
        focusTimerId = setInterval(() => {
          if (!focusPaused){
            const now = Date.now();
            focusAccumulatedMs += (now - focusLastTickTs);
            focusLastTickTs = now;
            if (focusTimerEl) focusTimerEl.textContent = formatMMSS(focusAccumulatedMs);
          }
        }, 250);
        if (focusTaskTitleEl) focusTaskTitleEl.textContent = st.taskTitle || '(Task)';
        show(scrFocus);
        try { renderFocusInsights(); } catch(_e) {}
        try{
          chrome.storage.local.get(['focus_nudge_prompt_v1'], (d) => {
            if (d && d['focus_nudge_prompt_v1']){
              if (nudgeRow) nudgeRow.style.display = '';
            }
          });
        }catch(_e){}
        try{ chrome.runtime.sendMessage({ type: 'nudge_popup_opened' }, function(){ /* ignore */ }); }catch(_e){}
      });
    }catch(_e){}
  }
});

if (focusCloseTaskBtn){
  focusCloseTaskBtn.addEventListener('click', async function(){
    try{
      const t = focusTask || (tasks[idx] || null);
      if (!t) return;
      if (focusTimerId){ clearInterval(focusTimerId); focusTimerId = null; }
      try{ chrome.runtime.sendMessage({ type: 'focus_cancel' }, function(){ /* ignore */ }); }catch(_e){}
      await tdFetch('/tasks/' + String(t.id) + '/close', { method: 'POST' });
      if (focusStatusEl) focusStatusEl.textContent = 'Task completed ✔';
      show(scrStart);
      try { renderTop5Today(); } catch(_e) {}
    } catch(e){
      if (focusStatusEl) focusStatusEl.textContent = 'Complete failed: ' + e.message;
    }
  });
}

// Nudging removed

if (focusPauseBtn){
  focusPauseBtn.addEventListener('click', function(){
    focusPaused = !focusPaused;
    focusLastTickTs = Date.now();
    focusPauseBtn.textContent = focusPaused ? 'Resume' : 'Pause';
  });
}
if (focusStopBtn){
  focusStopBtn.addEventListener('click', async function(){
    try{
      const t = focusTask || (tasks[idx] || null);
      if (!t) return;
      if (focusTimerId){ clearInterval(focusTimerId); focusTimerId = null; }
      try{ chrome.runtime.sendMessage({ type: 'focus_cancel' }, function(){ /* ignore */ }); }catch(_e){}
      // Add cumulative actual-* label based on user-entered minutes; remove only prior actual-* labels, preserve others
      const userMins = Math.max(0, Number(focusMinutesInput && focusMinutesInput.value ? focusMinutesInput.value : 0) || 0);
      const sessionStep = Math.floor(userMins / 5) * 5;
      if (sessionStep > 0){
        // Build existing label names
        const existingNames = Array.isArray(t.labels)
          ? t.labels.map(x => String(x))
          : (Array.isArray(t.label_ids)
              ? t.label_ids.map(n => labelNameById.get(Number(n))).filter(Boolean)
              : []);
        // Find current cumulative actual-* (max)
        let previousActualMinutes = 0;
        for (const nm of existingNames){
          if (typeof nm === 'string' && /^actual-\d+$/.test(nm)){
            const m = Number(nm.slice('actual-'.length));
            if (Number.isFinite(m) && m > previousActualMinutes) previousActualMinutes = m;
          }
        }
        const newTotal = previousActualMinutes + sessionStep;
        const newLabelName = `actual-${newTotal}`;
        await ensureLabelsExist([newLabelName]);
        const keptNames = existingNames.filter(n => !/^actual-\d+$/.test(String(n)));
        const nextNames = keptNames.concat([newLabelName]);
        await tdFetch('/tasks/' + String(t.id), { method: 'POST', body: { labels: nextNames } });
        t.labels = nextNames;
      }
      if (focusStatusEl) focusStatusEl.textContent = 'Focus stopped';
      show(scrStart);
      try { renderTop5Today(); } catch(_e) {}
    }catch(e){
      if (focusStatusEl) focusStatusEl.textContent = 'Stop failed: ' + e.message;
    }
  });
}
