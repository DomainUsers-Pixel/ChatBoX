// app.js (module)
import "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js";
import "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js";
import "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js";

/*
  Replace the config below with your config (you already provided it).
  This file uses the compat build (simple for small apps).
*/
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

// DOM helpers
const $ = id => document.getElementById(id);
const toastEl = $('toast');
function toast(msg, t=2800){ toastEl.textContent = msg; toastEl.classList.add('show'); setTimeout(()=> toastEl.classList.remove('show'), t); }

// simple utils
const nowISO = ()=> new Date().toISOString();
const genId = (p='r') => p + '-' + Math.random().toString(36).slice(2,9);

// hashing helper using SubtleCrypto (SHA-256)
async function sha256Hex(s){
  const enc = new TextEncoder();
  const data = enc.encode(s);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// app state
let state = { me: null, currentRoom: null, messagesUnsub: null, roomsUnsub: null };

// bind UI
function bindUI(){
  $('signupBtn').addEventListener('click', signup);
  $('gotoLogin').addEventListener('click', ()=>{ $('authArea').style.display='none'; $('loginArea').style.display='block'; $('panelTitle').textContent='Login'; });
  $('gotoSignup').addEventListener('click', ()=>{ $('authArea').style.display='block'; $('loginArea').style.display='none'; $('panelTitle').textContent='Create account'; });
  $('loginBtn').addEventListener('click', login);
  $('newRoomBtn').addEventListener('click', ()=> openRoomModal('create'));
  $('sendBtn').addEventListener('click', sendMessage);
  $('messageInput').addEventListener('keydown', (e)=> { if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendMessage(); }});
  $('btnLogout').addEventListener('click', ()=> { auth.signOut(); });
  $('btnProfile').addEventListener('click', openProfileEditor);
  $('exportBtn').addEventListener('click', exportData);
  $('importBtn').addEventListener('click', importData);
  $('searchInput').addEventListener('input', ()=> renderRooms($('searchInput').value.trim().toLowerCase()));
  $('attachBtn').addEventListener('click', ()=> $('fileAttach').click());
  $('fileAttach').addEventListener('change', handleFileAttach);
  $('themeToggle').addEventListener('click', toggleTheme);
  $('cancelRoom').addEventListener('click', ()=> $('roomModal').style.display='none');
  $('saveRoom').addEventListener('click', saveRoomFromModal);

  $('privateCancel').addEventListener('click', ()=> hidePrivateModal());
  $('privateUnlock').addEventListener('click', tryUnlockPrivateRoom);
}

// AUTH: signup / login (via Firebase Auth)
async function signup(){
  const email = $('emailInput').value.trim();
  const pw = $('pwInput').value;
  if(!email || !pw) return alert('Provide email & password');
  try{
    const userCred = await auth.createUserWithEmailAndPassword(email, pw);
    const user = userCred.user;
    // create user doc
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
  const pw = $('loginPw').value;
  if(!email || !pw) return alert('Provide email & password');
  try{
    await auth.signInWithEmailAndPassword(email, pw);
    $('authOverlay').style.display = 'none';
    toast('Logged in ✓');
  }catch(e){ alert(e.message); }
}

// when auth state changes
auth.onAuthStateChanged(async (user) => {
  if(user){
    state.me = { uid: user.uid, email: user.email };
    // load profile details
    const doc = await db.collection('users').doc(user.uid).get();
    if(doc.exists) {
      const data = doc.data();
      state.me.name = data.name;
      state.me.avatar = data.avatarURL || null;
    }
    renderAuthState();
    startRoomsListener();
  } else {
    // logged out
    state.me = null;
    renderAuthState();
    stopRoomsListener();
    stopMessagesListener();
    $('authOverlay').style.display = 'flex';
  }
});

// RENDER auth UI
function renderAuthState(){
  $('meTag').textContent = state.me ? state.me.email : '(not signed)';
  $('profileEmail').textContent = state.me ? state.me.email : 'Not signed';
  $('profileNameNote').textContent = state.me ? state.me.name : 'Tap Profile to edit';
  if(state.me && state.me.avatar){
    $('profileAvatar').style.backgroundImage = `url(${state.me.avatar})`;
    $('profileAvatar').style.backgroundSize = 'cover';
    $('profileAvatar').textContent = '';
  } else {
    $('profileAvatar').style.backgroundImage = '';
    $('profileAvatar').textContent = state.me ? (state.me.name||'U').slice(0,2).toUpperCase() : '?';
  }
  $('authOverlay').style.display = state.me ? 'none' : 'flex';
}

// ROOMS: realtime listener
function startRoomsListener(){
  if(state.roomsUnsub) state.roomsUnsub();
  state.roomsUnsub = db.collection('rooms').orderBy('created','desc').onSnapshot(snap => {
    renderRooms();
  }, err => console.error(err));
}
function stopRoomsListener(){ if(state.roomsUnsub) state.roomsUnsub(); state.roomsUnsub = null; }

// render rooms (live)
async function renderRooms(filter=''){
  const roomsSnap = await db.collection('rooms').orderBy('created','desc').get();
  const rooms = [];
  roomsSnap.forEach(d => rooms.push({ id: d.id, ...d.data() }));
  const roomsList = $('roomsList');
  roomsList.innerHTML = '';
  rooms.forEach(r => {
    if(filter){
      const s = (r.name + ' ' + r.id + ' ' + (r.desc||'')).toLowerCase();
      if(!s.includes(filter)) return;
    }
    const div = document.createElement('div'); div.className = 'room-item'; div.dataset.room = r.id;
    const av = document.createElement('div'); av.className = 'avatar'; av.textContent = (r.name||r.id).slice(0,2).toUpperCase();
    const meta = document.createElement('div'); meta.className = 'room-meta';
    const title = document.createElement('div'); title.style.fontWeight = 700; title.textContent = r.name || r.id;
    if(r.passwordHash) { const lock = document.createElement('span'); lock.className='lock-icon'; lock.textContent = ' 🔒'; title.appendChild(lock); }
    const sub = document.createElement('div'); sub.className = 'small muted'; sub.textContent = r.desc || 'No description';
    const owner = document.createElement('div'); owner.className = 'small'; owner.textContent = 'owner: '+(r.owner || 'system');
    meta.appendChild(title); meta.appendChild(sub); meta.appendChild(owner);
    div.appendChild(av); div.appendChild(meta);
    div.addEventListener('click', ()=> { if(r.passwordHash) showPrivateModalForRoom(r.id, r.name); else selectRoom(r.id); });
    roomsList.appendChild(div);
  });
}

// create / edit room modal
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
      $('roomPw').value = ''; // don't show hashes
    });
  } else {
    $('roomName').value = ''; $('roomCustomId').value = ''; $('roomDesc').value = ''; $('roomPw').value = '';
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
    if(doc.exists && roomModalMode==='create') return alert('Room id taken.');
  } else {
    custom = genId('room');
  }
  const data = { name: name || custom, desc, owner, created: nowISO(), members: [] };
  if(pw) data.passwordHash = await sha256Hex(pw); // store hash only
  try{
    await db.collection('rooms').doc(custom).set(data, { merge: true });
    $('roomModal').style.display = 'none';
    toast(roomModalMode === 'create' ? 'Room created ✓' : 'Room updated');
    renderRooms();
    selectRoom(custom);
  }catch(e){ alert(e.message); }
}

// PRIVATE ROOM modal
function showPrivateModalForRoom(roomId, roomName){
  // check local unlocked cache first
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
  if(candidate === data.passwordHash){
    grantAccessAndOpen(id);
  } else {
    toast('❌ Incorrect password', 1400);
  }
}
function grantAccessAndOpen(roomId){
  const access = JSON.parse(localStorage.getItem('chatbox_access_v2') || '{}');
  access[roomId] = true;
  localStorage.setItem('chatbox_access_v2', JSON.stringify(access));
  hidePrivateModal();
  // add to members if signed in
  if(state.me){
    db.collection('rooms').doc(roomId).update({
      members: firebase.firestore.FieldValue.arrayUnion(state.me.uid)
    });
  }
  selectRoom(roomId);
  toast('✅ Access granted');
}

// select room and subscribe to messages
async function selectRoom(id){
  // check access again server-side (we only have hash). We rely on hashed password match above.
  state.currentRoom = id;
  renderRoomPanel();
  startMessagesListener(id);
}

function renderRoomPanel(){
  const id = state.currentRoom;
  if(!id){ $('roomInfo').textContent = 'No room selected'; $('roomActions').innerHTML=''; $('roomTitle').textContent='Welcome'; $('roomSub').textContent='Select or create a room to start'; return; }
  db.collection('rooms').doc(id).get().then(doc => {
    if(!doc.exists) return;
    const r = doc.data();
    $('roomTitle').textContent = r.name || id;
    db.collection('messages').where('roomId','==',id).orderBy('time','desc').get().then(snap => {
      $('roomSub').textContent = snap.size ? snap.size + ' messages' : 'No messages yet';
    });
    $('roomInfo').innerHTML = `<strong>ID:</strong> ${id}<br><strong>Owner:</strong> ${r.owner || 'system'}<br><strong>Description:</strong> ${r.desc||'No description'}`;
    const ra = $('roomActions'); ra.innerHTML = '';
    const joinBtn = document.createElement('button'); joinBtn.className='pill-btn'; joinBtn.textContent = 'Join Room';
    joinBtn.addEventListener('click', ()=> {
      // if room has password prompt
      if(r.passwordHash){
        const unlocked = JSON.parse(localStorage.getItem('chatbox_access_v2') || '{}');
        if(!unlocked[id]) { $('privateRoomName').value = r.name; $('privateRoomId').value = id; $('privateRoomPw').value = ''; $('privateModal').style.display = 'flex'; return; }
        toast('Already joined');
      } else {
        if(!state.me) return alert('Sign in to join');
        db.collection('rooms').doc(id).update({ members: firebase.firestore.FieldValue.arrayUnion(state.me.uid) });
        toast('Joined');
      }
    });
    const copyBtn = document.createElement('button'); copyBtn.className='pill-btn'; copyBtn.textContent = 'Copy ID';
    copyBtn.addEventListener('click', ()=> { navigator.clipboard?.writeText(id); toast('Copied ID'); });
    ra.appendChild(joinBtn); ra.appendChild(copyBtn);
    if(state.me && state.me.uid === r.owner){
      const editBtn = document.createElement('button'); editBtn.className='pill-btn'; editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', ()=> openRoomModal('edit', id));
      const delBtn = document.createElement('button'); delBtn.className='pill-btn'; delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async ()=> {
        if(confirm('Delete room and its messages? This is permanent.')){
          await db.collection('rooms').doc(id).delete();
          // delete messages for that room (batch)
          const msgs = await db.collection('messages').where('roomId','==',id).get();
          const batch = db.batch();
          msgs.forEach(m => batch.delete(m.ref));
          await batch.commit();
          toast('Room deleted');
        }
      });
      ra.appendChild(editBtn); ra.appendChild(delBtn);
    }
    const members = r.members && r.members.length ? r.members.join(', ') : '(no members)';
    const memDiv = document.createElement('div'); memDiv.className='small muted'; memDiv.style.marginTop='8px'; memDiv.textContent = 'Members: '+members;
    ra.appendChild(memDiv);
  });
}

// MESSAGES: listener
function startMessagesListener(roomId){
  if(state.messagesUnsub) state.messagesUnsub();
  state.messagesUnsub = db.collection('messages')
    .where('roomId','==',roomId)
    .orderBy('time','asc')
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

// Send message (writes to messages collection)
let pendingImageData = null;
function handleFileAttach(e){
  const f = e.target.files[0];
  if(!f) return;
  if(!f.type.startsWith('image/')) return alert('Image only for demo');
  const reader = new FileReader();
  reader.onload = () => { pendingImageData = reader.result; toast('Image attached (will be sent)'); };
  reader.readAsDataURL(f);
}
$('attachBtn').addEventListener('click', ()=> $('fileAttach').click());
$('fileAttach').addEventListener('change', handleFileAttach);

async function sendMessage(){
  const txt = $('messageInput').value.trim();
  if(!txt && !pendingImageData) return;
  if(!state.currentRoom) return alert('Choose a room');
  if(!state.me) return alert('Login first');
  // check room password / access
  const rdoc = await db.collection('rooms').doc(state.currentRoom).get();
  if(!rdoc.exists) return alert('Room not found');
  const r = rdoc.data();
  if(r.passwordHash){
    // check local unlocked
    const unlocked = JSON.parse(localStorage.getItem('chatbox_access_v2') || '{}');
    if(!unlocked[state.currentRoom] && state.me.uid !== r.owner) {
      // show modal to enter password
      showPrivateModalForRoom(state.currentRoom, r.name);
      return;
    }
  }
  // upload image: NOTE: we are NOT using Firebase Storage (per your choice). For real hosting, upload to GitHub and paste raw URL.
  // For demo, we can store base64 in message.imageURL (not recommended for production).
  let imageURL = null;
  if(pendingImageData){
    // WARNING: base64 may be large. We store it for demo only.
    imageURL = pendingImageData;
    pendingImageData = null;
    $('fileAttach').value = '';
  }
  const userDoc = await db.collection('users').doc(state.me.uid).get();
  const fromName = userDoc.exists ? (userDoc.data().name || state.me.email) : state.me.email;
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

// PROFILE editor: avatar -> prefer GitHub raw URL
async function openProfileEditor(){
  if(!state.me) { $('authOverlay').style.display = 'flex'; return; }
  const name = prompt('Display name', state.me.name) || state.me.name;
  const shouldUpload = confirm('Upload avatar? (OK = pick file -> saved as base64 demo; Cancel = paste GitHub raw URL)');
  if(shouldUpload){
    const inp = document.createElement('input'); inp.type='file'; inp.accept='image/*';
    inp.onchange = (ev) => {
      const f = ev.target.files[0];
      if(!f) return;
      const r = new FileReader();
      r.onload = async () => {
        const b64 = r.result;
        await db.collection('users').doc(state.me.uid).update({ name, avatarURL: b64 });
        state.me.name = name; state.me.avatar = b64; renderAuthState(); toast('Profile updated (base64)');
      };
      r.readAsDataURL(f);
    };
    inp.click();
  } else {
    const url = prompt('Paste your avatar image raw URL (GitHub raw URL recommended):', '');
    if(url){
      await db.collection('users').doc(state.me.uid).update({ name, avatarURL: url });
      state.me.name = name; state.me.avatar = url; renderAuthState(); toast('Profile updated (URL)');
    } else {
      // just update name
      await db.collection('users').doc(state.me.uid).update({ name });
      state.me.name = name; renderAuthState(); toast('Name updated');
    }
  }
}

// EXPORT / IMPORT local snapshot (client-side) — helpful for debugging
function exportData(){
  // Get snapshot from Firestore (client-side shallow)
  Promise.all([
    db.collection('users').get(),
    db.collection('rooms').get(),
    db.collection('messages').get()
  ]).then(([uS, rS, mS]) => {
    const users = []; uS.forEach(d=> users.push({ id: d.id, ...d.data() }));
    const rooms = []; rS.forEach(d=> rooms.push({ id: d.id, ...d.data() }));
    const msgs = []; mS.forEach(d=> msgs.push({ id: d.id, ...d.data() }));
    const data = { users, rooms, messages: msgs };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'chatbox-export.json'; a.click(); URL.revokeObjectURL(url);
  });
}
function importData(){
  alert('Import to Firestore is not automated here. Use Firebase Console to import JSON or write a server tool.');
}

// theme
function toggleTheme(){
  const a = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  if(a === '#7c3aed'){ document.documentElement.style.setProperty('--accent','#06b6d4'); document.documentElement.style.setProperty('--accent2','#7c3aed'); }
  else { document.documentElement.style.setProperty('--accent','#7c3aed'); document.documentElement.style.setProperty('--accent2','#06b6d4'); }
}

// helpers
function escapeHtml(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Rooms rendering helper
async function renderRooms(filter=''){
  const roomsSnap = await db.collection('rooms').orderBy('created','desc').get();
  const rooms = [];
  roomsSnap.forEach(d => rooms.push({ id: d.id, ...d.data() }));
  const roomsList = $('roomsList');
  roomsList.innerHTML = '';
  rooms.forEach(r => {
    if(filter){
      const s = (r.name + ' ' + r.id + ' ' + (r.desc||'')).toLowerCase();
      if(!s.includes(filter)) return;
    }
    const div = document.createElement('div'); div.className = 'room-item'; div.dataset.room = r.id;
    const av = document.createElement('div'); av.className = 'avatar'; av.textContent = (r.name||r.id).slice(0,2).toUpperCase();
    const meta = document.createElement('div'); meta.className = 'room-meta';
    const title = document.createElement('div'); title.style.fontWeight = 700; title.textContent = r.name || r.id;
    if(r.passwordHash) { const lock = document.createElement('span'); lock.className='lock-icon'; lock.textContent = ' 🔒'; title.appendChild(lock); }
    const sub = document.createElement('div'); sub.className = 'small muted'; sub.textContent = r.desc || 'No description';
    const owner = document.createElement('div'); owner.className = 'small'; owner.textContent = 'owner: '+(r.owner || 'system');
    meta.appendChild(title); meta.appendChild(sub); meta.appendChild(owner);
    div.appendChild(av); div.appendChild(meta);
    div.addEventListener('click', ()=> { if(r.passwordHash) showPrivateModalForRoom(r.id, r.name); else selectRoom(r.id); });
    roomsList.appendChild(div);
  });
}

// message listener control
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

// initial startup
bindUI();
renderRooms();
setInterval(()=> { renderRooms(); updateOnlineCount(); }, 3000);

// online count (simple)
async function updateOnlineCount(){
  const snap = await db.collection('messages').orderBy('time','desc').limit(200).get();
  const users = {};
  snap.forEach(d => { const m = d.data(); if(m.from && m.from !== 'system') users[m.from] = true; });
  $('onlineCount').textContent = Object.keys(users).length;
}

// Expose debug helper
window.chatbox_v2 = {
  db, auth, sha256Hex
};
