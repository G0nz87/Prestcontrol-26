// Servicio de autenticacion. Strict: solo wrappers de Firebase Auth + estado de sesion.
// No toca DOM, no muestra alertas, no hace toast — devuelve promesas o lanza errores
// para que la UI los capture. Es la fuente de verdad del current user.

export class AuthService {
  constructor() {
    this._currentUser  = null;
    this._bootstrapped = false;
    this._initialStatePromise = null;
  }

  // Registra el listener onAuthStateChanged contra _fbAuth (que setea _initFirebase()).
  // Idempotente y devuelve el primer estado real restaurado por Firebase Auth.
  // Llamar despues de que _fbAuth exista.
  bootstrap() {
    if (this._initialStatePromise) return this._initialStatePromise;
    if (!window._fbAuth) return Promise.resolve(null);
    this._bootstrapped = true;

    this._initialStatePromise = (async () => {
      try {
        await window._fbAuth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
      } catch (error) {
        console.warn('No se pudo configurar persistencia LOCAL de Firebase Auth:', error?.code || error);
      }

      return await new Promise((resolve, reject) => {
        let estadoInicialPendiente = true;
        window._fbAuth.onAuthStateChanged(user => {
          this._currentUser = user || null;
          window._fbUser    = this._currentUser; // bridge legacy
          if (typeof window.onFirebaseAuthStateChanged === 'function') {
            window.onFirebaseAuthStateChanged(this._currentUser);
          }
          if (estadoInicialPendiente) {
            estadoInicialPendiente = false;
            resolve(this._currentUser);
          }
        }, error => {
          if (estadoInicialPendiente) {
            estadoInicialPendiente = false;
            reject(error);
          }
        });
      });
    })();

    return this._initialStatePromise;
  }

  // Devuelve UserCredential de Firebase (.user, .credential, ...). Tira el error de
  // Firebase tal cual (auth/wrong-password, auth/invalid-credential, etc.) para que
  // la UI lo mapee como ya lo hace.
  async login(email, password) {
    if (!window._fbAuth) throw new Error('Firebase auth no inicializado');
    return await window._fbAuth.signInWithEmailAndPassword(email, password);
  }

  async logout() {
    if (!window._fbAuth) return;
    return await window._fbAuth.signOut();
  }

  getCurrentUser() {
    return this._currentUser;
  }
}
