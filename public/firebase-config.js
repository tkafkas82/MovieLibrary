// ─────────────────────────────────────────────────────────────────────────
// OPTIONAL: Google sign-in + settings sync (scan folders + OMDb key).
//
// Leave FIREBASE_CONFIG = null to keep sign-in disabled (the app works fully
// without it). To enable it, create a free Firebase project and paste its web
// config below. See the README ("Sign in with Google to sync your settings")
// for the 5-minute setup, including the Firestore security rule.
//
// NOTE: a Firebase *web* config is not a secret — Google intends it to live in
// client code. Real protection comes from the Firestore rules + the list of
// authorized domains in the Firebase console. So it's fine to commit this file.
// ─────────────────────────────────────────────────────────────────────────
window.FIREBASE_CONFIG = {
 apiKey: "AIzaSyDXBexYYqfFnKD4A7sHaAjo2Su81x5ma6Y",
  authDomain: "mymovielibrary-5cc8d.firebaseapp.com",
  projectId: "mymovielibrary-5cc8d",
  appId: "1:707195274916:web:743c37c5d1187597bb8831"
};
