// ============================================
// KÖRÖK — barát- és chatrendszer
// ============================================

let currentUser = null;      // Firebase Auth user objektum
let unsubFriends = null;     // Firestore listener leiratkozók
let unsubIncoming = null;
let unsubOutgoing = null;
let unsubChat = null;
let activeChatFriendId = null;
let friendsCache = {};       // uid -> {name, photo}

const $ = (id) => document.getElementById(id);

// ---------- segédfüggvények ----------
function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function chatIdFor(uidA, uidB){
  return [uidA, uidB].sort().join('_');
}

function fallbackAvatar(name){
  // egyszerű, névből generált SVG avatar, ha nincs kép
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const colors = ['#6C5CE7','#17B897','#FF6B6B','#F4A73B'];
  const color = colors[(initial.charCodeAt(0) || 0) % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">
    <rect width="80" height="80" fill="${color}"/>
    <text x="50%" y="54%" font-family="Inter, sans-serif" font-size="34" fill="#fff"
      text-anchor="middle" dominant-baseline="middle">${initial}</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function showAuthError(msg){
  $('authError').textContent = msg || '';
}

// ============================================
// BEJELENTKEZÉS / KIJELENTKEZÉS
// ============================================
$('googleLoginBtn').addEventListener('click', async () => {
  showAuthError('');
  try{
    await auth.signInWithPopup(googleProvider);
  }catch(err){
    console.error(err);
    showAuthError('Nem sikerült bejelentkezni: ' + err.message);
  }
});

$('logoutBtn').addEventListener('click', () => auth.signOut());

auth.onAuthStateChanged(async (user) => {
  if(user){
    currentUser = user;
    await ensureUserDoc(user);
    $('authScreen').classList.add('hidden');
    $('appScreen').classList.remove('hidden');
    renderMe(user);
    attachListeners(user.uid);
  } else {
    currentUser = null;
    detachListeners();
    $('appScreen').classList.add('hidden');
    $('authScreen').classList.remove('hidden');
  }
});

// felhasználó dokumentum létrehozása / frissítése első belépéskor
async function ensureUserDoc(user){
  const ref = db.collection('users').doc(user.uid);
  const snap = await ref.get();
  const data = {
    displayName: user.displayName || 'Névtelen',
    nameLower: (user.displayName || '').toLowerCase(),
    email: user.email || '',
    photoURL: user.photoURL || '',
    customPhotoURL: snap.exists ? (snap.data().customPhotoURL || null) : null,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if(!snap.exists){
    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
  }
  await ref.set(data, { merge: true });
}

function activePhotoFor(userData){
  if(!userData) return fallbackAvatar('?');
  return userData.customPhotoURL || userData.photoURL || fallbackAvatar(userData.displayName);
}

// ============================================
// SAJÁT PROFIL / PROFILKÉP FELTÖLTÉS
// ============================================
async function renderMe(user){
  const snap = await db.collection('users').doc(user.uid).get();
  const data = snap.data() || {};
  $('myName').textContent = data.displayName || user.displayName || 'Névtelen';
  $('myEmail').textContent = data.email || user.email || '';
  $('myAvatarImg').src = activePhotoFor(data);
}

$('changeAvatarBtn').addEventListener('click', () => $('avatarFileInput').click());

$('avatarFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if(!file || !currentUser) return;
  if(!file.type.startsWith('image/')){
    alert('Csak képfájlt lehet feltölteni.');
    return;
  }
  if(file.size > 5 * 1024 * 1024){
    alert('A kép legfeljebb 5 MB lehet.');
    return;
  }
  try{
    const ref = storage.ref().child(`avatars/${currentUser.uid}/${Date.now()}_${file.name}`);
    await ref.put(file);
    const url = await ref.getDownloadURL();
    await db.collection('users').doc(currentUser.uid).set({ customPhotoURL: url }, { merge: true });
    $('myAvatarImg').src = url;
  }catch(err){
    console.error(err);
    alert('Nem sikerült feltölteni a képet: ' + err.message);
  }
  e.target.value = '';
});

// profilkép nagyítás lightboxban (saját és mások avatarjára kattintva)
$('lightbox').addEventListener('click', () => $('lightbox').classList.add('hidden'));
function openLightbox(url){
  $('lightboxImg').src = url;
  $('lightbox').classList.remove('hidden');
}
$('myAvatarImg').addEventListener('click', (e) => {
  e.stopPropagation();
  openLightbox($('myAvatarImg').src);
});

// ============================================
// FÜLEK (TABOK)
// ============================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('is-active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('is-active'));
    btn.classList.add('is-active');
    $('panel-' + btn.dataset.tab).classList.add('is-active');
  });
});

// ============================================
// KERESÉS NÉV ALAPJÁN
// ============================================
$('searchBtn').addEventListener('click', runSearch);
$('searchInput').addEventListener('keydown', (e) => { if(e.key === 'Enter') runSearch(); });

async function runSearch(){
  const term = $('searchInput').value.trim();
  const list = $('searchResults');
  const empty = $('searchEmpty');
  list.innerHTML = '';
  empty.classList.add('hidden');
  if(!term){ return; }

  const termLower = term.toLowerCase();
  try{
    const snap = await db.collection('users')
      .orderBy('nameLower')
      .startAt(termLower)
      .endAt(termLower + '\uf8ff')
      .limit(20)
      .get();

    const [friendsSnap, outgoingSnap, incomingSnap] = await Promise.all([
      db.collection('friends').doc(currentUser.uid).collection('list').get(),
      db.collection('friendRequests').where('from','==',currentUser.uid).where('status','==','pending').get(),
      db.collection('friendRequests').where('to','==',currentUser.uid).where('status','==','pending').get()
    ]);
    const friendIds = new Set(friendsSnap.docs.map(d => d.id));
    const outgoingIds = new Set(outgoingSnap.docs.map(d => d.data().to));
    const incomingIds = new Set(incomingSnap.docs.map(d => d.data().from));

    let count = 0;
    snap.forEach(doc => {
      if(doc.id === currentUser.uid) return;
      count++;
      const data = doc.data();
      const li = document.createElement('li');
      li.className = 'person';

      let actionHtml;
      if(friendIds.has(doc.id)){
        actionHtml = `<span class="person-badge">✓ már barátok</span>`;
      } else if(outgoingIds.has(doc.id)){
        actionHtml = `<span class="person-badge person-badge--pending">Kérés elküldve</span>`;
      } else if(incomingIds.has(doc.id)){
        actionHtml = `<span class="person-badge person-badge--pending">Ő jelölt téged</span>`;
      } else {
        actionHtml = `<button class="btn btn--add btn--small" data-uid="${doc.id}" data-action="add">+ Jelölés</button>`;
      }

      li.innerHTML = `
        <div class="person-main" data-avatar="${activePhotoFor(data)}">
          <img class="avatar" src="${activePhotoFor(data)}" alt="${escapeHtml(data.displayName)} profilképe" />
          <div>
            <div class="person-name">${escapeHtml(data.displayName)}</div>
            <div class="person-sub">${escapeHtml(data.email || '')}</div>
          </div>
        </div>
        <div class="person-actions">${actionHtml}</div>
      `;
      list.appendChild(li);
    });

    if(count === 0) empty.classList.remove('hidden');
  }catch(err){
    console.error(err);
    empty.textContent = 'Hiba történt a keresés közben: ' + err.message;
    empty.classList.remove('hidden');
  }
}

// keresési lista kattintás-delegálás: jelölés küldése + avatar nagyítás
$('searchResults').addEventListener('click', async (e) => {
  const avatarImg = e.target.closest('.person-main img');
  if(avatarImg){ openLightbox(avatarImg.src); return; }

  const btn = e.target.closest('[data-action="add"]');
  if(!btn) return;
  const toUid = btn.dataset.uid;
  btn.disabled = true;
  btn.textContent = 'Küldés…';
  try{
    await sendFriendRequest(toUid);
    btn.outerHTML = `<span class="person-badge person-badge--pending">Kérés elküldve</span>`;
  }catch(err){
    console.error(err);
    alert('Nem sikerült elküldeni a kérést: ' + err.message);
    btn.disabled = false;
    btn.textContent = '+ Jelölés';
  }
});

async function sendFriendRequest(toUid){
  // duplikáció-ellenőrzés
  const existing = await db.collection('friendRequests')
    .where('from','==',currentUser.uid).where('to','==',toUid).where('status','==','pending').get();
  if(!existing.empty) return;

  await db.collection('friendRequests').add({
    from: currentUser.uid,
    to: toUid,
    status: 'pending',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// ============================================
// LISTENEREK: BARÁTOK / BEJÖVŐ / KIMENŐ KÉRÉSEK
// ============================================
function attachListeners(uid){
  unsubFriends = db.collection('friends').doc(uid).collection('list')
    .onSnapshot(renderFriends, (err) => console.error('friends listener', err));

  unsubIncoming = db.collection('friendRequests')
    .where('to','==',uid).where('status','==','pending')
    .onSnapshot(renderIncoming, (err) => console.error('incoming listener', err));

  unsubOutgoing = db.collection('friendRequests')
    .where('from','==',uid).where('status','==','pending')
    .onSnapshot(renderOutgoing, (err) => console.error('outgoing listener', err));
}

function detachListeners(){
  [unsubFriends, unsubIncoming, unsubOutgoing, unsubChat].forEach(u => u && u());
  unsubFriends = unsubIncoming = unsubOutgoing = unsubChat = null;
  friendsCache = {};
}

// ---------- barátok listája ----------
async function renderFriends(snap){
  const list = $('friendsList');
  const empty = $('friendsEmpty');
  const orbit = $('friendsOrbit');
  list.innerHTML = '';
  orbit.innerHTML = '';
  $('friendsCount').textContent = snap.size || '';

  if(snap.empty){
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const docs = snap.docs;
  friendsCache = {};

  // orbit vizualizáció: barátok avatarjai körben elhelyezve
  const radius = 26, centerX = 35, centerY = 35;
  docs.slice(0, 8).forEach((doc, i) => {
    const data = doc.data();
    const angle = (i / Math.min(docs.length, 8)) * 2 * Math.PI - Math.PI/2;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    const img = document.createElement('img');
    img.src = data.friendPhoto || fallbackAvatar(data.friendName);
    img.style.left = `${x}px`;
    img.style.top = `${y}px`;
    img.title = data.friendName;
    orbit.appendChild(img);
  });

  docs.forEach(doc => {
    const data = doc.data();
    friendsCache[doc.id] = { name: data.friendName, photo: data.friendPhoto };

    const li = document.createElement('li');
    li.className = 'person';
    li.innerHTML = `
      <div class="person-main" data-uid="${doc.id}">
        <img class="avatar" src="${data.friendPhoto || fallbackAvatar(data.friendName)}" alt="${escapeHtml(data.friendName)} profilképe" />
        <div>
          <div class="person-name">${escapeHtml(data.friendName)}</div>
          <div class="person-sub">Kattints a beszélgetéshez</div>
        </div>
      </div>
    `;
    list.appendChild(li);
  });
}

$('friendsList').addEventListener('click', (e) => {
  const avatarImg = e.target.closest('.person-main img');
  const main = e.target.closest('.person-main');
  if(!main) return;
  if(avatarImg && e.target === avatarImg){
    // rövid kattintás az avatarra is megnyithatja a chatet; nagyításhoz hosszabb módot használunk lenn
  }
  const uid = main.dataset.uid;
  const cached = friendsCache[uid];
  openChat(uid, cached ? cached.name : 'Barát', cached ? cached.photo : '');
});

// ---------- bejövő kérések ----------
async function renderIncoming(snap){
  const list = $('requestsList');
  const empty = $('requestsEmpty');
  list.innerHTML = '';
  $('requestsCount').textContent = snap.size || '';

  if(snap.empty){
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for(const doc of snap.docs){
    const req = doc.data();
    const userSnap = await db.collection('users').doc(req.from).get();
    const u = userSnap.data() || {};
    const li = document.createElement('li');
    li.className = 'person';
    li.innerHTML = `
      <div class="person-main">
        <img class="avatar" src="${activePhotoFor(u)}" alt="${escapeHtml(u.displayName)} profilképe" />
        <div>
          <div class="person-name">${escapeHtml(u.displayName || 'Ismeretlen')}</div>
          <div class="person-sub">${escapeHtml(u.email || '')}</div>
        </div>
      </div>
      <div class="person-actions">
        <button class="btn btn--accept btn--small" data-action="accept" data-req="${doc.id}" data-from="${req.from}">Elfogadás</button>
        <button class="btn btn--decline btn--small" data-action="decline" data-req="${doc.id}">Elutasítás</button>
      </div>
    `;
    list.appendChild(li);
  }
}

$('requestsList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;
  btn.disabled = true;
  const reqId = btn.dataset.req;
  try{
    if(btn.dataset.action === 'accept'){
      await acceptFriendRequest(reqId, btn.dataset.from);
    } else {
      await db.collection('friendRequests').doc(reqId).update({ status: 'declined' });
    }
  }catch(err){
    console.error(err);
    alert('Hiba történt: ' + err.message);
    btn.disabled = false;
  }
});

async function acceptFriendRequest(reqId, fromUid){
  const [meSnap, otherSnap] = await Promise.all([
    db.collection('users').doc(currentUser.uid).get(),
    db.collection('users').doc(fromUid).get()
  ]);
  const me = meSnap.data() || {};
  const other = otherSnap.data() || {};

  const batch = db.batch();
  batch.update(db.collection('friendRequests').doc(reqId), { status: 'accepted' });
  batch.set(db.collection('friends').doc(currentUser.uid).collection('list').doc(fromUid), {
    friendName: other.displayName || 'Névtelen',
    friendPhoto: activePhotoFor(other),
    since: firebase.firestore.FieldValue.serverTimestamp()
  });
  batch.set(db.collection('friends').doc(fromUid).collection('list').doc(currentUser.uid), {
    friendName: me.displayName || 'Névtelen',
    friendPhoto: activePhotoFor(me),
    since: firebase.firestore.FieldValue.serverTimestamp()
  });
  await batch.commit();
}

// ---------- kimenő (elküldött) kérések ----------
async function renderOutgoing(snap){
  const list = $('outgoingList');
  const empty = $('outgoingEmpty');
  list.innerHTML = '';

  if(snap.empty){
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for(const doc of snap.docs){
    const req = doc.data();
    const userSnap = await db.collection('users').doc(req.to).get();
    const u = userSnap.data() || {};
    const li = document.createElement('li');
    li.className = 'person';
    li.innerHTML = `
      <div class="person-main">
        <img class="avatar" src="${activePhotoFor(u)}" alt="${escapeHtml(u.displayName)} profilképe" />
        <div>
          <div class="person-name">${escapeHtml(u.displayName || 'Ismeretlen')}</div>
          <div class="person-sub">Válaszra vár</div>
        </div>
      </div>
      <div class="person-actions">
        <button class="btn btn--ghost btn--small" data-action="cancel" data-req="${doc.id}">Visszavonás</button>
      </div>
    `;
    list.appendChild(li);
  }
}

$('outgoingList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="cancel"]');
  if(!btn) return;
  btn.disabled = true;
  try{
    await db.collection('friendRequests').doc(btn.dataset.req).delete();
  }catch(err){
    console.error(err);
    alert('Hiba történt: ' + err.message);
    btn.disabled = false;
  }
});

// ============================================
// CHAT
// ============================================
function openChat(friendUid, friendName, friendPhoto){
  activeChatFriendId = friendUid;
  $('chatEmptyState').classList.add('hidden');
  $('chatActive').classList.remove('hidden');
  $('chatPanel').classList.add('is-open');
  $('chatName').textContent = friendName;
  $('chatAvatar').src = friendPhoto || fallbackAvatar(friendName);
  $('chatMessages').innerHTML = '';

  if(unsubChat) unsubChat();
  const chatId = chatIdFor(currentUser.uid, friendUid);
  unsubChat = db.collection('chats').doc(chatId).collection('messages')
    .orderBy('createdAt', 'asc')
    .limitToLast(200)
    .onSnapshot(renderMessages, (err) => console.error('chat listener', err));
}

function renderMessages(snap){
  const box = $('chatMessages');
  box.innerHTML = '';
  snap.forEach(doc => {
    const m = doc.data();
    const mine = m.senderId === currentUser.uid;
    const div = document.createElement('div');
    div.className = 'msg ' + (mine ? 'msg--me' : 'msg--them');
    const time = m.createdAt && m.createdAt.toDate
      ? m.createdAt.toDate().toLocaleTimeString('hu-HU', {hour:'2-digit', minute:'2-digit'})
      : '';
    div.innerHTML = `${escapeHtml(m.text)}<span class="msg-time">${time}</span>`;
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

$('closeChatBtn').addEventListener('click', () => {
  $('chatPanel').classList.remove('is-open');
  $('chatActive').classList.add('hidden');
  $('chatEmptyState').classList.remove('hidden');
  if(unsubChat) unsubChat();
  activeChatFriendId = null;
});

$('chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('chatInput');
  const text = input.value.trim();
  if(!text || !activeChatFriendId) return;
  input.value = '';
  const chatId = chatIdFor(currentUser.uid, activeChatFriendId);
  try{
    await db.collection('chats').doc(chatId).collection('messages').add({
      senderId: currentUser.uid,
      text: text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chats').doc(chatId).set({
      participants: [currentUser.uid, activeChatFriendId],
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }catch(err){
    console.error(err);
    alert('Nem sikerült elküldeni az üzenetet: ' + err.message);
  }
});