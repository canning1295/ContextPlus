const REDIRECT_URI = 'https://contextplus.netlify.app/';
const EXCHANGE_URL = window.EXCHANGE_URL || '/.netlify/functions/exchange';
// Simple flag so we can enable/disable verbose logging in one place
const DEBUG = true;

let clientId = null;
let clientSecret = null;
let db = null;

let accessToken = localStorage.getItem('gh_token') || null;
let currentRepo = JSON.parse(localStorage.getItem('current_repo') || 'null');
let currentBranch = localStorage.getItem('current_branch');
let theme = localStorage.getItem('theme') || 'light';

function openDB() {
    return new Promise(resolve => {
        const req = indexedDB.open('contextplus', 1);
        req.onupgradeneeded = e => {
            e.target.result.createObjectStore('settings');
        };
        req.onsuccess = e => {
            db = e.target.result;
            resolve();
        };
    });
}

function idbGet(key) {
    return new Promise(resolve => {
        const tx = db.transaction('settings');
        const store = tx.objectStore('settings');
        const getReq = store.get(key);
        getReq.onsuccess = () => {
            if(DEBUG) console.log('idbGet', key, getReq.result);
            resolve(getReq.result);
        };
        getReq.onerror = () => resolve(null);
    });
}

function idbSet(key, val) {
    return new Promise(resolve => {
        const tx = db.transaction('settings', 'readwrite');
        tx.objectStore('settings').put(val, key);
        tx.oncomplete = () => {
            if(DEBUG) console.log('idbSet', key, val);
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
    if(DEBUG) console.log('openSettings called', {accessToken, clientId, clientSecret});
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

function handleAuthBtn() {
    console.log('auth-btn clicked');
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
    if(DEBUG) console.log('Opening OAuth URL', authURL);
    window.open(authURL, '_blank');
}

function handleRedirect() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const returnedState = params.get('state');
    if(code) {
        const expected = localStorage.getItem('oauth_state');
        if(returnedState !== expected) {
            console.error('State mismatch');
            return;
        }
        if(DEBUG) console.log('Exchanging OAuth code for token', {code});
        fetch(EXCHANGE_URL, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({code, client_id: clientId, client_secret: clientSecret})
        }).then(async r=>{
            if(DEBUG) console.log('Token exchange response status', r.status);
            const data = await r.json();
            if(DEBUG) console.log('Token exchange response body', data);
            accessToken = data.access_token;
            if(accessToken) {
                localStorage.setItem('gh_token', accessToken);
                showToast('Connected', 'success', 2, 40, 200, 'upper middle');
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }).catch(err=>console.error('token exchange failed', err));
    }
}

function openRepoModal() {
    if(!accessToken) {
        if(DEBUG) console.warn('openRepoModal called without access token');
        showToast('Connect GitHub first', 'warning', 2);
        return;
    }
    const overlay = document.getElementById('modal-overlay');
    overlay.style.display = 'flex';
    overlay.classList.remove('hidden');
    loadRepos();
}

function closeRepoModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.add('hidden');
    overlay.style.display = 'none';
}

function loadRepos() {
    if(DEBUG) console.log('Fetching repositories');
    fetch('https://api.github.com/user/repos?per_page=100', {
        headers:{Authorization:`token ${accessToken}`, Accept:'application/vnd.github+json'}
    })
    .then(async r=>{
        if(DEBUG) console.log('Repos response status', r.status);
        const repos = await r.json();
        if(DEBUG) console.log('Repos payload', repos);
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
    if(DEBUG) console.log('Fetching branches for', repoFull);
    fetch(`https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`, {
        headers:{Authorization:`token ${accessToken}`, Accept:'application/vnd.github+json'}
    })
    .then(async r=>{
        if(DEBUG) console.log('Branches response status', r.status);
        const branches = await r.json();
        if(DEBUG) console.log('Branches payload', branches);
        return branches;
    })
    .then(branches=>{
        const select = document.getElementById('branch-select');
        select.innerHTML='';
        branches.forEach(b=>{
            const opt=document.createElement('option');
            opt.value=b.name;
            opt.textContent=b.name;
            select.appendChild(opt);
        });
        if(currentBranch) select.value=currentBranch;
    });
}

function confirmRepoBranch() {
    const repoFull = document.getElementById('repo-select').value;
    const branch = document.getElementById('branch-select').value;
    const [owner, repo]=repoFull.split('/');
    currentRepo={full_name:repoFull, owner, repo};
    currentBranch=branch;
    localStorage.setItem('current_repo', JSON.stringify(currentRepo));
    localStorage.setItem('current_branch', currentBranch);
    if(DEBUG) console.log('Selected repo/branch', currentRepo, currentBranch);
    updateRepoLabels();
    loadFileTree();
    closeRepoModal();
}

function loadFileTree() {
    if(!currentRepo || !currentBranch || !accessToken) {
        if(DEBUG) console.warn('loadFileTree called without repo/branch/token');
        return;
    }
    const url=`https://api.github.com/repos/${currentRepo.owner}/${currentRepo.repo}/git/trees/${currentBranch}?recursive=1`;
    if(DEBUG) console.log('Fetching file tree', url);
    fetch(url,{headers:{Authorization:`token ${accessToken}`,Accept:'application/vnd.github+json'}})
    .then(async r=>{
        if(DEBUG) console.log('Tree response status', r.status);
        const data = await r.json();
        if(DEBUG) console.log('Tree payload', data);
        return data;
    }).then(data=>{
        buildTree(data.tree);
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

function createList(obj,parent){
    Object.keys(obj).forEach(key=>{
        if(key==='_item') return;
        const li=document.createElement('li');
        const checkbox=document.createElement('input');
        checkbox.type='checkbox';
        checkbox.dataset.path=obj[key]._item?obj[key]._item.path:key;
        if(!obj[key]._item) checkbox.dataset.folder='true';
        li.appendChild(checkbox);
        li.appendChild(document.createTextNode(' '+key));
        parent.appendChild(li);
        if(Object.keys(obj[key]).some(k=>k!=='_item')){
            const ul=document.createElement('ul');
            createList(obj[key],ul);
            li.appendChild(ul);
        }
    });
}

function handleFolderToggle(e){
    if(e.target.dataset.folder){
        const li = e.target.closest('li');
        if(li){
            // Select/deselect all checkboxes within this folder
            const boxes = li.querySelectorAll('ul input[type=checkbox]');
            boxes.forEach(cb=>{ cb.checked = e.target.checked; });
        }
    }
    // Update parent folder states based on children
    updateParentFolderStates(e.target);
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
}

function deselectAll(){
    document.querySelectorAll('#file-tree input[type=checkbox]').forEach(cb=>cb.checked=false);
}

function getSelectedPaths(){
    const checkboxes=document.querySelectorAll('#file-tree input[type=checkbox]:checked');
    return Array.from(checkboxes)
        .filter(cb=>!cb.dataset.folder)
        .map(cb=>cb.dataset.path);
}

async function copySelected(){
    const paths=getSelectedPaths();
    if(!paths.length){
        showToast('No files selected','warning',2,40,200,'upper middle');
        return;
    }
    const contents=[];
    for(const p of paths){
        const url=`https://api.github.com/repos/${currentRepo.full_name}/contents/${p}?ref=${currentBranch}`;
        const resp=await fetch(url,{headers:{Authorization:`token ${accessToken}`,Accept:'application/vnd.github.raw'}});
        const text=await resp.text();
        contents.push(`// ${p}\n`+text);
    }
    const clipText=contents.join('\n\n');
    await navigator.clipboard.writeText(String(clipText));
    const tokens=Math.ceil(clipText.length/4.7);
    const tokenStr=tokens.toLocaleString();
    showToast(`${paths.length} files / ${tokenStr} tokens copied to clipboard`,'success',3,40,200,'upper middle');
}

async function init(){
    await openDB();
    clientId = await idbGet('client_id');
    clientSecret = await idbGet('client_secret');
    document.getElementById('client-id-input').value = clientId || '';
    document.getElementById('client-secret-input').value = clientSecret || '';
    if(DEBUG) console.log('Init state',{accessToken,clientId,clientSecret,currentRepo,currentBranch});
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
        if(DEBUG) console.log('Opening settings because', {accessToken, clientId, clientSecret});
        openSettings();
    }
    if(!accessToken){
        document.getElementById('first-run').classList.remove('hidden');
    }
    document.getElementById('settings-btn').addEventListener('click', openSettings);
    document.getElementById('settings-close').addEventListener('click', closeSettings);
    document.getElementById('auth-btn').addEventListener('click', handleAuthBtn);
    const ghBtn = document.getElementById('open-github');
    if(ghBtn) ghBtn.addEventListener('click', openGitHubSettings);
    document.getElementById('repo-label').addEventListener('click', openRepoModal);
    document.getElementById('branch-label').addEventListener('click', openRepoModal);
    document.getElementById('modal-close').addEventListener('click', confirmRepoBranch);
    document.getElementById('repo-select').addEventListener('change', loadBranches);
    document.getElementById('copy-btn').addEventListener('click', copySelected);
    document.getElementById('select-all-btn').addEventListener('click', selectAll);
    document.getElementById('deselect-all-btn').addEventListener('click', deselectAll);
    document.getElementById('file-tree').addEventListener('change', handleFolderToggle);
    document.getElementById('refresh-btn').addEventListener('click', loadFileTree);
    document.getElementById('theme-select').addEventListener('change', handleThemeChange);
    document.getElementById('settings-modal').addEventListener('click', closeSettings);
    document.getElementById('settings-content').addEventListener('click', e=>e.stopPropagation());
}

init();
