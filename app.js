// app.js — Full Chat + Rooms integration (Firestore)
// Make sure index.html loads firebase compat scripts (we already did)

// App.js Alert (Java Working)
alert("✅ app.js loaded");
console.log("✅ app.js loaded");
// Firebase config (your config)
const firebaseConfig = {
  apiKey: "AIzaSyBOQTDhTkZqCGyr2UIig5v1cWHu3Up_C_s",
  authDomain: "chatbox-d0d01.firebaseapp.com",
  projectId: "chatbox-d0d01",
  storageBucket: "chatbox-d0d01.firebasestorage.app",
  messagingSenderId: "1029505313703",
  appId: "1:1029505313703:web:b58b2983c3a2e196f0a482"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// --- Helpers & state ---
const $ = id => document.getElementById(id);
const nowISO = ()=> new Date().toISOString();
const genId = (p='r') => p + '-' + Math.random().toString(36).slice(2,9);

function toast(msg, t=2400){
  const el = $('toast'); el.textContent = msg; el.classList.add('show');
  setTimeout(()=> el.classList.remove('show'), t);
}
function escapeHtml(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// SHA-256 helper
async function sha256Hex(s){
  try{
    const enc = new TextEncoder();
    const data = enc.encode(s);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }catch(e){ return btoa(s).slice(0,64); }
}

let state = { me: null, currentRoom: null, roomsUnsub: null, messagesUnsub: null, pendingImage: null };

// --- DOM Ready & initial bind ---
window.addEventListener('DOMContentLoaded', () => {
  bindUI();
  // auth change
  auth.onAuthStateChanged(onAuthChange);
  // initial rooms render (will be replaced by real-time listener when signed in)
  renderRooms();
  setInterval(()=> updateOnlineCount(), 3000);
});

// --- UI bindings ---
function bindUI(){
  // Auth toggles
  $('signupBtn').onclick = signup;
  $('gotoLogin').onclick = ()=> switchAuthMode('login');
  $('loginBtn').onclick = login;
  $('gotoSignup').onclick = ()=> switchAuthMode('signup');
  $('btnLogout').onclick = ()=> auth.signOut();

  // Rooms & chat
  $('newRoomBtn').onclick = ()=> openRoomModal('create');
  $('saveRoom').onclick = saveRoomFromModal;
  $('cancelRoom').onclick = ()=> $('roomModal').style.display = 'none';

  // Private modal
  $('privateCancel').onclick = ()=> hidePrivateModal();
  $('privateUnlock').onclick = tryUnlockPrivateRoom;

  // Messages
  $('sendBtn').onclick = sendMessage;
  $('messageInput').addEventListener('keydown', (e)=> { if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendMessage(); } });
  $('attachBtn').onclick = ()=> $('fileAttach').click();
  $('fileAttach').addEventListener('change', handleFileAttach);

  // Other
  $('btnProfile').onclick = openProfileEditor;
  $('exportBtn').onclick = exportData;
  $('importBtn').onclick = importData;
  $('searchInput').addEventListener('input', ()=> renderRooms($('searchInput').value.trim().toLowerCase()));
  $('themeToggle').addEventListener('click', toggleTheme);
}

// --- Auth ---
async function signup(){
  const email = $('emailInput').value.trim();
  const pw = $('pwInput').value.trim();
  if(!email || !pw) return alert('Enter email & password');
  try{
    const cred = await auth.createUserWithEmailAndPassword(email,pw);
    const user = cred.user;
    await db.collection('users').doc(user.uid).set({
      email: user.email,
      name: user.email.split('@')[0],
      avatarURL: null,
      created: nowISO()
    });
    $('authOverlay').style.display = 'none';
    toast('Signed up ✓');
  }catch(e){ alert(e.message); }
}

async function login(){
  const email = $('loginEmail').value.trim();
  const pw = $('loginPw').value.trim();
  if(!email || !pw) return alert('Enter email & password');
  try{
    await auth.signInWithEmailAndPassword(email,pw);
    $('authOverlay').style.display = 'none';
    toast('Logged in ✓');
  }catch(e){ alert(e.message); }
}

function switchAuthMode(mode){
  if(mode === 'login'){ $('authArea').style.display='none'; $('loginArea').style.display='block'; $('panelTitle').textContent='Login'; }
  else { $('authArea').style.display='block'; $('loginArea').style.display='none'; $('panelTitle').textContent='Create account'; }
}

async function onAuthChange(user){
  if(user){
    // set basic state
    state.me = { uid: user.uid, email: user.email };
    // fetch user doc
    try{
      const doc = await db.collection('users').doc(user.uid).get();
      if(doc.exists){
        const d = doc.data();
        state.me.name = d.name || state.me.email;
        state.me.avatar = d.avatarURL || null;
      }
    }catch(e){}
    renderAuthState();
    startRoomsListener();
  } else {
    // logged out
    state.me = null;
    renderAuthState();
    stopRoomsListener();
    stopMessagesListener();
    $('authOverlay').style.display = 'flex';
    // clear unlocked access cache on logout
    localStorage.removeItem('chatbox_access_v2');
  }
}

function renderAuthState(){
  $('meTag').textContent = state.me ? state.me.email : '(not signed)';
  $('profileEmail').textContent = state.me ? state.me.email : 'Not signed';
  $('profileNameNote').textContent = state.me ? state.me.name : 'Tap Profile to edit';
  if(state.me && state.me.avatar){
    $('profileAvatar').style.backgroundImage = `url(${state.me.avatar})`;
    $('profileAvatar').textContent = '';
  } else {
    $('profileAvatar').style.backgroundImage = '';
    $('profileAvatar').textContent = state.me ? (state.me.name||'U').slice(0,2).toUpperCase() : '?';
  }
  $('authOverlay').style.display = state.me ? 'none' : 'flex';
}

// --- Rooms: realtime listener ---
function startRoomsListener(){
  if(state.roomsUnsub) state.roomsUnsub();
  state.roomsUnsub = db.collection('rooms').orderBy('created','desc')
    .onSnapshot(snap => { renderRooms(); }, err => console.error(err));
}
function stopRoomsListener(){ if(state.roomsUnsub) state.roomsUnsub(); state.roomsUnsub = null; }

// Render rooms (simple listing)
async function renderRooms(filter=''){
  const roomsSnap = await db.collection('rooms').orderBy('created','desc').get();
  const roomsList = $('roomsList');
  roomsList.innerHTML = '';
  roomsSnap.forEach(doc => {
    const r = { id: doc.id, ...doc.data() };
    if(filter){
      const s = (r.name + ' ' + r.id + ' ' + (r.desc||'')).toLowerCase();
      if(!s.includes(filter)) return;
    }
    const div = document.createElement('div'); div.className = 'room-item';
    const av = document.createElement('div'); av.className = 'avatar'; av.textContent = (r.name||r.id).slice(0,2).toUpperCase();
    const meta = document.createElement('div'); meta.className = 'room-meta';
    const title = document.createElement('div'); title.style.fontWeight = 700; title.textContent = r.name || r.id;
    if(r.passwordHash) { const lock = document.createElement('span'); lock.className='lock-icon'; lock.textContent = ' 🔒'; title.appendChild(lock); }
    const sub = document.createElement('div'); sub.className='small muted'; sub.textContent = r.desc || 'No description';
    const owner = document.createElement('div'); owner.className='small'; owner.textContent = 'owner: ' + (r.owner || 'system');
    meta.appendChild(title); meta.appendChild(sub); meta.appendChild(owner);
    div.appendChild(av); div.appendChild(meta);
    div.addEventListener('click', ()=> { if(r.passwordHash) showPrivateModalForRoom(r.id, r.name); else selectRoom(r.id); });
    roomsList.appendChild(div);
  });
}

// --- Room modal (create/edit) ---
let roomModalMode = 'create', editingRoomId = null;
function openRoomModal(mode='create', roomId=null){
  roomModalMode = mode; editingRoomId = roomId;
  $('roomModal').style.display = 'flex';
  $('roomModalTitle').textContent = mode === 'create' ? 'Create a room' : 'Edit room';
  if(mode === 'edit' && roomId){
    db.collection('rooms').doc(roomId).get().then(doc => {
      if(!doc.exists) return alert('Not found');
      const r = doc.data();
      $('roomName').value = r.name || '';
      $('roomCustomId').value = doc.id;
      $('roomDesc').value = r.desc || '';
      $('roomPw').value = ''; // do not populate hashes
    });
  } else {
    $('roomName').value = ''; $('roomCustomId').value=''; $('roomDesc').value=''; $('roomPw').value='';
  }
}

async function saveRoomFromModal(){
  const name = $('roomName').value.trim();
  let custom = $('roomCustomId').value.trim();
  const desc = $('roomDesc').value.trim();
  const pw = $('roomPw').value.trim();
  const owner = state.me ? state.me.uid : 'system';
  if(custom){
    custom = custom.replace(/[^a-zA-Z0-9\-\_]/g,'').toLowerCase();
    const doc = await db.collection('rooms').doc(custom).get();
    if(doc.exists && roomModalMode === 'create') return alert('Room id taken.');
  } else {
    custom = genId('room');
  }
  const data = { name: name || custom, desc, owner, created: nowISO(), members: [] };
  if(pw) data.passwordHash = await sha256Hex(pw);
  try{
    await db.collection('rooms').doc(custom).set(data, { merge: true });
    $('roomModal').style.display = 'none';
    toast(roomModalMode === 'create' ? 'Room created ✓' : 'Room updated');
    // open the room
    selectRoom(custom);
  }catch(e){ alert(e.message); }
}

// --- Private room modal & access caching ---
function showPrivateModalForRoom(roomId, roomName){
  const unlocked = JSON.parse(localStorage.getItem('chatbox_access_v2') || '{}');
  if(unlocked[roomId]) return selectRoom(roomId);
  $('privateRoomName').value = roomName || roomId;
  $('privateRoomId').value = roomId;
  $('privateRoomPw').value = '';
  $('privateModal').style.display = 'flex';
}
function hidePrivateModal(){ $('privateModal').style.display = 'none'; }

async function tryUnlockPrivateRoom(){
  const id = $('privateRoomId').value;
  const pw = $('privateRoomPw').value || '';
  const doc = await db.collection('rooms').doc(id).get();
  if(!doc.exists){ alert('Room not found'); hidePrivateModal(); return; }
  const data = doc.data();
  if(!data.passwordHash){ grantAccessAndOpen(id); return; }
  const candidate = await sha256Hex(pw);
  if(candidate === data.passwordHash) grantAccessAndOpen(id);
  else toast('❌ Incorrect password', 1400);
}
function grantAccessAndOpen(roomId){
  const unlocked = JSON.parse(localStorage.getItem('chatbox_access_v2') || '{}');
  unlocked[roomId] = true;
  localStorage.setItem('chatbox_access_v2', JSON.stringify(unlocked));
  hidePrivateModal();
  if(state.me){
    db.collection('rooms').doc(roomId).update({ members: firebase.firestore.FieldValue.arrayUnion(state.me.uid) });
  }
  selectRoom(roomId);
  toast('✅ Access granted');
}

// --- Select room and messages listener ---
async function selectRoom(id){
  // check server room existence and (if protected) local access
  const doc = await db.collection('rooms').doc(id).get();
  if(!doc.exists) return alert('Room not found');
  const r = doc.data();
  if(r.passwordHash){
    const unlocked = JSON.parse(localStorage.getItem('chatbox_access_v2') || '{}');
    if(!unlocked[id] && (!state.me || state.me.uid !== r.owner)) {
      // require unlock
      showPrivateModalForRoom(id, r.name);
      return;
    }
  }
  state.currentRoom = id;
  renderRoomPanel();
  startMessagesListener(id);
}

function renderRoomPanel(){
  if(!state.currentRoom){ $('roomInfo').textContent = 'No room selected'; $('roomActions').innerHTML=''; $('roomTitle').textContent='Welcome'; $('roomSub').textContent='Select or create a room'; return; }
  db.collection('rooms').doc(state.currentRoom).get().then(doc => {
    if(!doc.exists) return;
    const r = doc.data();
    $('roomTitle').textContent = r.name || state.currentRoom;
    db.collection('messages').where('roomId','==',state.currentRoom).get().then(snap => {
      $('roomSub').textContent = snap.size ? snap.size + ' messages' : 'No messages yet';
    });
    $('roomInfo').innerHTML = `<strong>ID:</strong> ${state.currentRoom}<br><strong>Owner:</strong> ${r.owner || 'system'}<br><strong>Description:</strong> ${escapeHtml(r.desc || 'No description')}`;
    const ra = $('roomActions'); ra.innerHTML = '';
    const joinBtn = document.createElement('button'); joinBtn.className='pill-btn'; joinBtn.textContent = 'Join Room';
    joinBtn.addEventListener('click', ()=> {
      if(r.passwordHash){
        const unlocked = JSON.parse(localStorage.getItem('chatbox_access_v2') || '{}');
        if(unlocked[r.id]) { toast('Already joined'); return; }
        $('privateRoomName').value = r.name; $('privateRoomId').value = r.id; $('privateRoomPw').value = ''; $('privateModal').style.display = 'flex';
      } else {
        if(!state.me) return alert('Sign in to join');
        db.collection('rooms').doc(r.id).update({ members: firebase.firestore.FieldValue.arrayUnion(state.me.uid) });
        toast('Joined');
      }
    });
    const copyBtn = document.createElement('button'); copyBtn.className='pill-btn'; copyBtn.textContent = 'Copy ID';
    copyBtn.addEventListener('click', ()=> { navigator.clipboard?.writeText(state.currentRoom); toast('Copied ID'); });
    ra.appendChild(joinBtn); ra.appendChild(copyBtn);

    if(state.me && state.me.uid === r.owner){
      const editBtn = document.createElement('button'); editBtn.className='pill-btn'; editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', ()=> openRoomModal('edit', state.currentRoom));
      const delBtn = document.createElement('button'); delBtn.className='pill-btn'; delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async ()=> {
        if(confirm('Delete room and messages?')) {
          await db.collection('rooms').doc(state.currentRoom).delete();
          // delete messages batch
          const msgs = await db.collection('messages').where('roomId','==',state.currentRoom).get();
          const batch = db.batch();
          msgs.forEach(m => batch.delete(m.ref));
          await batch.commit();
          toast('Room deleted');
          state.currentRoom = null;
          renderRoomPanel();
          renderRooms();
        }
      });
      ra.appendChild(editBtn); ra.appendChild(delBtn);
    }

    const members = r.members && r.members.length ? r.members.join(', ') : '(no members)';
    const memDiv = document.createElement('div'); memDiv.className='small muted'; memDiv.style.marginTop='8px'; memDiv.textContent = 'Members: '+members;
    ra.appendChild(memDiv);
  });
}

// --- Messages listener ---
function startMessagesListener(roomId){
  if(state.messagesUnsub) state.messagesUnsub();
  state.messagesUnsub = db.collection('messages').where('roomId','==',roomId).orderBy('time','asc')
    .onSnapshot(snap => {
      const container = $('messages'); container.innerHTML = '';
      snap.forEach(doc => {
        const m = doc.data();
        const el = document.createElement('div');
        const isMe = state.me && m.from === state.me.uid;
        el.className = 'msg ' + (isMe ? 'me' : 'others');
        const fromLine = document.createElement('div'); fromLine.className='from'; fromLine.textContent = m.fromName || m.from;
        const text = document.createElement('div'); text.innerHTML = (m.imageURL ? `<img src="${m.imageURL}" style="max-width:300px;border-radius:8px;display:block;margin-bottom:6px">` : '') + escapeHtml(m.text);
        const time = document.createElement('div'); time.className='time'; time.textContent = (new Date(m.time)).toLocaleString();
        el.appendChild(fromLine); el.appendChild(text); el.appendChild(time);
        container.appendChild(el);
      });
      container.scrollTop = container.scrollHeight;
    }, err => console.error(err));
}
function stopMessagesListener(){ if(state.messagesUnsub) state.messagesUnsub(); state.messagesUnsub = null; }

// --- Send message ---
function handleFileAttach(e){
  const f = e.target.files[0];
  if(!f) return;
  if(!f.type.startsWith('image/')) return alert('Image only (demo)');
  const reader = new FileReader();
  reader.onload = () => { state.pendingImage = reader.result; toast('Image attached (demo)'); };
  reader.readAsDataURL(f);
}

async function sendMessage(){
  const txt = $('messageInput').value.trim();
  if(!txt && !state.pendingImage) return;
  if(!state.currentRoom) return alert('Select a room');
  if(!state.me) return alert('Login first');

  // check protected room -> require unlock
  const rdoc = await db.collection('rooms').doc(state.currentRoom).get();
  if(!rdoc.exists) return alert('Room not found');
  const r = rdoc.data();
  if(r.passwordHash){
    const unlocked = JSON.parse(localStorage.getItem('chatbox_access_v2') || '{}');
    if(!unlocked[state.currentRoom] && state.me.uid !== r.owner){
      showPrivateModalForRoom(state.currentRoom, r.name);
      return;
    }
  }

  // For demo we allow base64 images (not for production). Recommend uploading to GitHub manually and pasting raw URL into message.
  const imageURL = state.pendingImage || null;
  state.pendingImage = null; $('fileAttach').value = '';

  // get fromName
  const udoc = await db.collection('users').doc(state.me.uid).get();
  const fromName = udoc.exists ? (udoc.data().name || state.me.email) : state.me.email;

  await db.collection('messages').add({
    roomId: state.currentRoom,
    from: state.me.uid,
    fromName,
    text: txt,
    imageURL,
    time: nowISO()
  });

  $('messageInput').value = '';
  toast('Message sent');
}

// --- Profile editor (name + avatar url or base64 demo) ---
async function openProfileEditor(){
  if(!state.me) { $('authOverlay').style.display='flex'; return; }
  const name = prompt('Display name', state.me.name) || state.me.name;
  const choose = confirm('Upload avatar file? (OK = pick file -> base64 demo; Cancel = paste GitHub raw URL)');
  if(choose){
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept='image/*';
    inp.onchange = (ev)=> {
      const f = ev.target.files[0]; if(!f) return;
      const r = new FileReader();
      r.onload = async ()=> {
        const b64 = r.result;
        await db.collection('users').doc(state.me.uid).update({ name, avatarURL: b64 });
        state.me.name = name; state.me.avatar = b64; renderAuthState(); toast('Profile updated (demo)');
      };
      r.readAsDataURL(f);
    };
    inp.click();
  } else {
    const url = prompt('Paste raw GitHub image URL (recommended):','');
    if(url){
      await db.collection('users').doc(state.me.uid).update({ name, avatarURL: url });
      state.me.name = name; state.me.avatar = url; renderAuthState(); toast('Profile updated');
    } else {
      await db.collection('users').doc(state.me.uid).update({ name });
      state.me.name = name; renderAuthState(); toast('Name updated');
    }
  }
}

function renderAuthState(){
  // refresh state.me details from db (best effort)
  if(!state.me) { $('meTag').textContent='(not signed)'; $('profileEmail').textContent='Not signed'; $('profileAvatar').textContent='?'; return; }
  db.collection('users').doc(state.me.uid).get().then(doc => {
    if(doc.exists){
      const d = doc.data();
      state.me.name = d.name || state.me.email;
      state.me.avatar = d.avatarURL || null;
    }
    $('meTag').textContent = state.me.email;
    $('profileEmail').textContent = state.me.email;
    $('profileNameNote').textContent = state.me.name;
    if(state.me.avatar){ $('profileAvatar').style.backgroundImage = `url(${state.me.avatar})`; $('profileAvatar').textContent = ''; }
    else { $('profileAvatar').style.backgroundImage = ''; $('profileAvatar').textContent = (state.me.name||'U').slice(0,2).toUpperCase(); }
  });
}

// --- Export / import (client helpers) ---
async function exportData(){
  const users = [], rooms = [], msgs = [];
  const ut = await db.collection('users').get(); ut.forEach(d=> users.push({ id:d.id, ...d.data() }));
  const rt = await db.collection('rooms').get(); rt.forEach(d=> rooms.push({ id:d.id, ...d.data() }));
  const mt = await db.collection('messages').get(); mt.forEach(d=> msgs.push({ id:d.id, ...d.data() }));
  const data = { users, rooms, messages: msgs };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='chatbox-export.json'; a.click(); URL.revokeObjectURL(url);
}
function importData(){ alert('Import to Firestore must be done via admin tools / console.'); }

// --- Theme toggle & online count ---
function toggleTheme(){
  const a = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  if(a === '#7c3aed'){ document.documentElement.style.setProperty('--accent','#06b6d4'); document.documentElement.style.setProperty('--accent2','#7c3aed'); }
  else { document.documentElement.style.setProperty('--accent','#7c3aed'); document.documentElement.style.setProperty('--accent2','#06b6d4'); }
}
async function updateOnlineCount(){
  const snap = await db.collection('messages').orderBy('time','desc').limit(200).get();
  const set = {};
  snap.forEach(d => { const m = d.data(); if(m.from && m.from !== 'system') set[m.from] = true; });
  $('onlineCount').textContent = Object.keys(set).length;
}

// Expose for quick debugging
window.chatbox_v2 = { db, auth, sha256Hex };

// End of app.js
