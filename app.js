const REDIRECT_URI = 'https://contextplus.netlify.app/';
const EXCHANGE_URL = window.EXCHANGE_URL || '/.netlify/functions/exchange';

// Utility logger so startup flow can be debugged easily
const log = (...args) => console.log('[ContextPlus]', ...args);

let clientId = null;
let clientSecret = null;
let db = null;

let branchesData = [];
let currentBranchSha = null;

let accessToken = localStorage.getItem('gh_token') || null;
let currentRepo = JSON.parse(localStorage.getItem('current_repo') || 'null');
let currentBranch = localStorage.getItem('current_branch');
let theme = localStorage.getItem('theme') || 'light';
let llmProvider = null;
let llmApiKey = null;
let llmModel = null;
let llmAsync = false;
let dryRun = false;
let betaMode = false;
let repoTree = [];

const TASK_POLL_INTERVAL = 60_000;   // 60 s
const MAX_PATCH_LINES = 10_000;
const MAX_PROMPT_TOKENS = 128_000;
const MIN_LLM_INTERVAL = 5000; // 5 s
const STATUS_ICONS = {
    pending:'⏳',
    error:'❌',
    'open_pr':'🌿',
    'open_pr (dry-run)':'🌿',
    merged:'✅'
};

let tasksData = [];
let currentPromptText = '';
let currentBundle = null;
let lastLlmTime = 0;

// openDB hang fix history:
// 1. Added fallback timeout to ensure init proceeds even if request events never fire.
function openDB() {
    return new Promise(resolve => {
        log('openDB start');
        let finished = false;
        const done = () => { if(!finished){ finished = true; resolve(); } };
        try {
            const req = indexedDB.open('contextplus', 4);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if(!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
                if(!db.objectStoreNames.contains('instructions')) db.createObjectStore('instructions', { keyPath: 'id', autoIncrement: true });
                if(db.objectStoreNames.contains('descriptions')) db.deleteObjectStore('descriptions');
                db.createObjectStore('descriptions', { keyPath: ['repo','branch','path'] });
                if(!db.objectStoreNames.contains('tasks')) db.createObjectStore('tasks', { keyPath: 'id', autoIncrement: true });
            };
            req.onsuccess = e => {
                db = e.target.result;
                log('openDB success');
                done();
            };
            req.onerror = e => {
                log('openDB error', e); // continue without IndexedDB
                done();
            };
        } catch(err) {
            log('openDB exception', err);
            done();
        }
        setTimeout(() => { log('openDB timeout'); done(); }, 3000);
    });
}

function idbGet(key, storeName='settings') {
    // IndexedDB null crash fix history:
    // 1. Crashed when openDB failed and db remained null.
    //    Added check to return null and log when db unavailable.
    // 2. Added localStorage fallback when IndexedDB is unavailable.
    return new Promise(resolve => {
        if(!db){
            log('idbGet fallback localStorage', {key, storeName});
            const lsKey = `${storeName}:${encodeURIComponent(JSON.stringify(key))}`;
            const val = localStorage.getItem(lsKey);
            resolve(val ? JSON.parse(val) : null);
            return;
        }
        const tx = db.transaction(storeName);
        const store = tx.objectStore(storeName);
        const getReq = store.get(key);
        getReq.onsuccess = () => {
            resolve(getReq.result);
        };
        getReq.onerror = () => resolve(null);
    });
}

function idbSet(key, val, storeName='settings') {
    // IndexedDB null crash fix history:
    // 1. Added early return when db is not available.
    // 2. Added localStorage fallback when IndexedDB is unavailable.
    return new Promise(resolve => {
        if(!db){
            log('idbSet fallback localStorage', {key, storeName});
            const lsKey = `${storeName}:${encodeURIComponent(JSON.stringify(key))}`;
            if(val === undefined || val === null) localStorage.removeItem(lsKey);
            else localStorage.setItem(lsKey, JSON.stringify(val));
            resolve();
            return;
        }
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        // If store uses a key path, omit explicit key to avoid DataError
        if(store.keyPath) store.put(val);
        else store.put(val, key);
        tx.oncomplete = () => {
            resolve();
        };
    });
}

function applyTheme() {
    if(theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
}
applyTheme();

function showToast(msg, type='success', seconds=3, h=40, w=200, loc='upper middle') {
    const container = document.getElementById('toast-container');
    if(!container) return null;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    toast.style.height = h + 'px';
    toast.style.width = w + 'px';
    const [vert, horiz] = loc.split(' ');
    toast.style[vert.includes('lower')? 'bottom':'top'] = '10px';
    toast.style[horiz.includes('right')? 'right': horiz.includes('middle')? 'left':'left'] = horiz.includes('middle')? '50%':'10px';
    if(horiz.includes('middle')) toast.style.transform = 'translateX(-50%)';
    container.appendChild(toast);
    if(seconds>0) setTimeout(()=>toast.remove(), seconds*1000);
    return toast;
}

function updateRepoLabels() {
    document.getElementById('repo-label').textContent = currentRepo ? currentRepo.full_name : 'No repo selected';
    document.getElementById('branch-label').textContent = currentBranch ? ' - ' + currentBranch : '';
}

// Settings modal close bug fix history:
// 1. Switched to addEventListener to avoid duplicate handlers.
// 2. Added stopPropagation when closing to prevent immediate reopen.
// 3. Current fix ensures inline styles don't interfere with display.
function openSettings() {
    log('openSettings', {accessToken, clientId, clientSecret});
    const modal = document.getElementById('settings-modal');
    // ensure display resets in case inline styles were added while debugging
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
    showTab('github');
    document.getElementById('auth-status').textContent = accessToken ? 'Connected' : 'Not connected';
    if(accessToken){
        document.getElementById('auth-btn').innerHTML = '❌ Disconnect';
    } else {
        document.getElementById('auth-btn').innerHTML = '<img src="https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png" alt="GitHub" class="icon"> Connect GitHub';
    }
    document.getElementById('first-run').classList.toggle('hidden', !!accessToken);
    document.getElementById('client-id-input').value = clientId || '';
    document.getElementById('client-secret-input').value = clientSecret || '';
    document.getElementById('theme-select').value = theme;
    document.getElementById('llm-provider-select').value = llmProvider || 'openai';
    document.getElementById('llm-api-key').value = llmApiKey || '';
    document.getElementById('llm-model-select').value = llmModel || '';
    updateModelList();
    document.getElementById('llm-async').checked = !!llmAsync;
}

function closeSettings(e) {
    // stopPropagation ensures the modal doesn't immediately reopen
    if(e) e.stopPropagation();
    log('closeSettings');
    const modal = document.getElementById('settings-modal');
    modal.classList.add('hidden');
    // explicitly hide in case class removal fails
    modal.style.display = 'none';
}

function showTab(name){
    document.querySelectorAll('.settings-tab').forEach(btn=>{
        btn.classList.toggle('active', btn.dataset.tab===name);
    });
    document.querySelectorAll('.settings-pane').forEach(p=>p.classList.remove('active'));
    const pane=document.getElementById('tab-'+name);
    if(pane) pane.classList.add('active');
}

function handleThemeChange() {
    theme = document.getElementById('theme-select').value;
    localStorage.setItem('theme', theme);
    applyTheme();
}

function openGitHubSettings(){
    window.open('https://github.com/settings/applications/new', '_blank');
}

async function updateModelList(){
    const provider = document.getElementById('llm-provider-select').value;
    const key = document.getElementById('llm-api-key').value.trim();
    const sel = document.getElementById('llm-model-select');
    if(!key){
        sel.innerHTML = '<option value="">Enter API key</option>';
        return;
    }
    sel.innerHTML = '<option>Loading...</option>';
    try{
        let models = [];
        if(provider === 'openai'){
            const r = await fetch('https://api.openai.com/v1/models',{headers:{Authorization:`Bearer ${key}`}});
            const d = await r.json();
            models = (d.data||[]).map(m=>m.id).filter(id=>/^gpt|^text-/.test(id));
        }else if(provider === 'anthropic'){
            const r = await fetch('https://api.anthropic.com/v1/models',{headers:{'x-api-key':key,'anthropic-version':'2023-06-01'}});
            const d = await r.json();
            models = (d.models||d.data||[]).map(m=>m.id||m.name);
        }else if(provider === 'google'){
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
            const d = await r.json();
            models = (d.models||[]).map(m=>m.name.replace(/^models\//,''));
        }
        sel.innerHTML = '';
        models.forEach(m=>{ const o=document.createElement('option'); o.value=m; o.textContent=m; sel.appendChild(o); });
        if(llmModel && models.includes(llmModel)) sel.value=llmModel;
    }catch(err){
        console.error('updateModelList',err);
        sel.innerHTML = '<option value="">Error loading models</option>';
    }
}

function saveLLMSettings(){
    llmProvider = document.getElementById('llm-provider-select').value;
    llmApiKey = document.getElementById('llm-api-key').value.trim();
    llmModel = document.getElementById('llm-model-select').value;
    idbSet('llm_model', llmModel);
    llmAsync = document.getElementById('llm-async').checked;
    idbSet('llm_provider', llmProvider);
    idbSet('llm_api_key', llmApiKey);
    idbSet('llm_async', llmAsync);
    showToast('LLM settings saved','success',2,40,200,'upper middle');
    closeSettings();
}

let instructionsData = [];
let currentInstructionId = null;
let currentDescPath = null;

const DEFAULT_PRESETS = {
    '-1': {
        id: -1,
        title: 'Code',
        text: `SYSTEM:\nYou are an automated code-modification agent.\nReturn ONE unified git patch wrapped in \`\`\`patch … \`\`\`; no commentary.`
    },
    '-2': {
        id: -2,
        title: 'Ask',
        text: `SYSTEM:\nYou are a knowledgeable development assistant.`
    }
};

function loadInstructions(){
    if(!db){
        log('loadInstructions skipped, db not initialized; using localStorage');
        try {
            instructionsData = JSON.parse(localStorage.getItem('instructions') || '[]');
            for(const key in DEFAULT_PRESETS){
                if(!instructionsData.find(i=>i.id===Number(key))) instructionsData.push({...DEFAULT_PRESETS[key]});
            }
            localStorage.setItem('instructions', JSON.stringify(instructionsData));
        } catch(err) {
            instructionsData = [];
        }
        renderInstructions();
        return;
    }
    const tx = db.transaction('instructions', 'readwrite');
    const store = tx.objectStore('instructions');
    const req = store.getAll();
    req.onsuccess = () => {
        instructionsData = req.result || [];
        let changed=false;
        for(const key in DEFAULT_PRESETS){
            if(!instructionsData.find(i=>i.id===Number(key))){
                instructionsData.push({...DEFAULT_PRESETS[key]});
                store.put(DEFAULT_PRESETS[key]);
                changed=true;
            }
        }
        if(changed) localStorage.setItem('instructions', JSON.stringify(instructionsData));
        else localStorage.setItem('instructions', JSON.stringify(instructionsData));
        renderInstructions();
    };
}

function renderInstructions(){
    const list = document.getElementById('instructions-list');
    list.innerHTML = '';
    instructionsData.forEach(instr => {
        const div = document.createElement('div');
        const toggle = document.createElement('input');
        toggle.type='checkbox';
        toggle.className='instruction-toggle';
        toggle.dataset.id=instr.id;
        toggle.addEventListener('change', updateOutputCards);
        const span = document.createElement('span');
        span.textContent = instr.title;
        span.className = 'instruction-title';
        span.style.cursor = 'pointer';
        span.addEventListener('click', () => openInstructionModal(instr.id));
        div.appendChild(toggle);
        div.appendChild(span);
        list.appendChild(div);
    });
    updateOutputCards();
}

function loadTasks(){
    if(!db){
        try{
            tasksData=JSON.parse(localStorage.getItem('tasks')||'[]');
        }catch(err){ tasksData=[]; }
        renderTasks();
        return;
    }
    const store=db.transaction('tasks').objectStore('tasks');
    const req=store.getAll();
    req.onsuccess=()=>{ tasksData=req.result||[]; renderTasks(); };
}

function saveTask(task){
    if(!db){
        let arr=[];
        try{ arr=JSON.parse(localStorage.getItem('tasks')||'[]'); }catch(err){}
        const idx=arr.findIndex(t=>t.id===task.id);
        if(idx!==-1) arr[idx]=task; else arr.push(task);
        localStorage.setItem('tasks',JSON.stringify(arr));
        return;
    }
    const store=db.transaction('tasks','readwrite').objectStore('tasks');
    store.put(task);
}

function addTask(task){
    tasksData.unshift(task);
    saveTask(task);
    renderTasks();
}

async function applyPatchLowLevel(task){
    log('applyPatchLowLevel', {dryRun});
    if(dryRun){
        task.status = 'open_pr (dry-run)';
        saveTask(task);
        renderTasks();
        return;
    }
    // TODO: implement GitHub commit and PR creation
    task.status = 'open_pr';
    saveTask(task);
    renderTasks();
}

function parseModelOutput(text){
    let title='';
    let patch='';
    try{
        const header=text.match(/\{[\s\S]*?\}/);
        if(header){
            const obj=JSON.parse(header[0]);
            title=obj.title||'';
            text=text.slice(header.index+header[0].length);
        }
        const m=text.match(/```patch\n([\s\S]*?)\n```/);
        if(m) patch=m[1].trim();
    }catch(err){ log('parseModelOutput error',err); }
    return {title, patch};
}

function renderTasks(){
    const list=document.getElementById('task-list');
    if(!list) return;
    list.innerHTML='';
    tasksData.sort((a,b)=>b.created-a.created).forEach(t=>{
        const row=document.createElement('div');
        row.className='task-row';
        const title=document.createElement('div');
        title.className='task-title';
        title.textContent=t.title||'Pending';
        const status=document.createElement('div');
        status.className='task-status';
        const icon=STATUS_ICONS[t.status]||'';
        status.textContent=icon+' '+t.status;
        row.appendChild(title);
        row.appendChild(status);
        if(t.patch){
            const pre=document.createElement('pre');
            pre.className='diff';
            t.patch.split('\n').forEach(line=>{
                const span=document.createElement('span');
                if(line.startsWith('+')) span.className='diff-add';
                else if(line.startsWith('-')) span.className='diff-del';
                else if(line.startsWith('@@')) span.className='diff-hunk';
                span.textContent=line;
                pre.appendChild(span);
                pre.appendChild(document.createTextNode('\n'));
            });
            row.appendChild(pre);
            const apply=document.createElement('button');
            apply.textContent='Apply';
            apply.className='small-btn';
            apply.disabled=t.status!=='pending';
            apply.addEventListener('click',()=>applyPatchLowLevel(t));
            row.appendChild(apply);
        }
        if(t.status==='error'){
            const retry=document.createElement('button');
            retry.textContent='Retry';
            retry.className='small-btn retry-btn';
            retry.addEventListener('click',()=>retryTask(t));
            row.appendChild(retry);
        }
        list.appendChild(row);
    });
}

// Instruction modal open bug fix history:
// 1. Basic open with values populated.
// 2. Ensured display is explicitly set so CSS doesn't override.
function openInstructionModal(id=null){
    log('openInstructionModal', {id});
    currentInstructionId = id;
    const modal = document.getElementById('instruction-modal');
    const titleEl = document.getElementById('instruction-title');
    const textEl = document.getElementById('instruction-text');
    const restoreBtn=document.getElementById('instruction-restore');
    if(id){
        const instr = instructionsData.find(i=>i.id===id);
        titleEl.value = instr ? instr.title : '';
        textEl.value = instr ? instr.text : '';
        if(restoreBtn) restoreBtn.classList.toggle('hidden', !(id<0));
    } else {
        titleEl.value='';
        textEl.value='';
        if(restoreBtn) restoreBtn.classList.add('hidden');
    }
    modal.style.display='flex';
    modal.classList.remove('hidden');
}

// Instruction modal close bug fix history:
// 1. Initial implementation simply hid the element.
// 2. Added optional event argument with stopPropagation to mirror settings modal.
function closeInstructionModal(e){
    if(e) e.stopPropagation();
    log('closeInstructionModal');
    const modal = document.getElementById('instruction-modal');
    modal.classList.add('hidden');
    modal.style.display='none';
    currentInstructionId=null;
}

async function saveInstruction(){
    const title=document.getElementById('instruction-title').value.trim();
    const text=document.getElementById('instruction-text').value.trim();
    if(!title) { showToast('Title required','warning'); return; }
    if(!db){
        log('saveInstruction db not initialized, attempting reopen');
        await openDB();
    }
    if(!db){
        log('saveInstruction using localStorage fallback');
        if(currentInstructionId){
            const idx = instructionsData.findIndex(i=>i.id===currentInstructionId);
            if(idx!==-1) instructionsData[idx] = {id:currentInstructionId,title,text};
        } else {
            const nextId = instructionsData.reduce((max,i)=>Math.max(max,i.id||0),0)+1;
            instructionsData.push({id:nextId,title,text});
        }
        localStorage.setItem('instructions', JSON.stringify(instructionsData));
        loadInstructions();
        showToast('Instruction saved','success',2,40,200,'upper middle');
        closeInstructionModal();
        return;
    }
    const store = db.transaction('instructions','readwrite').objectStore('instructions');
    if(currentInstructionId){
        store.put({id:currentInstructionId,title,text});
    } else {
        store.add({title,text});
    }
    store.transaction.oncomplete=()=>{ 
        loadInstructions();
        showToast('Instruction saved','success',2,40,200,'upper middle');
        closeInstructionModal(); 
    };
}

function deleteInstruction(){
    if(currentInstructionId){
        if(!db){
            log('deleteInstruction skipped, db not initialized; using localStorage');
            instructionsData = instructionsData.filter(i=>i.id!==currentInstructionId);
            localStorage.setItem('instructions', JSON.stringify(instructionsData));
            loadInstructions();
            closeInstructionModal();
            return;
        }
        const store = db.transaction('instructions','readwrite').objectStore('instructions');
        store.delete(currentInstructionId);
        store.transaction.oncomplete=()=>{ loadInstructions(); closeInstructionModal(); };
    } else {
        closeInstructionModal();
    }
}

function restoreInstructionDefault(){
    if(currentInstructionId && currentInstructionId<0){
        const preset=DEFAULT_PRESETS[String(currentInstructionId)];
        if(!preset) return;
        document.getElementById('instruction-title').value=preset.title;
        document.getElementById('instruction-text').value=preset.text;
    }
}

function handleAuthBtn() {
    log('handleAuthBtn', {hasToken: !!accessToken});
    if(accessToken) {
        localStorage.removeItem('gh_token');
        accessToken = null;
        showToast('Disconnected', 'warning', 2, 40, 200, 'upper middle');
    } else {
        clientId = document.getElementById('client-id-input').value.trim();
        clientSecret = document.getElementById('client-secret-input').value.trim();
        idbSet('client_id', clientId);
        idbSet('client_secret', clientSecret);
        startOAuth();
    }
    closeSettings();
}

// GitHub OAuth error toast fix history:
// 1. Added client ID check to show configuration error.
// 2. Styled toast for better readability.
function startOAuth() {
    if(!clientId || !clientSecret) {
        showToast('Enter your GitHub credentials first', 'error', 3, 40, 200, 'upper middle');
        return;
    }
    const state = btoa(Math.random().toString(36).substring(2));
    localStorage.setItem('oauth_state', state);
    const authURL = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=repo&state=${state}`;
    window.open(authURL, "_blank");
}

function handleRedirect() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const returnedState = params.get('state');
    if(code) {
        const expected = localStorage.getItem('oauth_state');
        if(returnedState !== expected) {
            log('oauth_state mismatch', {expected, returnedState});
            return;
        }
        log('handleRedirect exchanging code');
        fetch(EXCHANGE_URL, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({code, client_id: clientId, client_secret: clientSecret})
        }).then(async r => {
            const data = await r.json();
            accessToken = data.access_token;
            if(accessToken) {
                localStorage.setItem('gh_token', accessToken);
                showToast('Connected', 'success', 2, 40, 200, 'upper middle');
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }).catch(err => log('token exchange failed', err));
    }
}

function openRepoModal() {
    log('openRepoModal', {hasToken: !!accessToken});
    if(!accessToken) {
                showToast('Connect GitHub first', 'warning', 2);
        return;
    }
    const overlay = document.getElementById('modal-overlay');
    overlay.style.display = 'flex';
    overlay.classList.remove('hidden');
    loadRepos();
}

function closeRepoModal() {
    log('closeRepoModal');
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.add('hidden');
    overlay.style.display = 'none';
}

function loadRepos() {
        fetch('https://api.github.com/user/repos?per_page=100', {
        headers:{Authorization:`token ${accessToken}`, Accept:'application/vnd.github+json'}
    })
    .then(async r=>{
                const repos = await r.json();
                return repos;
    })
    .then(repos=>{
        const select = document.getElementById('repo-select');
        select.innerHTML='';
        repos.forEach(r=>{
            const opt=document.createElement('option');
            opt.value=r.full_name;
            opt.textContent=r.full_name;
            select.appendChild(opt);
        });
        if(currentRepo) select.value=currentRepo.full_name;
        loadBranches();
    });
}

function loadBranches() {
    const repoFull = document.getElementById('repo-select').value;
    const [owner, repo]=repoFull.split('/');
        fetch(`https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`, {
        headers:{Authorization:`token ${accessToken}`, Accept:'application/vnd.github+json'}
    })
    .then(async r=>{
                const branches = await r.json();
                return branches;
    })
    .then(branches=>{
        branchesData = branches || [];
        const select = document.getElementById('branch-select');
        select.innerHTML='';
        branchesData.forEach(b=>{
            const opt=document.createElement('option');
            opt.value=b.name;
            opt.textContent=b.name;
            select.appendChild(opt);
        });
        if(currentBranch){
            select.value=currentBranch;
            const bObj = branchesData.find(b=>b.name===currentBranch);
            currentBranchSha = bObj ? bObj.commit.sha : null;
        }
    });
}

function confirmRepoBranch() {
    log('confirmRepoBranch');
    const repoFull = document.getElementById('repo-select').value;
    const branch = document.getElementById('branch-select').value;
    const [owner, repo]=repoFull.split('/');
    currentRepo={full_name:repoFull, owner, repo};
    currentBranch=branch;
    const bObj = branchesData.find(b=>b.name===branch);
    currentBranchSha = bObj ? bObj.commit.sha : null;
    localStorage.setItem('current_repo', JSON.stringify(currentRepo));
    localStorage.setItem('current_branch', currentBranch);
        updateRepoLabels();
    loadFileTree();
    closeRepoModal();
}

function loadFileTree() {
    log('loadFileTree', {repo: currentRepo, branch: currentBranch, hasToken: !!accessToken});
    if(!currentRepo || !currentBranch || !accessToken) {
        return;
    }
    const ref = currentBranchSha || currentBranch;
    const url=`https://api.github.com/repos/${currentRepo.owner}/${currentRepo.repo}/git/trees/${ref}?recursive=1`;
        fetch(url,{headers:{Authorization:`token ${accessToken}`,Accept:'application/vnd.github+json'}})
    .then(async r=>{
                const data = await r.json();
                return data;
    }).then(data=>{
        repoTree = data.tree || [];
        buildTree(repoTree);
        buildDescTree(repoTree);
        applySavedSelections();
    });
}

function buildTree(tree) {
    const container=document.getElementById('file-tree');
    container.innerHTML='';
    const root={};
    tree.forEach(item=>{
        const parts=item.path.split('/');
        let node=root;
        parts.forEach((part,i)=>{
            if(!node[part]) node[part]={};
            if(i===parts.length-1) node[part]._item=item; // file
            node=node[part];
        });
    });
    const ul=document.createElement('ul');
    createList(root,ul);
    container.appendChild(ul);
}

function buildDescTree(tree){
    const container=document.getElementById('desc-tree');
    if(!container) return;
    container.innerHTML='';
    const root={};
    tree.forEach(item=>{
        const parts=item.path.split('/');
        let node=root;
        parts.forEach((part,i)=>{
            if(!node[part]) node[part]={};
            if(i===parts.length-1) node[part]._item=item;
            node=node[part];
        });
    });
    const ul=document.createElement('ul');
    createDescList(root,ul);
    container.appendChild(ul);
}

function createDescList(obj,parent){
    Object.keys(obj).forEach(key=>{
        if(key==='_item') return;
        const li=document.createElement('li');
        const checkbox=document.createElement('input');
        checkbox.type='checkbox';
        const hasChildren=Object.keys(obj[key]).some(k=>k!=='_item');
        const isFolder=hasChildren;
        if(isFolder){
            const parentPath=getParentPath(parent);
            checkbox.dataset.folder='true';
            checkbox.dataset.path=parentPath?`${parentPath}/${key}`:key;
        }else{
            checkbox.dataset.path=obj[key]._item.path;
        }
        checkbox.addEventListener('change', updateOutputCards);
        const nameSpan=document.createElement('span');
        nameSpan.textContent=' '+key+' ';
        if(!isFolder){
            nameSpan.className='desc-file';
            nameSpan.dataset.path=checkbox.dataset.path;
            nameSpan.addEventListener('click', openDescriptionModal);
            const statusSpan=document.createElement('span');
            statusSpan.className='desc-status';
            statusSpan.dataset.path=checkbox.dataset.path;
            loadDescriptionStatus(checkbox.dataset.path).then(stat=>{
                statusSpan.textContent=stat;
            });
            li.appendChild(statusSpan);
        }
        li.appendChild(checkbox);
        li.appendChild(nameSpan);
        parent.appendChild(li);
        if(hasChildren){
            const ul=document.createElement('ul');
            createDescList(obj[key],ul);
            li.appendChild(ul);
        }
    });
}

function loadDescriptionStatus(path){
    return new Promise(resolve=>{
        const key=[currentRepo?currentRepo.full_name:'', currentBranch || '', path];
        if(!db){
            log('loadDescriptionStatus fallback localStorage');
            idbGet(key,'descriptions').then(rec=>{
                if(!rec) resolve('❌');
                else if(rec.na) resolve('🚫');
                else resolve('✅');
            });
            return;
        }
        const tx=db.transaction('descriptions');
        const store=tx.objectStore('descriptions');
        const req=store.get(key);
        req.onsuccess=()=>{
            const rec=req.result;
            if(!rec) resolve('❌');
            else if(rec.na) resolve('🚫');
            else resolve('✅');
        };
        req.onerror=()=>resolve('❌');
    });
}

async function openDescriptionModal(e){
    e.stopPropagation();
    currentDescPath = e.target.dataset.path;
    document.getElementById('description-path').textContent = currentDescPath;
    document.getElementById('description-text').value = '';
    document.getElementById('description-skip').checked = false;
    if(db && currentRepo && currentBranch){
        const key=[currentRepo.full_name, currentBranch, currentDescPath];
        const rec=await idbGet(key,'descriptions');
        if(rec){
            document.getElementById('description-text').value = rec.text || '';
            document.getElementById('description-skip').checked = !!rec.na;
        }
    }
    const modal=document.getElementById('description-modal');
    modal.style.display='flex';
    modal.classList.remove('hidden');
}

function closeDescriptionModal(e){
    if(e) e.stopPropagation();
    const modal=document.getElementById('description-modal');
    modal.classList.add('hidden');
    modal.style.display='none';
    currentDescPath=null;
}

function saveDescription(){
    if(!currentRepo || !currentBranch || !currentDescPath){
        showToast('Database unavailable','error');
        closeDescriptionModal();
        return;
    }
    const text=document.getElementById('description-text').value.trim();
    const na=document.getElementById('description-skip').checked;
    const rec={repo:currentRepo.full_name, branch:currentBranch, path:currentDescPath, text, na};
    if(!db){
        log('saveDescription localStorage fallback');
        idbSet([currentRepo.full_name,currentBranch,currentDescPath], rec, 'descriptions').then(()=>{
            updateDescStatus(currentDescPath);
            showToast('Description saved','success',2,40,200,'upper middle');
            closeDescriptionModal();
        });
        return;
    }
    const store=db.transaction('descriptions','readwrite').objectStore('descriptions');
    store.put(rec);
    store.transaction.oncomplete=()=>{
        updateDescStatus(currentDescPath);
        showToast('Description saved','success',2,40,200,'upper middle');
        closeDescriptionModal();
    };
}

function updateDescStatus(path){
    const span=document.querySelector(`.desc-status[data-path="${path}"]`);
    if(span) loadDescriptionStatus(path).then(stat=>{span.textContent=stat;});
}

async function callLLM(prompt){
    try{
        if(window.LLM_PROXY_URL){
            log('callLLM via proxy', {provider: llmProvider, model: llmModel});
            const resp=await fetch(window.LLM_PROXY_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:llmProvider,model:llmModel,prompt,apiKey:llmApiKey})});
            const text = await resp.text();
            log('callLLM proxy status', resp.status);
            if(!resp.ok){
                log('callLLM proxy error body', text);
                throw new Error(`Proxy request failed (${resp.status})`);
            }
            const data=JSON.parse(text);
            if(llmProvider==='openai') return (data.choices && data.choices[0].message.content) || '';
            if(llmProvider==='anthropic') return (data.content && data.content[0] && data.content[0].text) || '';
            if(llmProvider==='google') return (data.candidates && data.candidates[0] && data.candidates[0].content.parts[0].text) || '';
            return '';
        }
        if(llmProvider === 'openai'){
            const body = {model: llmModel || 'gpt-3.5-turbo',messages:[{role:'system',content:'You generate detailed descriptions of project files.'},{role:'user',content:prompt}]};
            const res = await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${llmApiKey}`},body:JSON.stringify(body)});
            const data = await res.json();
            return (data.choices && data.choices[0].message.content) || '';
        } else if(llmProvider === 'anthropic'){
            const body = {model: llmModel || 'claude-3-haiku-20240307',messages:[{role:'user',content:prompt}],max_tokens:1024};
            const res = await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':llmApiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify(body)});
            const data = await res.json();
            return (data.content && data.content[0] && data.content[0].text) || '';
        } else if(llmProvider === 'google'){
            const body = {contents:[{role:'user',parts:[{text:prompt}]}]};
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${llmModel || 'gemini-pro'}:generateContent?key=${llmApiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
            const data = await res.json();
            return (data.candidates && data.candidates[0] && data.candidates[0].content.parts[0].text) || '';
        }
        return '';
    }catch(err){
        log('callLLM error',err);
        if(err.message && err.message.includes('Failed to fetch')){
            showToast('LLM request blocked by CORS','error',4,40,220,'upper middle');
        }else{
            showToast(`LLM request failed: ${err.message}`,'error',3,40,200,'upper middle');
        }
        throw err;
    }
}

async function generateDescriptions(){
    if(!llmApiKey){
        openSettings();
        return;
    }
    const statusEl=document.getElementById('generate-status');
    statusEl.textContent='Starting...';
    const files=(repoTree||[]).filter(item=>item.type==='blob');
    const pending=[];
    log('generateDescriptions start', { total: files.length });
    for(const f of files){
        const key=[currentRepo.full_name,currentBranch,f.path];
        const rec=await idbGet(key,'descriptions');
        if(!rec || (!rec.text && !rec.na)) pending.push(f);
    }
    const run=async f=>{
        log('generateDescriptions processing', f.path);
        statusEl.textContent=`Fetching ${f.path}`;
        const fileUrl=`https://api.github.com/repos/${currentRepo.full_name}/contents/${f.path}?ref=${currentBranch}`;
        const resp=await fetch(fileUrl,{headers:{Authorization:`token ${accessToken}`,Accept:'application/vnd.github.raw'}});
        const content=await resp.text();
        const prompt = `Describe the purpose and contents of this file for developers:\n\n${content}`;
        const text = await callLLM(prompt);
        const rec = {repo:currentRepo.full_name,branch:currentBranch,path:f.path,text};
        await idbSet([rec.repo,rec.branch,rec.path],rec,'descriptions');
        updateDescStatus(f.path);
        log('generateDescriptions saved', f.path);
    };
    let asyncFailed=false;
    if(llmAsync){
        try{ await Promise.all(pending.map(run)); }
        catch(err){ asyncFailed=true; log('async gen failed',err); showToast('LLM request failed','error',3,40,200,'upper middle'); }
    }
    if(!llmAsync || asyncFailed){
        for(const f of pending){
            try{ await run(f); }catch(err){ log('sync gen failed',err); showToast('LLM request failed','error',3,40,200,'upper middle'); break; }
        }
    }
    statusEl.textContent='Done';
}

async function updateOutputCards(){
    const container=document.getElementById('output-cards');
    container.innerHTML='';
    const cards=[];
    const filePaths=getSelectedPaths();
    if(filePaths.length){
        const contents=[];
        const lineNumbers=document.getElementById('include-line-numbers').checked;
        for(const p of filePaths){
            const url=`https://api.github.com/repos/${currentRepo.full_name}/contents/${p}?ref=${currentBranch}`;
            const resp=await fetch(url,{headers:{Authorization:`token ${accessToken}`,Accept:'application/vnd.github.raw'}});
            let text=await resp.text();
            if(lineNumbers) text=addLineNumbers(text);
            contents.push(text);
        }
        const total=contents.join('\n').length;
        const tokens=approximateTokens(Math.ceil(total/4.7));
        const card=document.createElement('div');
        card.className='card';
        card.draggable=true;
        card.dataset.type='files';
        card.dataset.paths=JSON.stringify(filePaths);
        card.dataset.tokens=tokens;
        card.textContent=`Selected Files - ${formatTokens(tokens)} tokens`;
        cards.push(card);
    }
    const selectedInstr=document.querySelectorAll('.instruction-toggle:checked');
    selectedInstr.forEach(cb=>{
        const instr=instructionsData.find(i=>i.id==cb.dataset.id);
        if(instr){
            const tokens=approximateTokens(Math.ceil(instr.text.length/4.7));
            const card=document.createElement('div');
            card.className='card';
            card.draggable=true;
            card.dataset.type='instruction';
            card.dataset.id=instr.id;
            card.dataset.tokens=tokens;
            card.textContent=`${instr.title} - ${formatTokens(tokens)} tokens`;
            cards.push(card);
        }
    });
    const descChecks=document.querySelectorAll('#desc-tree input[type=checkbox]:checked');
    if(descChecks.length){
        let total=0;
        for(const cb of descChecks){
            const key=[currentRepo.full_name, currentBranch, cb.dataset.path];
            const rec=await idbGet(key,'descriptions');
            if(rec && rec.text) total+=rec.text.length;
        }
        const tokens=approximateTokens(Math.ceil(total/4.7));
        const card=document.createElement('div');
        card.className='card';
        card.draggable=true;
        card.dataset.type='descriptions';
        card.dataset.tokens=tokens;
        card.textContent=`File Descriptions - ${formatTokens(tokens)} tokens`;
        cards.push(card);
    }
    const aiToggle=document.getElementById('ai-instructions-toggle');
    const aiText=document.getElementById('ai-instructions').value.trim();
    if(aiToggle && aiToggle.checked && aiText){
        const tokens=approximateTokens(Math.ceil(aiText.length/4.7));
        const card=document.createElement('div');
        card.className='card';
        card.draggable=true;
        card.dataset.type='ai';
        card.dataset.tokens=tokens;
        card.textContent=`AI Request - ${formatTokens(tokens)} tokens`;
        cards.push(card);
    }
    cards.forEach(c=>container.appendChild(c));
    const dragHint=document.getElementById('drag-hint');
    if(cards.length>1){
        container.classList.add('multi-card');
        if(dragHint) dragHint.style.display='block';
    }else{
        container.classList.remove('multi-card');
        if(dragHint) dragHint.style.display='none';
    }
    initDrag(container);
    updateTotalTokens();
    updateGenerateButton();
    saveSelections();
}

function initDrag(container){
    let dragEl=null;
    container.querySelectorAll('.card').forEach(card=>{
        card.addEventListener('dragstart',e=>{dragEl=card; card.classList.add('dragging');});
        card.addEventListener('dragend',e=>{card.classList.remove('dragging'); updateTotalTokens();});
        card.addEventListener('dragover',e=>{e.preventDefault(); const after=getDragAfterElement(container,e.clientY); if(after==null) container.appendChild(dragEl); else container.insertBefore(dragEl, after);});
    });
}

function getDragAfterElement(container,y){
    const els=[...container.querySelectorAll('.card:not(.dragging)')];
    return els.reduce((closest,child)=>{
        const box=child.getBoundingClientRect();
        const offset=y-box.top-box.height/2;
        if(offset<0 && offset>closest.offset){
            return {offset,element:child};
        }else{ return closest; }
    },{offset:-Infinity}).element;
}

function updateTotalTokens(){
    const total=getTotalTokens();
    document.getElementById('total-tokens').textContent=`(${formatTokens(total)} tokens)`;
}

function getTotalTokens(){
    const container=document.getElementById('output-cards');
    let total=0;
    if(container){
        container.querySelectorAll('.card').forEach(c=>{ total+=Number(c.dataset.tokens)||0; });
    }
    return total;
}

function approximateTokens(count){
    return count>=10000 ? Math.round(count/1000)*1000 : Math.round(count/500)*500;
}

function formatTokens(count){
    return `~${count.toLocaleString()}`;
}

function updateGenerateButton(){
    const btn=document.getElementById('generate-btn');
    if(!btn) return;
    const container=document.getElementById('output-cards');
    const hasCards=container && container.children.length>0;
    const aiToggle=document.getElementById('ai-instructions-toggle');
    const aiText=document.getElementById('ai-instructions').value.trim();
    const aiOk=!aiToggle||!aiToggle.checked||!!aiText;
    const total=getTotalTokens();
    btn.disabled=!(hasCards && aiOk) || total>MAX_PROMPT_TOKENS;
}

function showPromptTab(name){
    document.querySelectorAll('.prompt-tab').forEach(btn=>{
        btn.classList.toggle('active', btn.dataset.tab===name);
    });
    document.querySelectorAll('.prompt-pane').forEach(p=>p.classList.remove('active'));
    const pane=document.getElementById(`prompt-${name}`);
    if(pane) pane.classList.add('active');
}

function openPromptModal(promptText='', payload=''){
    currentPromptText = promptText;
    const modal=document.getElementById('prompt-modal');
    document.getElementById('prompt-prompt').textContent=promptText;
    document.getElementById('prompt-payload').textContent=payload;
    showPromptTab('prompt');
    modal.style.display='flex';
    modal.classList.remove('hidden');
}

function closePromptModal(e){
    if(e) e.stopPropagation();
    const modal=document.getElementById('prompt-modal');
    modal.classList.add('hidden');
    modal.style.display='none';
}

async function handlePromptSend(){
    log('handlePromptSend');
    closePromptModal();
    if(!llmApiKey){ openSettings(); return; }
    if(Date.now()-lastLlmTime < MIN_LLM_INTERVAL){
        showToast('Please wait before sending again','warning');
        return;
    }
    const task={
        title:'Pending',
        prompt:currentPromptText,
        patch:null,
        branch:null,
        prUrl:null,
        status:'pending',
        created:Date.now()
    };
    addTask(task);
    const progress=showToast('Calling LLM...','info',0,40,200,'upper middle');
    try{
        const resp=await callLLM(currentPromptText);
        const parsed=parseModelOutput(resp);
        task.patch=parsed.patch||resp;
        if(parsed.title) task.title=parsed.title;
        if(task.patch && task.patch.split('\n').length>MAX_PATCH_LINES){
            task.status='error';
            task.patch=null;
            showToast('Diff too large','error');
        }
        saveTask(task);
        lastLlmTime=Date.now();
    }catch(err){
        task.status='error';
        saveTask(task);
        lastLlmTime=Date.now();
    }
    if(progress) progress.remove();
    renderTasks();
}

async function retryTask(task){
    if(task.status!=='error') return;
    if(Date.now()-lastLlmTime < MIN_LLM_INTERVAL){
        showToast('Please wait before sending again','warning');
        return;
    }
    task.status='pending';
    saveTask(task);
    renderTasks();
    const progress=showToast('Calling LLM...','info',0,40,200,'upper middle');
    try{
        const resp=await callLLM(task.prompt);
        const parsed=parseModelOutput(resp);
        task.patch=parsed.patch||resp;
        if(parsed.title) task.title=parsed.title;
        if(task.patch && task.patch.split('\n').length>MAX_PATCH_LINES){
            task.status='error';
            task.patch=null;
            showToast('Diff too large','error');
        }
        saveTask(task);
        lastLlmTime=Date.now();
    }catch(err){
        task.status='error';
        saveTask(task);
        lastLlmTime=Date.now();
    }
    if(progress) progress.remove();
    renderTasks();
}

async function buildContextBundle(){
    const bundle={files:[],instructions:[],aiRequest:null,descriptions:[]};
    const container=document.getElementById('output-cards');
    const lineNumbers=document.getElementById('include-line-numbers').checked;
    const aiToggle=document.getElementById('ai-instructions-toggle');
    const aiText=document.getElementById('ai-instructions').value.trim();
    if(aiToggle && aiToggle.checked && aiText) bundle.aiRequest=aiText;
    for(const card of container.children){
        if(card.dataset.type==='files'){
            const paths=JSON.parse(card.dataset.paths||'[]');
            for(const p of paths){
                const url=`https://api.github.com/repos/${currentRepo.full_name}/contents/${p}?ref=${currentBranch}`;
                const resp=await fetch(url,{headers:{Authorization:`token ${accessToken}`,Accept:'application/vnd.github.raw'}});
                let text=await resp.text();
                if(lineNumbers) text=addLineNumbers(text);
                bundle.files.push({path:p,text});
            }
        }else if(card.dataset.type==='instruction'){
            const instr=instructionsData.find(i=>i.id==card.dataset.id);
            if(instr) bundle.instructions.push(instr.text);
        }else if(card.dataset.type==='descriptions'){
            const descChecks=document.querySelectorAll('#desc-tree input[type=checkbox]:checked');
            for(const cb of descChecks){
                const key=[currentRepo.full_name,currentBranch,cb.dataset.path];
                const rec=await idbGet(key,'descriptions');
                if(rec && rec.text) bundle.descriptions.push(rec.text);
            }
        }
    }
    return bundle;
}

function buildPrompt(bundle, mode='code'){
    const lines=[];
    if(mode==='code'){
        lines.push('SYSTEM:');
        lines.push('You are an automated code-modification agent.');
        lines.push('Return ONE unified git patch wrapped in ```patch … ```; no commentary.');
        lines.push('');
    }else{
        lines.push('SYSTEM:');
        lines.push('You are a knowledgeable development assistant.');
        lines.push('');
    }
    lines.push('USER:');
    lines.push('Repository root is / (ContextPlus).');
    lines.push(`Current branch: ${currentBranch}.`);
    lines.push('Please implement the following change(s):');
    lines.push('');
    lines.push(bundle.aiRequest||'None');
    lines.push('');
    bundle.instructions.forEach((t,i)=>{ lines.push(`${i+1}. ${t}`); });
    lines.push('');
    lines.push('Context files follow.');
    bundle.files.forEach(f=>{
        lines.push(`>>> ${f.path}`);
        lines.push(f.text);
        lines.push('<<< END FILE');
    });
    lines.push('...');
    if(mode==='code') lines.push('Remember: output only ONE patch block.');
    return lines.join('\n');
}

async function saveSelections(){
    if(!currentRepo || !currentBranch) return;
    const files=getSelectedPaths();
    const instructions=Array.from(document.querySelectorAll('.instruction-toggle:checked')).map(cb=>Number(cb.dataset.id));
    const desc=Array.from(document.querySelectorAll('#desc-tree input[type=checkbox]:checked')).map(cb=>cb.dataset.path);
    const key=`selections:${currentRepo.full_name}:${currentBranch}`;
    const data={files,instructions,desc};
    log('saveSelections', {key,data});
    await idbSet(key,data);
}

async function applySavedSelections(){
    if(!currentRepo || !currentBranch) return;
    const key=`selections:${currentRepo.full_name}:${currentBranch}`;
    const data=await idbGet(key);
    log('applySavedSelections', {key,data});
    if(!data) { updateOutputCards(); return; }
    const {files=[],instructions=[],desc=[]}=data;
    document.querySelectorAll('#file-tree input[type=checkbox]').forEach(cb=>{ cb.checked=files.includes(cb.dataset.path); });
    document.querySelectorAll('.instruction-toggle').forEach(cb=>{ cb.checked=instructions.includes(Number(cb.dataset.id)); });
    document.querySelectorAll('#desc-tree input[type=checkbox]').forEach(cb=>{ cb.checked=desc.includes(cb.dataset.path); });
    document.querySelectorAll('#file-tree input[type=checkbox]').forEach(cb=>updateParentFolderStates(cb));
    document.querySelectorAll('#desc-tree input[type=checkbox]').forEach(cb=>updateParentFolderStates(cb));
    updateOutputCards();
}

function addLineNumbers(text){
    return text.split('\n').map((l,i)=>`L${i+1} ${l}`).join('\n');
}

function createList(obj,parent){
    Object.keys(obj).forEach(key=>{
        if(key==='_item') return;
        const li=document.createElement('li');
        const checkbox=document.createElement('input');
        checkbox.type='checkbox';

        const hasChildren = Object.keys(obj[key]).some(k=>k!=='_item');
        const isFolder = hasChildren;
        
        if(isFolder) {
            checkbox.dataset.folder='true';
            const parentPath = getParentPath(parent);
            checkbox.dataset.path = parentPath ? `${parentPath}/${key}` : key;
        } else {
            // For files, use the actual item path
            checkbox.dataset.path = obj[key]._item.path;
        }
        
        li.appendChild(checkbox);
        li.appendChild(document.createTextNode(' '+key));
        parent.appendChild(li);
        
        if(hasChildren){
            const ul=document.createElement('ul');
            createList(obj[key],ul);
            li.appendChild(ul);
        }
    });
}

// Helper function to get the parent path
function getParentPath(ul) {
    const parentLi = ul.closest('li');
    if(!parentLi) return '';
    const parentCheckbox = parentLi.querySelector('input[type=checkbox]');
    return parentCheckbox ? parentCheckbox.dataset.path : '';
}

function handleFolderToggle(e){
    if(e.target.dataset.folder){
        const li = e.target.closest('li');

        if(li){
            // Select/deselect all checkboxes within this folder
            const boxes = li.querySelectorAll('ul input[type=checkbox]');
            boxes.forEach((cb) => {
                cb.checked = e.target.checked;
            });
        }
    }
    // Update parent folder states based on children
    updateParentFolderStates(e.target);
    updateOutputCards();
}

function updateParentFolderStates(checkbox) {
    let currentLi = checkbox.closest('li');
    
    // Traverse up the tree to update parent folder states
    while(currentLi) {
        const parentUl = currentLi.parentElement;
        const parentLi = parentUl ? parentUl.closest('li') : null;
        
        if(parentLi) {
            const parentCheckbox = parentLi.querySelector('input[type=checkbox][data-folder="true"]');

            if(parentCheckbox) {
                // Get all child checkboxes in this parent folder
                const childCheckboxes = parentLi.querySelectorAll('ul input[type=checkbox]');
                const checkedChildren = parentLi.querySelectorAll('ul input[type=checkbox]:checked');

                // Update parent state based on children
                if(checkedChildren.length === 0) {
                    parentCheckbox.checked = false;
                    parentCheckbox.indeterminate = false;
                } else if(checkedChildren.length === childCheckboxes.length) {
                    parentCheckbox.checked = true;
                    parentCheckbox.indeterminate = false;
                } else {
                    parentCheckbox.checked = false;
                    parentCheckbox.indeterminate = true;
                }
            }
        }
        
        currentLi = parentLi;
    }
}

function selectAll(){
    document.querySelectorAll('#file-tree input[type=checkbox]').forEach(cb=>cb.checked=true);
    updateOutputCards();
}

function deselectAll(){
    document.querySelectorAll('#file-tree input[type=checkbox]').forEach(cb=>cb.checked=false);
    updateOutputCards();
}

function selectAllDesc(){
    document.querySelectorAll('#desc-tree input[type=checkbox]').forEach(cb=>cb.checked=true);
    updateOutputCards();
}

function deselectAllDesc(){
    document.querySelectorAll('#desc-tree input[type=checkbox]').forEach(cb=>cb.checked=false);
    updateOutputCards();
}

function getSelectedPaths(){
    const checkboxes=document.querySelectorAll('#file-tree input[type=checkbox]:checked');
    return Array.from(checkboxes)
        .filter(cb=>!cb.dataset.folder)
        .map(cb=>cb.dataset.path);
}

async function copySelected(){
    const container=document.getElementById('output-cards');
    log('copySelected', {cards: container.children.length});
    if(!container.children.length){
        showToast('Nothing selected','warning');
        return;
    }
    const aiToggle=document.getElementById('ai-instructions-toggle');
    const aiText=document.getElementById('ai-instructions').value.trim();
    if(aiToggle && aiToggle.checked && !aiText){
        showToast('Enter AI Instructions','warning');
        return;
    }
    const progressToast=showToast('Copying...','info',0,40,200,'upper middle');
    const bundle=await buildContextBundle();
    const parts=[];
    bundle.files.forEach(f=>parts.push(`// ${f.path}\n${f.text}`));
    bundle.instructions.forEach(t=>parts.push(t));
    bundle.descriptions.forEach(d=>parts.push(d));
    if(bundle.aiRequest) parts.push(bundle.aiRequest);
    const clipText=parts.join('\n\n');
    const tokens=approximateTokens(Math.ceil(clipText.length/4.7));
    try {
        await navigator.clipboard.writeText(String(clipText));
        log('copySelected success', {tokens});
        if(progressToast) progressToast.remove();
        showToast(`${tokens} tokens copied to clipboard`,'success',3,40,200,'upper middle');
    } catch(err) {
        log('copySelected fail', err);
        if(progressToast) progressToast.remove();
        showToast('Failed to copy to clipboard','error',3,40,200,'upper middle');
    }
}

function generateUpdates(){
    log('generateUpdates click');
    buildContextBundle().then(bundle=>{
        const prompt=buildPrompt(bundle,'code');
        const tokens=approximateTokens(Math.ceil(prompt.length/4.7));
        if(tokens>MAX_PROMPT_TOKENS){
            showToast('Prompt exceeds max size','warning');
            return;
        }
        const payload=JSON.stringify(bundle,null,2);
        currentBundle = bundle;
        openPromptModal(prompt, payload);
    });
}

async function init(){
    log('init start');
    await openDB();
    log('init after openDB', {dbInitialized: !!db});
    clientId = await idbGet('client_id');
    clientSecret = await idbGet('client_secret');
    llmProvider = await idbGet('llm_provider');
    llmApiKey = await idbGet('llm_api_key');
    llmAsync = await idbGet('llm_async');
    llmModel = await idbGet('llm_model');
    dryRun = await idbGet('dry_run');
    betaMode = await idbGet('beta_mode');
    document.getElementById('client-id-input').value = clientId || '';
    document.getElementById('client-secret-input').value = clientSecret || '';
    document.getElementById('llm-provider-select').value = llmProvider || 'openai';
    document.getElementById('llm-api-key').value = llmApiKey || '';
    document.getElementById('llm-async').checked = !!llmAsync;
    document.getElementById('llm-model-select').value = llmModel || '';
    updateModelList();
    document.getElementById('dry-run-toggle').checked = !!dryRun;
    document.getElementById('beta-toggle').checked = !!betaMode;
    log('init retrieved creds', {accessToken, clientId, clientSecret});
    // ensure modals start hidden
    ['settings-modal','modal-overlay','instruction-modal','description-modal','prompt-modal'].forEach(id=>{
        const el=document.getElementById(id);
        if(el){
            el.classList.add('hidden');
            el.style.display='none';
            log('init hide', id);
        }
    });
    applyTheme();
    updateRepoLabels();
    handleRedirect();
    if(accessToken){
        loadRepos();
        if(currentRepo && currentBranch){
            loadFileTree();
        }
    }
    if(!accessToken && (!clientId || !clientSecret)){
        log('init opening settings due to missing creds');
        openSettings();
    }
    if(!accessToken){
        document.getElementById('first-run').classList.remove('hidden');
    }
    document.getElementById('settings-btn').addEventListener('click', () => { log('settings-btn click'); openSettings(); });
    document.getElementById('settings-close').addEventListener('click', (e) => { log('settings-close click'); closeSettings(e); });
    document.getElementById('auth-btn').addEventListener('click', handleAuthBtn);
    const ghBtn = document.getElementById('open-github');
    if(ghBtn) ghBtn.addEventListener('click', openGitHubSettings);
    document.getElementById('repo-label').addEventListener('click', () => { log('repo-label click'); openRepoModal(); });
    document.getElementById('branch-label').addEventListener('click', () => { log('branch-label click'); openRepoModal(); });
    document.getElementById('modal-close').addEventListener('click', () => { log('modal-close click'); confirmRepoBranch(); });
    document.getElementById('repo-select').addEventListener('change', loadBranches);
    document.getElementById('copy-btn').addEventListener('click', copySelected);
    const genBtn=document.getElementById('generate-btn');
    if(genBtn) genBtn.addEventListener('click', generateUpdates);
    document.getElementById('select-all-btn').addEventListener('click', selectAll);
    document.getElementById('deselect-all-btn').addEventListener('click', deselectAll);
    const dsa=document.getElementById('desc-select-all-btn');
    if(dsa) dsa.addEventListener('click', selectAllDesc);
    const dda=document.getElementById('desc-deselect-all-btn');
    if(dda) dda.addEventListener('click', deselectAllDesc);
    document.getElementById('file-tree').addEventListener('change', handleFolderToggle);
    document.getElementById('theme-select').addEventListener('change', handleThemeChange);
    document.getElementById('dry-run-toggle').addEventListener('change', e=>{
        dryRun = e.target.checked;
        idbSet('dry_run', dryRun);
    });
    document.getElementById('beta-toggle').addEventListener('change', e=>{
        betaMode = e.target.checked;
        idbSet('beta_mode', betaMode);
    });
    document.getElementById('settings-modal').addEventListener('click', (e) => { log('settings-modal background click'); closeSettings(e); });
    document.getElementById('settings-content').addEventListener('click', e=>e.stopPropagation());
    document.getElementById('create-instruction').addEventListener('click', () => { log('create-instruction click'); openInstructionModal(); });
    document.getElementById('instruction-close').addEventListener('click', (e) => { log('instruction-close click'); closeInstructionModal(e); });
    document.getElementById('instruction-save').addEventListener('click', saveInstruction);
    document.getElementById('instruction-delete').addEventListener('click', deleteInstruction);
    const restoreBtn=document.getElementById('instruction-restore');
    if(restoreBtn) restoreBtn.addEventListener('click', restoreInstructionDefault);
    document.getElementById('instruction-modal').addEventListener('click', (e) => { log('instruction-modal background click'); closeInstructionModal(e); });
    document.getElementById('instruction-content').addEventListener('click', e=>e.stopPropagation());
    document.getElementById('description-close').addEventListener('click', e=>{ log('description-close click'); closeDescriptionModal(e); });
    document.getElementById('description-save').addEventListener('click', saveDescription);
    document.getElementById('description-modal').addEventListener('click', e=>{ log('description-modal background click'); closeDescriptionModal(e); });
    document.getElementById('description-content').addEventListener('click', e=>e.stopPropagation());
    document.getElementById('prompt-cancel').addEventListener('click', e=>{ log('prompt-cancel click'); closePromptModal(e); });
    document.getElementById('prompt-send').addEventListener('click', ()=>{ log('prompt-send click'); handlePromptSend(); });
    document.getElementById('prompt-modal').addEventListener('click', e=>{ log('prompt-modal background click'); closePromptModal(e); });
    document.getElementById('prompt-content').addEventListener('click', e=>e.stopPropagation());
    document.querySelectorAll('.prompt-tab').forEach(btn=>btn.addEventListener('click', ()=>showPromptTab(btn.dataset.tab)));
    document.querySelectorAll('.settings-tab').forEach(btn=>btn.addEventListener('click',()=>showTab(btn.dataset.tab)));
    document.getElementById('llm-provider-select').addEventListener('change', updateModelList);
    document.getElementById('llm-api-key').addEventListener('change', updateModelList);
    document.getElementById('llm-save-btn').addEventListener('click', saveLLMSettings);
    document.getElementById('generate-desc-btn').addEventListener('click', generateDescriptions);
    const aiTextEl=document.getElementById('ai-instructions');
    const aiToggleEl=document.getElementById('ai-instructions-toggle');
    if(aiTextEl) aiTextEl.addEventListener('input', updateOutputCards);
    if(aiToggleEl) aiToggleEl.addEventListener('change',()=>{
        if(aiToggleEl.checked && !aiTextEl.value.trim()){
            showToast('Enter AI Instructions','warning');
        }
        updateOutputCards();
    });
    loadInstructions();
    loadTasks();
    log('init listeners attached');
    updateGenerateButton();
    setInterval(renderTasks, TASK_POLL_INTERVAL);
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
}

init();
