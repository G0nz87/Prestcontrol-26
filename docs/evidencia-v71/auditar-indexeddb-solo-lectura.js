// Fragmento opcional para DevTools, en la cuenta desbloqueada, durante la revisión operativa.
// No sincroniza, borra, repara ni restaura. Devuelve una copia local sensible para respaldo.
(async () => {
  const bd = typeof obtenerDBLocalHistorica === 'function'
    ? obtenerDBLocalHistorica()
    : typeof DB !== 'undefined' ? DB : null;
  const uid = window._fbUser?.uid;
  if (!bd || !uid) throw new Error('Ingresá y desbloqueá la cuenta antes de auditar.');
  const stores = Array.from(bd.objectStoreNames);
  if (!stores.includes('sync_queue') || !stores.includes('config')) throw new Error('Faltan stores requeridos. No interpretar como cola vacía.');
  const datos = await new Promise((resolve,reject) => {
    const snapshot = {};
    const tx = bd.transaction(stores,'readonly');
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('No se pudo leer la base; conciliación no verificada.'));
    tx.oncomplete = () => resolve(snapshot);
    for (const store of stores) {
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => { snapshot[store] = req.result; };
    }
  });
  const actual = typeof obtenerDBLocalHistorica === 'function' ? obtenerDBLocalHistorica() : DB;
  if (actual !== bd || window._fbUser?.uid !== uid) throw new Error('Cambió la cuenta durante la lectura; repetir auditoría.');
  const pendientes = datos.sync_queue.filter(op => ['pending','error'].includes(op.estado));
  const config = key => datos.config.find(item => item.key === key)?.value ?? null;
  return {
    resumen: {
      uid, base:bd.name, version:bd.version, fecha:new Date().toISOString(),
      pendientes:pendientes.length, errores:pendientes.filter(op=>op.estado==='error').length,
      operaciones:pendientes.map(op=>({opId:op.opId,store:op.store,recordId:op.recordId,operation:op.operation,estado:op.estado})),
      restorePending:config('restorePending'), cargaHistoricaCache:config('cargaHistoricaRemotaV1'),
      registros:Object.fromEntries(stores.map(store=>[store,datos[store].length]))
    },
    datosLocales:datos
  };
})()
