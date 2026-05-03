// Servicio de autenticacion. Strict: solo wrappers de Firebase Auth + estado de sesion.
// No toca DOM, no muestra alertas, no hace toast — devuelve promesas o lanza errores
// para que la UI los capture. Es la fuente de verdad del current user.

export class AuthService {
  constructor() {
    this._currentUser  = null;
    this._bootstrapped = false;
  }

  // Registra el listener onAuthStateChanged contra _fbAuth (que setea _initFirebase()).
  // Idempotente — se puede llamar varias veces. Llamar despues de que _fbAuth exista.
  bootstrap() {
    if (this._bootstrapped) return;
    if (!window._fbAuth) return;
    this._bootstrapped = true;
    window._fbAuth.onAuthStateChanged(user => {
      this._currentUser = user || null;
      window._fbUser    = this._currentUser; // bridge legacy
    });
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
