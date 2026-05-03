// Firebase config + init.
// Compat SDK (window.firebase) se carga como <script> clásico en index.html.
// Mientras el resto del codigo sigue inline, este modulo expone window._fbAuth/_fbDb/_fbUser/_initFirebase
// para que el codigo legacy siga funcionando sin cambios. El bridge se elimina cuando services/UI migren.

export const firebaseConfig = {
  apiKey:            "AIzaSyD2wKWooUfxxiJf-QjhI0X7vZ-NlB9ZKZ4",
  authDomain:        "prestcontrol-5e965.firebaseapp.com",
  projectId:         "prestcontrol-5e965",
  storageBucket:     "prestcontrol-5e965.firebasestorage.app",
  messagingSenderId: "296362364315",
  appId:             "1:296362364315:web:a4846f6dc1daf7c173253e"
};

export function initFirebase() {
  if (typeof window.firebase === 'undefined') {
    console.warn('Firebase SDK no disponible — modo offline');
    return false;
  }
  try {
    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(firebaseConfig);
    }
    window._fbAuth = window.firebase.auth();
    window._fbDb   = window.firebase.firestore();
    window._fbDb.enablePersistence().catch(() => {});
    window._fbAuth.onAuthStateChanged(user => {
      window._fbUser = user || null;
    });
    return true;
  } catch (e) {
    console.warn('Firebase init error:', e);
    return false;
  }
}

window.firebaseConfig = firebaseConfig;
window._initFirebase  = initFirebase;
window._fbAuth = null;
window._fbDb   = null;
window._fbUser = null;
