// MV3 popup for reviewing today's Todoist tasks with grouped labels + calendar date (robust updates)
const API_BASE = 'https://api.todoist.com/rest/v2';
const KEY = 'pmd_todoist_token_v1';

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

// Task UI
const taskTitleEl = document.getElementById('taskTitle');
const taskMetaEl  = document.getElementById('taskMeta');

// Calendar controls
const openCalendarBtn = document.getElementById('openCalendar');
const customDateInput = document.getElementById('customDate');
const customDateLabel = document.getElementById('customDateLabel');

let tasks = [];
let idx = 0;
let token = '';
let customDateISO = null; // YYYY-MM-DD
let labelIndexByName = new Map(); // name -> id
let projectIdToName = new Map(); // id -> name

function show(el){
  [scrStart, scrToken, scrTask, scrDone].forEach(s => s && s.classList.add('hidden'));
  el && el.classList.remove('hidden');
}
function qAll(sel){ return Array.from(document.querySelectorAll(sel)); }

function setDateControlsEnabled(enabled){
  qAll('input[name="dateChoice"]').forEach(r => { r.disabled = !enabled; });
  if (openCalendarBtn) openCalendarBtn.disabled = !enabled;
  if (customDateInput) customDateInput.disabled = !enabled;
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

async function fetchTodayTasks(){
	const filter = 'overdue | today';
	const data = await tdFetch('/tasks?filter=' + encodeURIComponent(filter));
	console.log('Fetched today+overdue tasks:', data);
	console.log('Number of tasks:', data ? data.length : 0);
	if (data && data.length > 0) {
		console.log('First task sample:', data[0]);
	}
	return data || [];
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

// ----- UI flow -----
function renderCurrentTask(){
  const t = tasks[idx];
  if (!t){ show(scrDone); return; }
  
  // Debug: Log task data
  console.log('Current task data:', t);
  console.log('Task ID:', t.id);
  console.log('Task content:', t.content);
  
  taskTitleEl.textContent = t.content || '(Untitled)';
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
  if (customDateInput) customDateInput.value = '';
  if (customDateLabel) customDateLabel.textContent = '';
  if (statusEl) statusEl.textContent = '';

  // Nav state
  if (prevTaskBtn) prevTaskBtn.disabled = (idx <= 0);

  // Always enable date controls (including for recurring)
  setDateControlsEnabled(true);
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
    const targetISO = customDateISO ? customDateISO : presetChoiceToISO(dateChoice);
    const isRecurring = !!(t.due && t.due.is_recurring);

    if (isRecurring) {
      const tomorrowISO = presetChoiceToISO('tomorrow');

      const updateBody = { due_date: targetISO };
      if (selectedLabels.length) updateBody.labels = selectedLabels; // names

      const createBody = {
        content: t.content,
        project_id: t.project_id,
        due_date: tomorrowISO
      };
      if (selectedLabels.length) createBody.labels = selectedLabels;
      if (t.parent_id) createBody.parent_id = t.parent_id;
      if (!t.parent_id && t.section_id) createBody.section_id = t.section_id;

      const [updateRes, copyRes] = await Promise.allSettled([
        tdFetch('/tasks/' + idStr, { method: 'POST', body: updateBody }),
        tdFetch('/tasks', { method: 'POST', body: createBody })
      ]);

      console.log('Recurring parallel results:', updateRes, copyRes);

      if (updateRes.status === 'rejected' && copyRes.status === 'rejected'){
        throw new Error('Both recurring updates failed');
      }

      if (statusEl) statusEl.textContent = 'Updated ✔';
      idx += 1;
      if (idx >= tasks.length){ show(scrDone); } else { renderCurrentTask(); }
      return;
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
  if (idx > 0){
    idx -= 1;
    await refreshCurrentTask();
  }
});

// Calendar interactions
if (openCalendarBtn){
  openCalendarBtn.addEventListener('click', function(){
    if (customDateInput){
      customDateInput.classList.remove('hidden');
      if (customDateInput.showPicker) customDateInput.showPicker();
    }
  });
}
if (customDateInput){
  customDateInput.addEventListener('change', function(){
    if (customDateInput.value){
      customDateISO = customDateInput.value; // YYYY-MM-DD
      if (customDateLabel) customDateLabel.textContent = 'Selected: ' + customDateISO;
    } else {
      customDateISO = null;
      if (customDateLabel) customDateLabel.textContent = '';
    }
  });
}

// Init
(function init(){
  getToken().then(function(tok){
    token = tok;
    show(token ? scrStart : scrToken);
  });
})();
