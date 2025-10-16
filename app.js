// ✅ Firebase initialization
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

// 🔹 Helper functions
const $ = id => document.getElementById(id);
const toast = (msg) => {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
};

// Wait for DOM ready
window.addEventListener('DOMContentLoaded', () => {
  bindUI();
  firebase.auth().onAuthStateChanged(onAuthChange);
});

// 🔹 UI bindings
function bindUI() {
  $('signupBtn').onclick = signup;
  $('gotoLogin').onclick = () => switchAuthMode('login');
  $('loginBtn').onclick = login;
  $('gotoSignup').onclick = () => switchAuthMode('signup');
  $('btnLogout').onclick = () => auth.signOut();
}

function switchAuthMode(mode) {
  if (mode === 'login') {
    $('authArea').style.display = 'none';
    $('loginArea').style.display = 'block';
    $('panelTitle').textContent = 'Login to ChatBox';
  } else {
    $('authArea').style.display = 'block';
    $('loginArea').style.display = 'none';
    $('panelTitle').textContent = 'Create Account';
  }
}

// 🔹 Auth functions
async function signup() {
  const email = $('emailInput').value.trim();
  const pw = $('pwInput').value.trim();
  if (!email || !pw) return alert('Enter email and password');
  try {
    const userCred = await auth.createUserWithEmailAndPassword(email, pw);
    const user = userCred.user;
    await db.collection('users').doc(user.uid).set({
      email,
      name: email.split('@')[0],
      created: new Date().toISOString()
    });
    $('authOverlay').style.display = 'none';
    toast('✅ Account created!');
  } catch (err) {
    alert(err.message);
  }
}

async function login() {
  const email = $('loginEmail').value.trim();
  const pw = $('loginPw').value.trim();
  if (!email || !pw) return alert('Enter email and password');
  try {
    await auth.signInWithEmailAndPassword(email, pw);
    $('authOverlay').style.display = 'none';
    toast('✅ Logged in!');
  } catch (err) {
    alert(err.message);
  }
}

// 🔹 Auth change handler
async function onAuthChange(user) {
  if (user) {
    $('authOverlay').style.display = 'none';
    $('meTag').textContent = user.email;
    $('profileEmail').textContent = user.email;
    toast('Welcome back 👋');
  } else {
    $('authOverlay').style.display = 'flex';
    $('meTag').textContent = '(not signed)';
    $('profileEmail').textContent = 'Not signed';
  }
}
