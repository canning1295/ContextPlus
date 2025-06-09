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

// openDB hang fix history:
// 1. Added fallback timeout to ensure init proceeds even if request events never fire.
function openDB() {
    return new Promise(resolve => {
        log('openDB start');
        let finished = false;
        const done = () => { if(!finished){ finished = true; resolve(); } };
        try {
            const req = indexedDB.open('contextplus', 3);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if(!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
                if(!db.objectStoreNames.contains('instructions')) db.createObjectStore('instructions', { keyPath: 'id', autoIncrement: true });
                if(db.objectStoreNames.contains('descriptions')) db.deleteObjectStore('descriptions');
                db.createObjectStore('descriptions', { keyPath: ['repo','branch','path'] });
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
        tx.objectStore(storeName).put(val, key);
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

function handleThemeChange() {
    theme = document.getElementById('theme-select').value;
    localStorage.setItem('theme', theme);
    applyTheme();
}

function openGitHubSettings(){
    window.open('https://github.com/settings/applications/new', '_blank');
}

let instructionsData = [];
let currentInstructionId = null;
let currentDescPath = null;

function loadInstructions(){
    if(!db){
        log('loadInstructions skipped, db not initialized');
        instructionsData = [];
        renderInstructions();
        return;
    }
    const tx = db.transaction('instructions');
    const store = tx.objectStore('instructions');
    const req = store.getAll();
    req.onsuccess = () => {
        instructionsData = req.result || [];
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

// Instruction modal open bug fix history:
// 1. Basic open with values populated.
// 2. Ensured display is explicitly set so CSS doesn't override.
function openInstructionModal(id=null){
    log('openInstructionModal', {id});
    currentInstructionId = id;
    const modal = document.getElementById('instruction-modal');
    const titleEl = document.getElementById('instruction-title');
    const textEl = document.getElementById('instruction-text');
    if(id){
        const instr = instructionsData.find(i=>i.id===id);
        titleEl.value = instr ? instr.title : '';
        textEl.value = instr ? instr.text : '';
    } else {
        titleEl.value='';
        textEl.value='';
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
        log('saveInstruction aborted, db still unavailable');
        showToast('Database unavailable','error');
        return;
    }
    const store = db.transaction('instructions','readwrite').objectStore('instructions');
    if(currentInstructionId){
        store.put({id:currentInstructionId,title,text});
    } else {
        store.add({title,text});
    }
    store.transaction.oncomplete=()=>{ loadInstructions(); closeInstructionModal(); };
}

function deleteInstruction(){
    if(currentInstructionId){
        if(!db){
            log('deleteInstruction skipped, db not initialized');
            showToast('Database unavailable','error');
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
        buildTree(data.tree);
        buildDescTree(data.tree);
        updateOutputCards();
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
        const statusSpan=document.createElement('span');
        statusSpan.className='desc-status';
        statusSpan.dataset.path=checkbox.dataset.path;
        loadDescriptionStatus(checkbox.dataset.path).then(stat=>{
            statusSpan.textContent=stat;
        });
        const nameSpan=document.createElement('span');
        nameSpan.textContent=' '+key+' ';
        if(!isFolder){
            nameSpan.className='desc-file';
            nameSpan.dataset.path=checkbox.dataset.path;
            nameSpan.addEventListener('click', openDescriptionModal);
        }
        li.appendChild(checkbox);
        li.appendChild(nameSpan);
        li.appendChild(statusSpan);
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
            closeDescriptionModal();
        });
        return;
    }
    const store=db.transaction('descriptions','readwrite').objectStore('descriptions');
    store.put(rec);
    store.transaction.oncomplete=()=>{
        updateDescStatus(currentDescPath);
        closeDescriptionModal();
    };
}

function updateDescStatus(path){
    const span=document.querySelector(`.desc-status[data-path="${path}"]`);
    if(span) loadDescriptionStatus(path).then(stat=>{span.textContent=stat;});
}

async function updateOutputCards(){
    const container=document.getElementById('output-cards');
    container.innerHTML='';
    const cards=[];
    const filePaths=getSelectedPaths();
    if(filePaths.length){
        const contents=[];
        for(const p of filePaths){
            const url=`https://api.github.com/repos/${currentRepo.full_name}/contents/${p}?ref=${currentBranch}`;
            const resp=await fetch(url,{headers:{Authorization:`token ${accessToken}`,Accept:'application/vnd.github.raw'}});
            const text=await resp.text();
            contents.push(text);
        }
        const total=contents.join('\n').length;
        const tokens=Math.ceil(total/4.7);
        const card=document.createElement('div');
        card.className='card';
        card.draggable=true;
        card.dataset.type='files';
        card.dataset.paths=JSON.stringify(filePaths);
        card.dataset.tokens=tokens;
        card.textContent=`Selected Files - ${tokens} tokens`;
        cards.push(card);
    }
    const selectedInstr=document.querySelectorAll('.instruction-toggle:checked');
    selectedInstr.forEach(cb=>{
        const instr=instructionsData.find(i=>i.id==cb.dataset.id);
        if(instr){
            const tokens=Math.ceil(instr.text.length/4.7);
            const card=document.createElement('div');
            card.className='card';
            card.draggable=true;
            card.dataset.type='instruction';
            card.dataset.id=instr.id;
            card.dataset.tokens=tokens;
            card.textContent=`${instr.title} - ${tokens} tokens`;
            cards.push(card);
        }
    });
    const descChecks=document.querySelectorAll('#desc-tree input[type=checkbox]:checked');
    if(descChecks.length){
        let total=0; // not computing actual lengths as descriptions not loaded
        const card=document.createElement('div');
        card.className='card';
        card.draggable=true;
        card.dataset.type='descriptions';
        card.dataset.tokens=total;
        card.textContent=`File Descriptions`;
        cards.push(card);
    }
    cards.forEach(c=>container.appendChild(c));
    initDrag(container);
    updateTotalTokens();
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
    const container=document.getElementById('output-cards');
    let total=0;
    container.querySelectorAll('.card').forEach(c=>{total+=Number(c.dataset.tokens)||0;});
    document.getElementById('total-tokens').textContent=`(${total} tokens)`;
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

function getSelectedPaths(){
    const checkboxes=document.querySelectorAll('#file-tree input[type=checkbox]:checked');
    return Array.from(checkboxes)
        .filter(cb=>!cb.dataset.folder)
        .map(cb=>cb.dataset.path);
}

async function copySelected(){
    const container=document.getElementById('output-cards');
    if(!container.children.length){
        showToast('Nothing selected','warning');
        return;
    }
    const parts=[];
    for(const card of container.children){
        if(card.dataset.type==='files'){
            const paths=JSON.parse(card.dataset.paths||'[]');
            for(const p of paths){
                const url=`https://api.github.com/repos/${currentRepo.full_name}/contents/${p}?ref=${currentBranch}`;
                const resp=await fetch(url,{headers:{Authorization:`token ${accessToken}`,Accept:'application/vnd.github.raw'}});
                const text=await resp.text();
                parts.push(`// ${p}\n`+text);
            }
        }else if(card.dataset.type==='instruction'){
            const instr=instructionsData.find(i=>i.id==card.dataset.id);
            if(instr) parts.push(instr.text);
        }else if(card.dataset.type==='descriptions'){
            const descChecks=document.querySelectorAll('#desc-tree input[type=checkbox]:checked');
            for(const cb of descChecks){
                const key=[currentRepo.full_name, currentBranch, cb.dataset.path];
                const rec=await idbGet(key,'descriptions');
                if(rec && rec.text) parts.push(rec.text);
            }
        }
    }
    const clipText=parts.join('\n\n');
    await navigator.clipboard.writeText(String(clipText));
    const tokens=Math.ceil(clipText.length/4.7);
    showToast(`${tokens} tokens copied to clipboard`,'success',3,40,200,'upper middle');
}

async function init(){
    log('init start');
    await openDB();
    log('init after openDB', {dbInitialized: !!db});
    clientId = await idbGet('client_id');
    clientSecret = await idbGet('client_secret');
    document.getElementById('client-id-input').value = clientId || '';
    document.getElementById('client-secret-input').value = clientSecret || '';
    log('init retrieved creds', {accessToken, clientId, clientSecret});
    // ensure modals start hidden
    ['settings-modal','modal-overlay','instruction-modal','description-modal'].forEach(id=>{
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
    document.getElementById('select-all-btn').addEventListener('click', selectAll);
    document.getElementById('deselect-all-btn').addEventListener('click', deselectAll);
    document.getElementById('file-tree').addEventListener('change', handleFolderToggle);
    document.getElementById('refresh-btn').addEventListener('click', loadFileTree);
    document.getElementById('theme-select').addEventListener('change', handleThemeChange);
    document.getElementById('settings-modal').addEventListener('click', (e) => { log('settings-modal background click'); closeSettings(e); });
    document.getElementById('settings-content').addEventListener('click', e=>e.stopPropagation());
    document.getElementById('create-instruction').addEventListener('click', () => { log('create-instruction click'); openInstructionModal(); });
    document.getElementById('instruction-close').addEventListener('click', (e) => { log('instruction-close click'); closeInstructionModal(e); });
    document.getElementById('instruction-save').addEventListener('click', saveInstruction);
    document.getElementById('instruction-delete').addEventListener('click', deleteInstruction);
    document.getElementById('instruction-modal').addEventListener('click', (e) => { log('instruction-modal background click'); closeInstructionModal(e); });
    document.getElementById('instruction-content').addEventListener('click', e=>e.stopPropagation());
    document.getElementById('description-close').addEventListener('click', e=>{ log('description-close click'); closeDescriptionModal(e); });
    document.getElementById('description-save').addEventListener('click', saveDescription);
    document.getElementById('description-modal').addEventListener('click', e=>{ log('description-modal background click'); closeDescriptionModal(e); });
    document.getElementById('description-content').addEventListener('click', e=>e.stopPropagation());
    loadInstructions();
    log('init listeners attached');
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
}

init();
