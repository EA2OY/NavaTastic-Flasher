// Flasher web de NavaTastic.
//   ESP32  (Heltec V3 / V4): se graba por cable con esptool-js (WebSerial).
//   nRF52  (Promicro E22P, Faketec, Seed, T114, Xiao): el navegador NO puede escribir en la
//          unidad de memoria del bootloader, así que se manda el nodo a modo grabación y se
//          descarga el .uf2 para que el usuario lo copie a la unidad. Es el camino real.
// Sin backend: todo ocurre en el navegador. Textos en lenguaje llano.

// Versión que usa el flasher oficial de Meshtastic. Comprobado que se sirve con permiso de otro
// origen y que exporta ESPLoader y Transport, con los métodos setRTS/waitForUnlock/writeFlash.
const ESPTOOL = 'https://cdn.jsdelivr.net/npm/esptool-js@0.5.7/bundle.js';
const VID_ADAFRUIT = 0x239a; // familia Adafruit: incluye el cargador UF2 de las placas nRF52
const PIDS_CARGADOR = [0x0029, 0x002a, 0x4029]; // identificadores del cargador UF2

const $ = (id) => document.getElementById(id);

let indice = null;
const soportaSerial = 'serial' in navigator;

// ---------- arranque ----------
(async function init() {
  if (!soportaSerial) {
    $('avisoNavegador').hidden = false;
  }
  try {
    const r = await fetch('firmware.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('respuesta ' + r.status);
    indice = await r.json();
  } catch (e) {
    mostrarError('No he podido leer la lista de ficheros (firmware.json). Recarga la página; si sigue igual, avísame.');
    return;
  }
  if (!indice.versiones && !indice.nrf52 && !indice.esp32) {
    mostrarError('La lista de ficheros está vacía. Avisa de esto: es un fallo de la web.');
    return;
  }
  rellenarVersiones();
  rellenarPlacas();
  $('version').addEventListener('change', () => { rellenarPlacas(); actualizarDetalle(); });
  $('placa').addEventListener('change', actualizarDetalle);
  document.querySelectorAll('input[name=rama]').forEach((r) => r.addEventListener('change', actualizarDetalle));
  $('btnFlashear').addEventListener('click', () => flashear(false));
  $('btnSinBorrar').addEventListener('click', () => flashear(true));
  $('btnDescargar').addEventListener('click', () => descargar());
  $('btnSerie').addEventListener('click', alternarSerie);
  $('btnCopiarLog').addEventListener('click', copiarConsola);
  $('btnLimpiarLog').addEventListener('click', () => { $('consola').textContent = ''; });
  actualizarDetalle();
})();

// ---------- lista de placas ----------
function bonito(nombre) {
  return nombre.replace(/^HeltecV(\d)$/, 'Heltec V$1').replace(/\+/g, ' + ');
}

// La versión elegida (V5.3.1 sobre 2.7.26, V6 sobre 2.8.0...) manda sobre qué placas hay.
function versionActual() {
  if (indice.versiones) {
    const id = $('version').value || indice.porDefecto || Object.keys(indice.versiones)[0];
    return indice.versiones[id] || indice.versiones[indice.porDefecto];
  }
  return indice; // formato antiguo del índice, por si acaso
}

function rellenarVersiones() {
  const sel = $('version');
  sel.innerHTML = '';
  if (!indice.versiones) {
    sel.hidden = true;
    $('detalleVersion').hidden = true;
    return;
  }
  for (const [id, v] of Object.entries(indice.versiones)) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = v.nombre + ' (' + v.base + ')' + (v.estado ? ' — ' + v.estado : '');
    sel.appendChild(o);
  }
  sel.value = indice.porDefecto || Object.keys(indice.versiones)[0];
}

function rellenarPlacas() {
  const sel = $('placa');
  const v = versionActual();
  sel.innerHTML = '';
  const grupos = [
    ['Placas nRF52840 (fichero UF2)', v.nrf52],
    ['Placas ESP32-S3 (grabado por cable)', v.esp32],
  ];
  for (const [titulo, tabla] of grupos) {
    if (!tabla) continue;
    const g = document.createElement('optgroup');
    g.label = titulo;
    for (const p of Object.keys(tabla)) {
      const o = document.createElement('option');
      o.value = (v.nrf52 && v.nrf52[p] ? 'nrf52:' : 'esp32:') + p;
      o.textContent = bonito(p);
      g.appendChild(o);
    }
    sel.appendChild(g);
  }
}

// ---------- qué fichero toca ----------
function seleccion() {
  const [familia, placa] = ($('placa').value || '').split(':');
  const rama = document.querySelector('input[name=rama]:checked').value;
  const v = versionActual();
  const tabla = ((familia === 'nrf52' ? v.nrf52 : v.esp32) || {})[placa] || {};
  const principal = tabla[rama + (familia === 'nrf52' ? '_uf2' : '_FACTORY')];
  const extra = tabla[rama + (familia === 'nrf52' ? '_zip' : '_APP')];
  return { familia, placa, rama, principal, extra, version: v };
}

function actualizarDetalle() {
  $('error').hidden = true;
  $('progreso').hidden = true;
  $('resultado').textContent = 'Cuando termine te diré aquí qué hacer. Normalmente nada: el nodo arranca solo.';
  const s = seleccion();
  const v = s.version;
  $('versionFirmware').textContent = v.nombre + ' · ' + v.base;
  if ($('detalleVersion')) {
    $('detalleVersion').textContent = v.nombre + ' · base ' + v.base + ' · ' + (v.estado ? v.estado + ' · ' : '') +
      'publicada el ' + v.fecha + '.';
  }
  // Aviso cuando la versión elegida no es la estable (Alpha, Beta...).
  // Manda el campo "estable" del índice, no el texto: así la etiqueta puede decir "Beta (estable)".
  const aviso = $('avisoVersion');
  if (aviso) {
    if (v.estado && v.estable !== true) {
      const estable = Object.values(indice.versiones || {}).find((x) => x.estable === true);
      aviso.hidden = false;
      aviso.innerHTML = '<b>' + v.nombre + ' (' + v.base + ') es una versión ' + v.estado + '.</b> ' +
        'Todavía está en pruebas y puede dar problemas' +
        (estable ? ': para el día a día elige <b>' + estable.nombre + '</b>, que es la versión estable.' : '.');
    } else {
      aviso.hidden = true;
      aviso.textContent = '';
    }
  }
  if (!s.principal) {
    $('detalleFichero').textContent = 'No hay fichero para esa combinación. Avisa de esto: es un fallo de la web.';
    $('btnFlashear').disabled = true;
    return;
  }
  const mb = (s.principal.bytes / 1048576).toFixed(1).replace('.', ',');
  $('detalleFichero').innerHTML =
    'Se instalará <b>' + s.principal.nombre + '</b> (' + mb + ' MB).';
  const esESP32 = s.familia === 'esp32';
  $('btnFlashear').disabled = !soportaSerial;
  $('btnSinBorrar').disabled = !soportaSerial;
  $('btnSinBorrar').hidden = !esESP32;
  $('btnFlashear').textContent = esESP32 ? 'Borrado completo + instalar' : 'Poner en modo grabación';
  $('notaBorrado').hidden = !esESP32;
  $('notaBorrado').innerHTML =
    '<b>Borrado completo + instalar</b>: borra toda la memoria del nodo (incluida su configuración) y después ' +
    'instala el firmware. Es lo recomendado en la primera instalación y cuando algo va mal. ' +
    '<b>Actualizar sin borrar</b>: cambia solo el firmware y conserva lo que tuviera el nodo (canales, claves, ' +
    'nombre); para actualizar un nodo que ya lleva NavaTastic.';
  $('btnSerie').hidden = !esESP32;
  $('ayudaConexion').innerHTML = esESP32
    ? 'Conecta la placa con un <b>cable de datos</b> y pulsa el botón. Si no aparece el puerto, mantén pulsado ' +
      '<b>BOOT</b> mientras conectas el cable. En la <b>consola</b> de abajo se ve todo lo que va pasando.'
    : 'Conecta la placa con un <b>cable de datos</b> y pulsa el botón: mando el nodo a modo grabación y te doy ' +
      'el fichero para que lo copies a la unidad que aparezca.';
}

// ---------- utilidades ----------
function mostrarError(texto) {
  const e = $('error');
  e.textContent = texto;
  e.hidden = false;
}

function progreso(porcentaje, texto) {
  $('progreso').hidden = false;
  $('barraRelleno').style.width = Math.max(0, Math.min(100, porcentaje)) + '%';
  $('progresoTexto').textContent = texto;
}

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- consola: lo que va pasando, en pantalla ----------
let bufferConsola = '';

function consolaEstado(texto) {
  $('consolaTitulo').textContent = texto;
}

function alFinalDeLaConsola() {
  const c = $('consola');
  return c.scrollHeight - c.scrollTop - c.clientHeight < 60;
}

function consolaLinea(texto, clase) {
  const c = $('consola');
  const s = document.createElement('span');
  if (clase) s.className = clase;
  s.textContent = String(texto).replace(/\s+$/, '') + '\n';
  c.appendChild(s);
  if (alFinalDeLaConsola()) c.scrollTop = c.scrollHeight;
}

// Para lo que llega del puerto serie: se pega tal cual, sin añadir saltos de línea.
function consolaCrudo(texto) {
  const c = $('consola');
  c.appendChild(document.createTextNode(String(texto)));
  if (alFinalDeLaConsola()) c.scrollTop = c.scrollHeight;
}

// esptool escribe unas veces líneas enteras y otras trozos sueltos: aquí se juntan.
function terminalConsola() {
  return {
    clean() { $('consola').textContent = ''; bufferConsola = ''; },
    writeLine(d) {
      if (bufferConsola) { consolaLinea(bufferConsola); bufferConsola = ''; }
      consolaLinea(d);
    },
    write(d) {
      bufferConsola += String(d);
      const partes = bufferConsola.split(/\r?\n/);
      bufferConsola = partes.pop();
      for (const p of partes) if (p.trim() !== '') consolaLinea(p);
    },
  };
}

// ---------- salida del nodo por el puerto serie ----------
let leyendoSerie = false;

async function alternarSerie() {
  if (leyendoSerie) { leyendoSerie = false; return; }
  try {
    const puerto = await puertoElegido();
    await verSerie(puerto, 90, false);
  } catch (e) {
    mostrarError(traducirError(e));
  }
}

async function verSerie(puerto, segundos, automatico) {
  if (leyendoSerie || !puerto) return;
  leyendoSerie = true;
  const boton = $('btnSerie');
  boton.textContent = 'Parar';
  consolaLinea('--- Salida del nodo por el puerto serie (' + segundos + ' s' + (automatico ? ', automático' : '') +
    '). El despliegue interno tarda alrededor de un minuto: si no ves nada, pulsa otra vez «Ver salida del nodo». ---',
    'propio');
  consolaEstado('Leyendo la salida del nodo…');
  let lector = null;
  try {
    await puerto.open({ baudRate: 115200 });
    lector = puerto.readable.getReader();
    const decodificador = new TextDecoder();
    const fin = Date.now() + segundos * 1000;
    while (leyendoSerie && Date.now() < fin) {
      const r = await Promise.race([lector.read(), dormir(400).then(() => null)]);
      if (!r) continue;
      if (r.done) break;
      if (r.value) consolaCrudo(decodificador.decode(r.value, { stream: true }));
    }
  } catch (e) {
    consolaLinea('No he podido leer el puerto serie: ' + ((e && e.message) || e) +
      ' — si el nodo acaba de reiniciarse, vuelve a probar con el botón.', 'avisoConsola');
  } finally {
    leyendoSerie = false;
    boton.textContent = 'Ver salida del nodo';
    try { if (lector) await lector.cancel(); } catch (e) { /* ya estaba cerrado */ }
    try { await puerto.close(); } catch (e) { /* ya estaba cerrado */ }
    consolaEstado('Terminado');
  }
}

async function copiarConsola() {
  const boton = $('btnCopiarLog');
  try {
    await navigator.clipboard.writeText($('consola').textContent);
    boton.textContent = 'Copiado';
  } catch (e) {
    // Si el navegador no deja copiar solo, se deja el texto seleccionado para copiarlo a mano.
    const rango = document.createRange();
    rango.selectNodeContents($('consola'));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(rango);
    boton.textContent = 'Seleccionado';
  }
  setTimeout(() => { boton.textContent = 'Copiar'; }, 1600);
}

function traducirError(e) {
  const m = String((e && e.message) || e || '');
  if (/no he podido abrir la lista de puertos/i.test(m)) return 'El navegador ha bloqueado la elección del puerto. Vuelve a pulsar el botón y elige el puerto enseguida, sin esperar.';
  if (/No port selected|NotFoundError|cancel/i.test(m)) return 'No has elegido ningún puerto. Vuelve a intentarlo y elige el del nodo.';
  if (/Failed to open|NetworkError|InvalidState|busy|in use/i.test(m)) return 'El puerto está ocupado: solo un programa puede usarlo a la vez. Cierra la app de Meshtastic (o cualquier otro programa que hable con el nodo) y reinténtalo.';
  if (/Failed to fetch|NetworkError when|no se pudo descargar/i.test(m)) return 'No he podido descargar el fichero del firmware. Comprueba tu conexión y recarga la página.';
  if (/Failed to connect|sync|timeout|Wrong boot mode/i.test(m)) return 'No consigo hablar con la placa. Prueba otro cable, pulsa RESET (en ESP32, mantén BOOT al conectar) y reinténtalo.';
  return 'Algo ha fallado: ' + m;
}

// Descarga el fichero y lo devuelve como cadena binaria (1 carácter = 1 byte), que es
// exactamente lo que espera writeFlash de esptool-js: por dentro usa charCodeAt, NO base64.
async function descargarBinario(url, aviso, bytesEsperados) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('no se pudo descargar el fichero (' + r.status + ')');
  // Ojo: si el servidor manda el fichero comprimido, content-length no es el tamaño real,
  // así que para el porcentaje se usa el tamaño que dice el índice.
  const total = bytesEsperados || Number(r.headers.get('content-length') || 0);
  const lector = r.body.getReader();
  const trozos = [];
  let leido = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    trozos.push(value);
    leido += value.length;
    if (total) progreso((leido / total) * 20, aviso + ' ' + Math.round((leido / total) * 100) + ' %');
  }
  const todo = new Uint8Array(leido);
  let pos = 0;
  for (const t of trozos) { todo.set(t, pos); pos += t.length; }
  // Red de seguridad: si el fichero no tiene el tamaño que dice el índice, no se graba nada.
  if (bytesEsperados && todo.length !== bytesEsperados) {
    throw new Error('el fichero descargado no cuadra: ' + todo.length + ' bytes en vez de ' + bytesEsperados);
  }
  let bin = '';
  for (let i = 0; i < todo.length; i += 8192) bin += String.fromCharCode.apply(null, todo.subarray(i, i + 8192));
  return bin;
}

async function puertoElegido() {
  try {
    return await navigator.serial.requestPort();
  } catch (e) {
    // NotFoundError = el usuario ha cancelado; cualquier otro = el navegador ha bloqueado el diálogo.
    if (e && e.name === 'NotFoundError') throw new Error('No port selected');
    throw new Error('no he podido abrir la lista de puertos (' + ((e && e.message) || e) + ')');
  }
}

// ---------- entrada ----------
async function flashear(conservar) {
  $('error').hidden = true;
  const s = seleccion();
  if (!s.principal) return;
  $('btnFlashear').disabled = true;
  $('btnSinBorrar').disabled = true;
  consolaEstado('Trabajando…');
  consolaLinea('== ' + s.version.nombre + ' (' + s.version.base + '): ' +
    (conservar ? 'actualizar sin borrar' : 'borrado completo + instalar') +
    ' — ' + s.principal.nombre + ' ==', 'propio');
  try {
    if (s.familia === 'esp32') await flashearESP32(s, conservar);
    else await modoGrabacionNRF52(s);
  } catch (e) {
    const texto = traducirError(e);
    mostrarError(texto);
    consolaLinea(texto, 'errorConsola');
    progreso(0, '');
  } finally {
    $('btnFlashear').disabled = !soportaSerial;
    $('btnSinBorrar').disabled = !soportaSerial;
  }
}

// ---------- ESP32: grabado real por cable ----------
async function flashearESP32(s, conservar) {
  if (!soportaSerial) throw new Error('este navegador no puede grabar por cable');
  // El puerto se pide PRIMERO: Chrome solo deja elegirlo si el clic es reciente.
  progreso(2, 'Elige el puerto del nodo…');
  consolaEstado('Eligiendo el puerto…');
  const puerto = await puertoElegido();
  progreso(22, 'Descargando el firmware…');
  consolaEstado('Descargando el firmware…');
  const datos = await descargarBinario(s.principal.url, 'Descargando el firmware…', s.principal.bytes);
  const { ESPLoader, Transport } = await import(ESPTOOL);
  const transporte = new Transport(puerto, true);
  const cargador = new ESPLoader({
    transport: transporte,
    baudrate: 460800,
    terminal: terminalConsola(), // sin esto, todo lo que cuenta esptool se perdía
  });
  let ultimoAviso = -10;
  try {
    progreso(26, 'Conectando con la placa…');
    consolaEstado('Conectando con la placa…');
    await cargador.main();
    progreso(30, conservar ? 'Actualizando el firmware. No desconectes el cable…'
                           : 'Borrando y grabando el firmware. No desconectes el cable…');
    consolaEstado(conservar ? 'Actualizando…' : 'Borrando y grabando…');
    consolaLinea(conservar
      ? 'No borro la memoria: se conserva la configuración que tuviera el nodo.'
      : 'Borrado completo de la memoria antes de grabar (tarda unos segundos).', 'propio');
    await cargador.writeFlash({
      fileArray: [{ data: datos, address: 0x0 }], // FACTORY = todo en uno, va en 0x0 (nunca en 0x1000)
      flashMode: 'keep',
      flashFreq: 'keep',
      flashSize: 'keep',
      eraseAll: !conservar,
      compress: true,
      reportProgress: (i, escrito, total) => {
        const pct = total ? escrito / total : 0;
        progreso(30 + pct * 65, 'Grabando… ' + Math.round(pct * 100) + ' %');
        // A la consola solo cada 10 %: si no, se llena de líneas repetidas.
        const diez = Math.floor((pct * 100) / 10) * 10;
        if (diez > ultimoAviso) { ultimoAviso = diez; consolaLinea('Grabando… ' + diez + ' %', 'propio'); }
      },
    });
    progreso(97, 'Reiniciando el nodo…');
    consolaEstado('Reiniciando el nodo…');
    // El reinicio fiable en estas placas es soltar RTS a mano. (hardReset no existe en 0.5.x.)
    try {
      await transporte.setRTS(true);
      await dormir(100);
      await transporte.setRTS(false);
    } catch (e) { /* si no hay setRTS, la placa se reinicia sola al cerrar el puerto */ }
    // Acotado con un tope de tiempo: waitForUnlock espera sin límite a que el puerto quede libre.
    if (typeof transporte.waitForUnlock === 'function') {
      try { await Promise.race([transporte.waitForUnlock(1500), dormir(1500)]); } catch (e) {}
    }
  } finally {
    try { await transporte.disconnect(); } catch (e) { /* ya estaba cerrado */ }
  }
  progreso(100, 'Terminado.');
  $('resultado').innerHTML =
    '<span class="ok">Listo.</span> El nodo ya tiene instalado <b>' + s.version.nombre + '</b> (' + s.version.base +
    ') y abajo, en la consola, estás viendo lo que escribe al arrancar. Dale <b>un minuto</b>: en ese tiempo se ' +
    'configura solo y se reinicia una vez.<br>' +
    '<span class="sub">' + (conservar
      ? 'Se ha conservado la configuración que ya tenía el nodo (canales, claves y nombre).'
      : 'La memoria se ha borrado entera, así que el nodo arranca de fábrica: el firmware le pone el canal ' +
        'Navadmin, la región y las buenas prácticas. Si tenía canales propios, hay que volver a ponerlos.') +
    '</span>';
  // Tras grabar se escucha al nodo unos segundos: ahí se ve el arranque y el despliegue interno.
  await verSerie(puerto, 25, true);
}

// ---------- nRF52: modo grabación + copia manual del UF2 ----------
// El cargador UF2 aparece con estos identificadores (familia Adafruit / Nordic).
// ¿Parece el cargador? Solo es una pista: el fabricante Adafruit (0x239a) lo usan TAMBIÉN las
// placas cuando ejecutan la aplicación, así que ahí hay que mirar el identificador de producto.
// La prueba de verdad es el saludo: si el nodo responde, está ejecutando el firmware.
function esCargador(info) {
  if (!info) return false;
  if (info.usbVendorId === VID_ADAFRUIT) return PIDS_CARGADOR.indexOf(info.usbProductId) >= 0;
  return info.usbVendorId === 0x1915 || info.usbVendorId === 0x2fe3;
}

function describirPuerto(puerto) {
  const i = (puerto && puerto.getInfo && puerto.getInfo()) || {};
  const hex = (v) => (v === undefined ? '?' : '0x' + v.toString(16).padStart(4, '0'));
  return hex(i.usbVendorId) + ':' + hex(i.usbProductId);
}

// ¿Hay entre los puertos ya autorizados alguno que parezca el cargador? (Solo se ven los que
// el usuario ha autorizado alguna vez en este navegador, así que sirve de pista, no de prueba.)
async function hayCargador() {
  if (!navigator.serial.getPorts) return false;
  try {
    const puertos = await navigator.serial.getPorts();
    return puertos.some((p) => esCargador(p.getInfo ? p.getInfo() : null));
  } catch (e) {
    return false;
  }
}

// Toque de 1200 bps. El core de Adafruit entra al cargador cuando DTR pasa a falso CON la
// velocidad puesta en 1200, así que aquí se suelta DTR a propósito en vez de confiar en que
// el sistema lo haga solo al cerrar el puerto (que es lo que fallaba).
async function toque1200(puerto, intentos) {
  for (let n = 1; n <= intentos; n++) {
    consolaLinea('Intento ' + n + ' de ' + intentos + ': abro el puerto a 1200 bps…', 'propio');
    try {
      await puerto.open({ baudRate: 1200 });
    } catch (e) {
      consolaLinea('  no he podido abrir el puerto: ' + ((e && e.message) || e) +
        '. ¿Lo tiene abierto otro programa (la app de Meshtastic, el monitor serie…)?', 'avisoConsola');
      await dormir(1500);
      continue;
    }
    await dormir(800);
    try {
      await puerto.setSignals({ dataTerminalReady: false, requestToSend: false });
      consolaLinea('  DTR soltado a propósito: es exactamente lo que espera el cargador.', 'propio');
    } catch (e) {
      consolaLinea('  este navegador no deja soltar DTR; cierro el puerto y confío en el sistema.', 'avisoConsola');
    }
    await dormir(200);
    try { await puerto.close(); } catch (e) { /* si la placa ya se reinició, cerrar puede fallar */ }
    await dormir(1500);
    if (await hayCargador()) {
      consolaLinea('  el cargador ha aparecido: el nodo está en modo grabación.', 'propio');
      return true;
    }
    consolaLinea('  todavía no ha aparecido; vuelvo a intentarlo.', 'propio');
  }
  return false;
}

// --- Protocolo serie de Meshtastic: lo mínimo para mandar una orden al nodo ---
// Trama: 0x94 0xC3, longitud (2 bytes, big-endian) y el mensaje ToRadio en protobuf.
function varint(n) {
  const b = [];
  let v = n >>> 0;
  while (v > 0x7f) { b.push((v & 0x7f) | 0x80); v >>>= 7; }
  b.push(v);
  return b;
}
function campoVarint(numero, valor) { return [...varint(numero << 3), ...varint(valor)]; }
function campoBytes(numero, bytes) { return [...varint((numero << 3) | 2), ...varint(bytes.length), ...bytes]; }
function marco(bytes) { return [0x94, 0xc3, (bytes.length >> 8) & 0xff, bytes.length & 0xff, ...bytes]; }
function leerVarint(b, i) { let r = 0, s = 0, x; do { x = b[i++]; r |= (x & 0x7f) << s; s += 7; } while (x & 0x80); return [r >>> 0, i]; }

// Del mensaje FromRadio saca my_info.my_node_num (campo 3 del FromRadio -> campo 1 del MyNodeInfo).
function buscarNumeroDeNodo(bytes) {
  let i = 0;
  while (i < bytes.length) {
    let tag; [tag, i] = leerVarint(bytes, i);
    const num = tag >>> 3, tipo = tag & 7;
    if (tipo === 0) { let v; [v, i] = leerVarint(bytes, i); continue; }
    if (tipo !== 2) break;
    let len; [len, i] = leerVarint(bytes, i);
    const cuerpo = bytes.slice(i, i + len);
    i += len;
    if (num === 3) { // my_info
      let j = 0;
      while (j < cuerpo.length) {
        let t2; [t2, j] = leerVarint(cuerpo, j);
        const n2 = t2 >>> 3, ti2 = t2 & 7;
        if (ti2 === 0) { let v2; [v2, j] = leerVarint(cuerpo, j); if (n2 === 1) return v2; }
        else if (ti2 === 2) { let l2; [l2, j] = leerVarint(cuerpo, j); j += l2; }
        else break;
      }
    }
  }
  return 0;
}

// Lee del puerto hasta encontrar el número de nodo (0 si no lo consigue).
async function leerNumeroDeNodo(puerto, ms) {
  const lector = puerto.readable.getReader();
  const escritor = puerto.writable.getWriter();
  let buffer = [];
  let nodo = 0;
  try {
    await escritor.write(new Uint8Array(marco(campoVarint(3, Math.floor(Math.random() * 0xfffffff) + 1))));
    const fin = Date.now() + ms;
    while (Date.now() < fin && !nodo) {
      const r = await Promise.race([lector.read(), dormir(300).then(() => null)]);
      if (!r) continue;
      if (r.done) break;
      if (r.value) for (const b of r.value) buffer.push(b);
      for (;;) {
        let i = -1;
        for (let k = 0; k + 1 < buffer.length; k++) if (buffer[k] === 0x94 && buffer[k + 1] === 0xc3) { i = k; break; }
        if (i < 0 || buffer.length < i + 4) { if (i > 0) buffer = buffer.slice(i); break; }
        const len = (buffer[i + 2] << 8) | buffer[i + 3];
        if (len > 4096) { buffer = buffer.slice(i + 1); continue; } // no es una trama de verdad
        if (buffer.length < i + 4 + len) { if (i > 0) buffer = buffer.slice(i); break; }
        const carga = buffer.slice(i + 4, i + 4 + len);
        buffer = buffer.slice(i + 4 + len);
        const n = buscarNumeroDeNodo(carga);
        if (n) { nodo = n; break; }
      }
      if (buffer.length > 8192) buffer = buffer.slice(-2048);
    }
  } catch (e) {
    consolaLinea('  (no he podido leer la respuesta del nodo: ' + ((e && e.message) || e) + ')', 'avisoConsola');
  } finally {
    try { escritor.releaseLock(); } catch (e) { /* da igual */ }
    try { await lector.cancel(); } catch (e) { /* da igual */ }
  }
  return nodo;
}

// Pide al nodo que entre en modo DFU. Es lo que hace el flasher oficial: AdminMessage campo 21
// (enter_dfu_mode_request) dentro de Data con portnum ADMIN_APP (6), dirigido AL PROPIO NODO
// (no a difusión), con hop_limit 0 para que no salga al aire. Antes se saluda para saber el
// número de nodo, porque la orden tiene que ir dirigida a él.
async function ordenarDFU(puerto) {
  await puerto.open({ baudRate: 115200 });
  try {
    const nodo = await leerNumeroDeNodo(puerto, 3000);
    consolaLinea(nodo
      ? '  nodo detectado: !' + nodo.toString(16).padStart(8, '0')
      : '  el nodo no ha respondido al saludo: o está dormido, o ese puerto es el del cargador ' +
        '(si es el cargador, la unidad de disco ya debería estar montada), o tiene el API por serie desactivado.', 'propio');
    const admin = campoVarint(21, 1);
    const datos = [...campoVarint(1, 6), ...campoBytes(2, admin)];
    const paquete = [
      ...campoVarint(2, nodo || 0xffffffff), // al propio nodo (o difusión si no lo sabemos)
      ...campoBytes(4, datos),               // decoded = Data{ portnum, payload }
      ...campoVarint(6, Math.floor(Math.random() * 0xfffffff) + 1), // id del paquete
      ...campoVarint(9, 0),                  // hop_limit = 0: no se retransmite
    ];
    const trama = marco(campoBytes(1, paquete)); // ToRadio{ packet }
    const escritor = puerto.writable.getWriter();
    try {
      await escritor.write(new Uint8Array(trama));
      consolaLinea('  orden "entrar en modo DFU" enviada (' + trama.length + ' bytes).', 'propio');
    } finally {
      try { escritor.releaseLock(); } catch (e) { /* da igual */ }
    }
    await dormir(1500);
  } finally {
    try { await puerto.close(); } catch (e) { /* el nodo puede estar reiniciándose */ }
  }
}

// Si el puerto del firmware ya no se puede abrir, es que el nodo se ha reiniciado.
async function puertoSigueVivo(puerto) {
  try {
    await puerto.open({ baudRate: 115200 });
    try { await puerto.close(); } catch (e) { /* da igual */ }
    return true;
  } catch (e) {
    return false;
  }
}

// Espera a que aparezca el cargador entre los puertos ya autorizados (pista, no prueba).
async function esperarCargador(segundos) {
  const fin = Date.now() + segundos * 1000;
  while (Date.now() < fin) {
    if (await hayCargador()) return true;
    await dormir(700);
  }
  return false;
}

async function modoGrabacionNRF52(s) {
  if (!soportaSerial) throw new Error('este navegador no puede mandar el nodo a modo grabación');
  progreso(10, 'Elige el puerto del nodo…');
  const puerto = await puertoElegido();
  const info = puerto.getInfo ? puerto.getInfo() : null;
  consolaLinea('Puerto elegido: ' + describirPuerto(puerto), 'propio');
  if (info && (info.usbVendorId === 0x303a || info.usbVendorId === 0x1a86 || info.usbVendorId === 0x10c4)) {
    consolaLinea('  aviso: ese puerto parece de una placa ESP32 o de un adaptador, no de un nRF52. ' +
      'Si has elegido el puerto equivocado, el toque no llegará al nodo.', 'avisoConsola');
  }
  progreso(35, 'Pidiendo al nodo que entre en modo grabación…');
  consolaEstado('Pidiendo al nodo que entre en modo grabación…');
  // Primero la orden de administración por el cable (como el flasher oficial): funciona en
  // cualquier nodo con firmware Meshtastic o NavaTastic y no depende del sistema operativo.
  // Si no basta, se prueba el toque de 1200 bps.
  let entro = false;
  try {
    await ordenarDFU(puerto);
    entro = await esperarCargador(4);
    consolaLinea(entro ? '  ha aparecido un puerto de cargador.' : '  con la orden no ha aparecido ningún cargador.', 'propio');
  } catch (e) {
    consolaLinea('  no he podido mandar la orden por el cable: ' + ((e && e.message) || e), 'avisoConsola');
  }
  // El toque se prueba SIEMPRE, aunque la orden parezca haber ido bien: es barato, es el camino
  // que trae el firmware de fábrica y, si el nodo ya estuviera en modo grabación, no estorba.
  consolaLinea(entro ? 'Refuerzo con el toque de 1200 bps.' : 'Pruebo el toque de 1200 bps.', 'propio');
  progreso(60, 'Probando el toque de 1200 bps…');
  if (await toque1200(puerto, 2)) entro = true;
  if (!entro) consolaLinea('Ni la orden ni el toque han surtido efecto: habrá que entrar en modo grabación a mano.', 'avisoConsola');
  progreso(80, entro ? 'Nodo en modo grabación.' : 'Descargando el fichero…');
  consolaEstado(entro ? 'Nodo en modo grabación' : 'Descargando el fichero');
  descargar();
  $('resultado').innerHTML = entro
    ? '<span class="ok">Nodo en modo grabación.</span> En tu ordenador: 1) busca la unidad nueva que ha aparecido; ' +
      '2) copia dentro el fichero <b>' + s.principal.nombre + '</b> (está en Descargas); 3) espera unos segundos: ' +
      'el nodo se reinicia solo y la unidad desaparece. Si no desaparece, <b>expúlsala</b> desde el sistema.'
    : '<span class="ok">Fichero descargado.</span> El nodo no ha entrado en modo grabación por sí solo. Prueba, en ' +
      'este orden: 1) <b>doble toque rápido al botón RESET</b> del nodo; 2) si no aparece la unidad, mantén pulsado ' +
      '<b>RESET</b> mientras conectas el cable y suéltalo al aparecer; 3) en última instancia, manda desde la app la ' +
      'orden de administración para entrar en modo DFU (el firmware la admite) o usa el cable con la utilidad de ' +
      'Nordic. Cuando aparezca la unidad, copia dentro el fichero <b>' + s.principal.nombre + '</b> (está en ' +
      'Descargas) y, si no desaparece sola, <b>expúlsala</b> desde el sistema.';
}

// ---------- descarga directa ----------
function descargar() {
  const s = seleccion();
  if (!s.principal) return;
  const a = document.createElement('a');
  a.href = s.principal.url;
  a.download = s.principal.nombre;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (s.extra) {
    // Se reemplaza la nota anterior en vez de acumular una por cada clic.
    const base = $('resultado').innerHTML.split('<br><span class="sub">')[0];
    $('resultado').innerHTML = base + '<br><span class="sub">Para actualizar sin cable (OTA) se usa el fichero <b>' +
      s.extra.nombre + '</b>, pero eso se hace desde la app oficial de Meshtastic, no desde aquí.</span>';
  }
}
