// MV3 popup for reviewing today's Todoist tasks with grouped labels + calendar date (robust updates)
const API_BASE = 'https://api.todoist.com/rest/v2';
const KEY = 'pmd_todoist_token_v1';
const APP_BASE = 'https://app.todoist.com';

// Screens
const scrStart = document.getElementById('screen-start');
const scrToken = document.getElementById('screen-token');
const scrTask  = document.getElementById('screen-task');
const scrDone  = document.getElementById('screen-done');

// Controls
const planBtn = document.getElementById('planBtn');
const saveTokenBtn = document.getElementById('saveToken');
const tokenInput = document.getElementById('tokenInput');
const submitUpdateBtn = document.getElementById('submitUpdate');
const skipTaskBtn = document.getElementById('skipTask');
const restartBtn = document.getElementById('restart');
const statusEl = document.getElementById('status');
const prevTaskBtn = document.getElementById('prevTask');
const deleteTaskBtn = document.getElementById('deleteTask');
const doneTaskBtn = document.getElementById('doneTask');
// Search
const scrSearch = document.getElementById('screen-search');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchList = document.getElementById('searchList');
const backHomeBtn = document.getElementById('backHome');


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
let projectIdToName = new Map(); // id -> name
let cameFromSearch = false; // whether current task view was opened from search

function show(el){
  [scrStart, scrToken, scrTask, scrDone, scrSearch].forEach(s => s && s.classList.add('hidden'));
  el && el.classList.remove('hidden');
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
    console.error('Full response:', { status: res.status, statusText: res.statusText, text, data });
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
  for (const l of (labels || [])) {
    if (l.name && l.id) labelIndexByName.set(l.name.toLowerCase(), l.id);
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
  for (const n of names) {
    const key = String(n).toLowerCase();
    if (!labelIndexByName.has(key)){
      try {
        const created = await tdFetch('/labels', { method: 'POST', body: { name: n } });
        if (created && created.id) {
          labelIndexByName.set(key, created.id);
        }
      } catch(e){
        console.error('Failed to create label', n, e);
      }
    }
  }
  // Refresh labels to ensure map is fully in sync
  try { await preloadLabels(); } catch(_e){}
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
		searchList.innerHTML = '<p class="muted">No matching active tasks found.</p>';
		return;
	}
	for (const t of list){
		const div = document.createElement('div');
		div.className = 'task-card';
		const pname = t.project_id ? (projectIdToName.get(String(t.project_id)) || t.project_id) : '';
		const due = (t.due && t.due.string) ? t.due.string : '';
		div.innerHTML = `<div class="task-title">${t.content || '(Untitled)'}${pname ? ' • ' + pname : ''}</div><div class="task-meta">${due}</div>`;
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
  const due = (t.due && t.due.string) ? ('Due: ' + t.due.string) : 'No due date';
  const recurring = (t.due && t.due.is_recurring) ? ' • Recurring' : '';
  let project = '';
  if (t.project_id) {
    const pname = projectIdToName.get(String(t.project_id));
    project = ' • Project: ' + (pname || t.project_id);
  }
  taskMetaEl.textContent = due + recurring + project;

  // Reset UI
  qAll('input[name="dateChoice"]').forEach(r => { r.checked = (r.value === 'today'); });
  qAll('.checks input[type=checkbox]').forEach(c => { c.checked = false; });

  // Pre-check labels that already exist on the task (prefer names; fallback to ids)
  const existingLabelNames = new Set(
    Array.isArray(t.labels) ? t.labels.map(s => String(s).toLowerCase()) : []
  );
  const existingLabelIds = new Set(
    Array.isArray(t.label_ids) ? t.label_ids.map(n => Number(n)).filter(n => Number.isFinite(n)) : []
  );
  qAll('.checks input[type=checkbox]').forEach(c => {
    const nameKey = String(c.value).toLowerCase();
    if (existingLabelNames.has(nameKey)) {
      c.checked = true;
      return;
    }
    const id = labelIndexByName.get(nameKey);
    if (id && existingLabelIds.has(Number(id))) c.checked = true;
  });

  customDateISO = null;
  // if (customDateInput) customDateInput.value = '';
  // if (customDateLabel) customDateLabel.textContent = '';
  if (statusEl) statusEl.textContent = '';

  // Nav state: enable Previous if came from search, else based on idx
  if (prevTaskBtn) prevTaskBtn.disabled = cameFromSearch ? false : (idx <= 0);

  // Always enable date controls (including for recurring)
  setDateControlsEnabled(true);

  // Show/hide "Skip to next occurrence" for recurring only
  const isRecurring = !!(t.due && t.due.is_recurring);
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
  const selectedLabels = qAll('.checks input[type=checkbox]:checked').map(c => c.value);

  try {
    // Ensure labels exist
    await ensureLabelsExist(selectedLabels);

    // Compute explicit date (YYYY-MM-DD) for update
    const targetISO = presetChoiceToISO(dateChoice);
    const isRecurring = !!(t.due && t.due.is_recurring);

    if (isRecurring) {
      // Recurring rules
      if (dateChoice === 'skip_next'){
        // Update original to tomorrow so Todoist advances to the next occurrence; no duplicate
        try {
          const tomorrowISO = presetChoiceToISO('tomorrow');
          const updateBody = { due_date: tomorrowISO };
          if (selectedLabels.length) updateBody.labels = selectedLabels;
          await tdFetch('/tasks/' + idStr, { method: 'POST', body: updateBody });
          if (statusEl) statusEl.textContent = 'Updated ✔';
          idx += 1;
          if (idx >= tasks.length){ show(scrDone); } else { renderCurrentTask(); }
          return;
        } catch (e) {
          console.error('Skip to next (update) failed:', e);
          if (statusEl) statusEl.textContent = 'Update failed: ' + e.message;
          return;
        }
      }

      if (dateChoice === 'today'){
        // Update original to today; no duplicate
        try {
          const todayISO = presetChoiceToISO('today');
          const updateBody = { due_date: todayISO };
          if (selectedLabels.length) updateBody.labels = selectedLabels;
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

      // Other presets (tomorrow, next Mon–Sun): create a one-off duplicate only, do not update original
      try {
        const createBody = {
          content: t.content,
          project_id: t.project_id,
          due_date: targetISO
        };
        if (selectedLabels.length) createBody.labels = selectedLabels;
        if (t.parent_id) createBody.parent_id = t.parent_id;
        if (!t.parent_id && t.section_id) createBody.section_id = t.section_id;
        await tdFetch('/tasks', { method: 'POST', body: createBody });
        if (statusEl) statusEl.textContent = 'Updated ✔';
        idx += 1;
        if (idx >= tasks.length){ show(scrDone); } else { renderCurrentTask(); }
        return;
      } catch (e) {
        console.error('Create duplicate for preset failed:', e);
        if (statusEl) statusEl.textContent = 'Update failed: ' + e.message;
        return;
      }
    }

    // Non-recurring: update due_date and labels directly
    const body = {};
    if (selectedLabels.length) body.labels = selectedLabels; // send names
    body.due_date = targetISO; // due_string not set

    console.log('Updating task (due_date only) with labels (names):', targetISO, selectedLabels);
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

// Calendar interactions removed

// Init
(function init(){
  getToken().then(function(tok){
    token = tok;
    show(token ? scrStart : scrToken);
  });
})();
