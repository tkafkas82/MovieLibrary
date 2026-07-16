// Optional Google sign-in + settings sync, via Firebase (Auth + Firestore).
// Loaded as a plain script; exposes window.MovieSync for app.js to drive.
// Self-disables (MovieSync.enabled = false) unless firebase-config.js provides
// a real config, so the app works untouched without it.
//
// Synced fields (per signed-in user, doc users/<uid>): scanRoots, formats,
// omdbApiKey. The Firebase SDK is imported from the gstatic CDN on demand.

(() => {
  const cfg = window.FIREBASE_CONFIG;
  const configured = !!(cfg && typeof cfg === 'object' && cfg.apiKey && !/^AIzaSyX+/.test(cfg.apiKey));

  // Minimal surface app.js talks to. Methods are no-ops until Firebase loads.
  const M = {
    enabled: configured,
    ready: false,
    user: null,
    cloudConfig: null,
    _handlers: [],
    onState(cb) { this._handlers.push(cb); if (this.ready) cb(this._state()); },
    _state() { return { signedIn: !!this.user, email: this.user && this.user.email, config: this.cloudConfig }; },
    _emit() { const s = this._state(); this._handlers.forEach((h) => { try { h(s); } catch (e) { console.error(e); } }); },
    async signIn() {}, async signOut() {}, async save() {},
    async saveList() { return null; }, async listLists() { return []; },
    async getList() { return null; }, async deleteList() {},
  };
  window.MovieSync = M;
  if (!configured) return;

  const V = '10.12.0';
  const cdn = (m) => `https://www.gstatic.com/firebasejs/${V}/firebase-${m}.js`;

  (async () => {
    const { initializeApp } = await import(cdn('app'));
    const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } = await import(cdn('auth'));
    const { getFirestore, doc, getDoc, setDoc, serverTimestamp,
      collection, getDocs, addDoc, deleteDoc } = await import(cdn('firestore'));

    const app = initializeApp(cfg);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const provider = new GoogleAuthProvider();
    const userDoc = () => doc(db, 'users', auth.currentUser.uid);
    const listsCol = () => collection(db, 'users', auth.currentUser.uid, 'lists');

    M.signIn = () => signInWithPopup(auth, provider).catch((e) => {
      console.error(e);
      alert('Google sign-in failed: ' + (e && e.message ? e.message : e) +
        '\n\nMake sure this site\'s domain is in your Firebase project\'s Authorized domains.');
    });
    M.signOut = () => signOut(auth).catch((e) => console.error(e));

    // Write the given fields to the user's doc (merge). Keys are stored as an
    // array so the list — and its rotation order — survives across devices.
    M.save = async (config) => {
      if (!auth.currentUser) return;
      const data = { updatedAt: serverTimestamp() };
      if (Array.isArray(config.scanRoots)) data.scanRoots = config.scanRoots;
      if (Array.isArray(config.formats)) data.formats = config.formats;
      if (Array.isArray(config.omdbApiKeys)) data.omdbApiKeys = config.omdbApiKeys;
      try {
        await setDoc(userDoc(), data, { merge: true });
        M.cloudConfig = { ...(M.cloudConfig || {}), ...data };
      } catch (e) { console.error('cloud save failed', e); }
    };

    // ── saved lists (users/<uid>/lists/<id>: { name, data:{movies,series} }) ──
    M.saveList = async (name, data) => {
      if (!auth.currentUser) throw new Error('Not signed in');
      const ref = await addDoc(listsCol(), { name: String(name).trim() || 'Untitled', data, updatedAt: serverTimestamp() });
      return ref.id;
    };
    M.listLists = async () => {
      if (!auth.currentUser) return [];
      const snap = await getDocs(listsCol());
      return snap.docs
        .map((d) => ({ id: d.id, name: d.data().name || 'Untitled' }))
        .sort((a, b) => a.name.localeCompare(b.name));
    };
    M.getList = async (id) => {
      if (!auth.currentUser) return null;
      const d = await getDoc(doc(db, 'users', auth.currentUser.uid, 'lists', id));
      return d.exists() ? (d.data().data || { movies: [], series: [] }) : null;
    };
    M.deleteList = async (id) => {
      if (!auth.currentUser) return;
      await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'lists', id));
    };

    onAuthStateChanged(auth, async (user) => {
      M.user = user;
      M.cloudConfig = null;
      if (user) {
        try {
          const snap = await getDoc(userDoc());
          M.cloudConfig = snap.exists() ? snap.data() : null;
        } catch (e) { console.error('cloud read failed', e); }
      }
      M.ready = true;
      M._emit();
    });
  })().catch((e) => {
    console.error('Firebase failed to load; sign-in disabled.', e);
    M.enabled = false;
    M._emit();
  });
})();
