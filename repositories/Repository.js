// Repositorio base con CRUD generico contra Firestore.
// Cada coleccion vive bajo users/{uid}/{collectionName}, scopeado al usuario logueado.
// Las subclases (ClienteRepository, PrestamoRepository) solo definen el nombre de coleccion.

export class Repository {
  constructor(collectionName) {
    if (!collectionName) throw new Error('Repository: collectionName requerido');
    this.collectionName = collectionName;
  }

  _col() {
    return window._fbDb
      .collection('users').doc(window._fbUser.uid)
      .collection(this.collectionName);
  }

  _doc(id) {
    return this._col().doc(id);
  }

  _serverTimestamp() {
    return window.firebase.firestore.FieldValue.serverTimestamp();
  }

  async save(entity) {
    if (!window._fbUser) return;
    await this._doc(entity.id).set(
      { ...entity, userId: window._fbUser.uid, updatedAt: this._serverTimestamp() },
      { merge: true }
    );
  }

  async softDelete(id) {
    if (!window._fbUser) return;
    await this._doc(id).set(
      { _deleted: true, updatedAt: this._serverTimestamp() },
      { merge: true }
    );
  }

  async getAll() {
    if (!window._fbUser) return [];
    const snap = await this._col().get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async getById(id) {
    if (!window._fbUser) return null;
    const doc = await this._doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  }
}
