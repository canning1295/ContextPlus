// Configuration - replace with your GitHub OAuth app details
// `GITHUB_CLIENT_ID` can be defined in a separate script tag to avoid
// editing this file in production. Fallback to the placeholder string.
const CLIENT_ID = window.GITHUB_CLIENT_ID || 'YOUR_CLIENT_ID';
const REDIRECT_URI = window.location.origin + window.location.pathname;
// Allow override via config.js for serverless deployments
const EXCHANGE_URL = window.EXCHANGE_URL || '/api/exchange'; // endpoint to exchange code for token

let accessToken = localStorage.getItem('gh_token') || null;
let currentRepo = JSON.parse(localStorage.getItem('current_repo') || 'null');
let currentBranch = localStorage.getItem('current_branch');
let theme = localStorage.getItem('theme') || 'light';

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

function handleAuthBtn() {
    console.log('auth-btn clicked');
    if(accessToken) {
        localStorage.removeItem('gh_token');
        accessToken = null;
        showToast('Disconnected', 'warning', 2, 40, 200, 'upper middle');
    } else {
        startOAuth();
    }
    closeSettings();
}

// GitHub OAuth error toast fix history:
// 1. Added client ID check to show configuration error.
// 2. Styled toast for better readability.
function startOAuth() {
    if(CLIENT_ID === 'YOUR_CLIENT_ID') {
        showToast('Configure GITHUB_CLIENT_ID before connecting', 'error', 3, 40, 200, 'upper middle');
        return;
    }
    const state = btoa(Math.random().toString(36).substring(2));
    localStorage.setItem('oauth_state', state);
    const authURL = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=repo&state=${state}`;
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
        fetch(EXCHANGE_URL, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({code})
        }).then(r=>r.json()).then(data=>{
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
    if(!accessToken) { showToast('Connect GitHub first', 'warning', 2); return; }
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('hidden');
    loadRepos();
}

function closeRepoModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
}

function loadRepos() {
    fetch('https://api.github.com/user/repos?per_page=100', {
        headers:{Authorization:`Bearer ${accessToken}`, Accept:'application/vnd.github+json'}
    })
    .then(r=>r.json())
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
        headers:{Authorization:`Bearer ${accessToken}`, Accept:'application/vnd.github+json'}
    })
    .then(r=>r.json())
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
    updateRepoLabels();
    loadFileTree();
    closeRepoModal();
}

function loadFileTree() {
    if(!currentRepo || !currentBranch || !accessToken) return;
    const url=`https://api.github.com/repos/${currentRepo.owner}/${currentRepo.repo}/git/trees/${currentBranch}?recursive=1`;
    fetch(url,{headers:{Authorization:`Bearer ${accessToken}`,Accept:'application/vnd.github+json'}})
    .then(r=>r.json()).then(data=>{
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

function getSelectedPaths(){
    const checkboxes=document.querySelectorAll('#file-tree input[type=checkbox]:checked');
    return Array.from(checkboxes).map(cb=>cb.dataset.path);
}

async function copySelected(){
    const paths=getSelectedPaths();
    if(!paths.length){showToast('No files selected','warning',2,40,200,'upper middle');return;}
    const contents=[];
    for(const p of paths){
        const url=`https://raw.githubusercontent.com/${currentRepo.full_name}/${currentBranch}/${p}`;
        const resp=await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`}});
        const text=await resp.text();
        contents.push(`// ${p}\n`+text);
    }
    const text=contents.join('\n\n');
    await navigator.clipboard.writeText(text);
    const tokens=Math.ceil(text.length/4.7);
    showToast(`${tokens} Tokens copied`,'success',3,40,200,'upper middle');
}

function init(){
    applyTheme();
    updateRepoLabels();
    handleRedirect();
    document.getElementById('settings-btn').addEventListener('click', openSettings);
    document.getElementById('settings-close').addEventListener('click', closeSettings);
    document.getElementById('auth-btn').addEventListener('click', handleAuthBtn);
    document.getElementById('repo-label').addEventListener('click', openRepoModal);
    document.getElementById('branch-label').addEventListener('click', openRepoModal);
    document.getElementById('modal-close').addEventListener('click', confirmRepoBranch);
    document.getElementById('repo-select').addEventListener('change', loadBranches);
    document.getElementById('copy-btn').addEventListener('click', copySelected);
    document.getElementById('refresh-btn').addEventListener('click', loadFileTree);
    document.getElementById('theme-select').addEventListener('change', handleThemeChange);
    document.getElementById('settings-modal').addEventListener('click', closeSettings);
    document.getElementById('settings-content').addEventListener('click', e=>e.stopPropagation());
}

init();
