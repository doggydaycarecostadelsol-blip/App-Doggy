/* Doggy Day Care · lector del Excel ORIGINAL (hojas JULIO…DICIEMBRE, DB_CLIENTES, PAGOS, etc.).
 *
 * Convierte el libro en filas listas para Supabase con las mismas reglas que usaba la app antigua
 * (perros previstos por color verde, nombres ambiguos, filas 9 a 100, etc.).
 * Trabaja con un libro de ExcelJS: workbook.getWorksheet(nombre) → ws.getRow(n).getCell(c).
 *
 * Esta importación es TRANSITORIA: sirve para actualizar la app desde el Excel mientras se sigue
 * usando. Cuando la app esté asentada se sustituye por el formato de exportación.
 */
(function () {
  "use strict";

  var MESES_HOJA = ["JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
  var INDICE_MES = { JULIO: 6, AGOSTO: 7, SEPTIEMBRE: 8, OCTUBRE: 9, NOVIEMBRE: 10, DICIEMBRE: 11 };
  var PRIMERA_FILA = 9, ULTIMA_FILA = 100; // el mismo rango que leía la app antigua

  /* ---------- valores de celda ---------- */
  function desenvolver(v) {
    for (var i = 0; i < 3 && v && typeof v === "object" && !(v instanceof Date); i++) {
      if ("error" in v) return null;
      if ("result" in v) v = v.result;
      else if (v.richText) v = v.richText.map(function (t) { return t.text; }).join("");
      else if ("text" in v) v = v.text;
      else return null;
    }
    return v === undefined ? null : v;
  }
  function celda(ws, r, c) { return ws.getRow(r).getCell(c); }
  function val(ws, r, c) { return desenvolver(celda(ws, r, c).value); }
  function filas(ws, desde, ancho) {
    var out = [];
    for (var r = desde; r <= ws.rowCount; r++) {
      var f = [];
      for (var c = 1; c <= ancho; c++) f.push(val(ws, r, c));
      out.push(f);
    }
    return out;
  }
  function tablaConCabecera(ws) {
    var cab = [], c = 1;
    while (c <= ws.columnCount && val(ws, 1, c) !== null && val(ws, 1, c) !== "") { cab.push(String(val(ws, 1, c))); c++; }
    var out = [];
    for (var r = 2; r <= ws.rowCount; r++) {
      var d = {}, primero = null;
      for (var i = 0; i < cab.length; i++) { var v = val(ws, r, i + 1); d[cab[i]] = v; if (i === 0) primero = v; }
      if (primero !== null && primero !== "") out.push(d);
    }
    return out;
  }

  /* ---------- utilidades ---------- */
  function norm(n) { return String(n === null || n === undefined || n === 0 ? "" : n).replace(/\s+/g, " ").trim(); }
  function esNum(v) { return typeof v === "number" && isFinite(v); }
  function numOrNull(v) { return esNum(v) ? v : null; }
  function entOrNull(v) { return esNum(v) ? Math.trunc(v) : null; }
  function iso(d) { return d.toISOString(); }
  function soloFecha(v) { return v instanceof Date ? iso(v).slice(0, 10) : (v === undefined ? null : v); }
  function fechaHora(v) { return v instanceof Date ? iso(v).slice(0, 19).replace("T", " ") : (v === undefined ? null : v); }
  function vacioNull(v) { return v === "" || v === undefined ? null : v; }
  function uid(v, prefijo) { return v ? String(v).replace(prefijo, "") : null; }
  function chk(v) { return v === true || String(v).toUpperCase() === "TRUE"; }
  function lista(txt) {
    if (!txt) return null;
    var p = String(txt).split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    return p.length ? p : null;
  }
  function metodo(m) {
    var t = norm(String(m === null || m === undefined ? "" : m).replace(/[^\p{L}\p{N}_\s\/]/gu, ""));
    return t || null;
  }
  function sinSufijo(n) { return norm(n).replace(/(?:\s*\([IV]\))+\s*$/i, "").trim(); }
  function clave(n) { return sinSufijo(n).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
  function esVerde(c) {
    var f = c && c.fill, rgb = f && f.type === "pattern" && f.fgColor && f.fgColor.argb;
    if (typeof rgb !== "string" || rgb.length < 6) return false;
    var n = parseInt(rgb.slice(-6), 16);
    if (isNaN(n)) return false;
    var R = (n >> 16) & 255, G = (n >> 8) & 255, B = n & 255;
    return G >= R + 18 && G >= B + 12;
  }
  function dedupe(lst, campo) {
    var m = {};
    lst.forEach(function (x) { m[x[campo]] = x; });
    return Object.keys(m).map(function (k) { return m[k]; });
  }
  function sumarDias(fecha, n) { var d = new Date(fecha + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  /* ---------- lectura principal ---------- */
  function parsear(wb) {
    var avisos = [];
    function hoja(nombre, obligatoria) {
      var ws = wb.getWorksheet(nombre);
      if (!ws && obligatoria) throw new Error("Falta la hoja «" + nombre + "». ¿Es el Excel de producción?");
      return ws;
    }
    var out = {};

    // Servicios y precios (CONFIG, columnas G y H)
    var servicios = {};
    var wsCfg = hoja("CONFIG", true);
    for (var r = 2; r <= Math.min(80, wsCfg.rowCount); r++) {
      var nom = val(wsCfg, r, 7), precio = val(wsCfg, r, 8);
      if (nom && precio !== null) {
        var n = norm(nom); if (n === "Guareria") n = "Guarderia";
        servicios[n] = Number(precio);
      }
    }

    // Clientes
    var clientesIds = {};
    out.clientes = tablaConCabecera(hoja("DB_CLIENTES", true)).map(function (d) {
      var cid = uid(d.CLIENTE_ID, "CLI-"); clientesIds[cid] = true;
      return { id: cid, estado: d.ESTADO || "ACTIVO", origen: vacioNull(d.ORIGEN), fecha_alta: fechaHora(d.FECHA_ALTA),
        nombre_completo: d.NOMBRE_COMPLETO || "Sin nombre", tipo_documento: vacioNull(d.TIPO_DOCUMENTO),
        numero_documento: vacioNull(d.NUMERO_DOCUMENTO), telefono_whatsapp: vacioNull(d.TELEFONO_WHATSAPP),
        telefono_alternativo: vacioNull(d.TELEFONO_ALTERNATIVO), email: vacioNull(d.EMAIL), direccion: vacioNull(d.DIRECCION),
        codigo_postal: vacioNull(d.CODIGO_POSTAL), localidad: vacioNull(d.LOCALIDAD), idioma: vacioNull(d.IDIOMA),
        contacto_emergencia_nombre: vacioNull(d.CONTACTO_EMERGENCIA_NOMBRE),
        contacto_emergencia_telefono: vacioNull(d.CONTACTO_EMERGENCIA_TELEFONO),
        contacto_emergencia_relacion: vacioNull(d.CONTACTO_EMERGENCIA_RELACION),
        metodo_recogida: vacioNull(d.METODO_RECOGIDA), instrucciones_recogida: vacioNull(d.INSTRUCCIONES_RECOGIDA),
        nombre_config: norm(d.NOMBRE_CONFIG) || null };
    });
    out.clientes = dedupe(out.clientes, "id");

    // Perros
    var catalogo = [], mapaOperativo = {}, perros = [];
    tablaConCabecera(hoja("DB_PERROS", true)).forEach(function (d) {
      var pid = uid(d.PERRO_ID, "PER-"), cid = uid(d.CLIENTE_ID, "CLI-");
      if (!clientesIds[cid]) { avisos.push("Perro " + d.NOMBRE + ": su cliente no existe; se omite."); return; }
      var op = norm(d.NOMBRE_CONFIG || d.NOMBRE);
      mapaOperativo[op] = pid;
      catalogo.push([pid, norm(d.NOMBRE), op]);
      perros.push({ id: pid, cliente_id: cid, estado: d.ESTADO || "ACTIVO", fecha_alta: fechaHora(d.FECHA_ALTA),
        nombre: norm(d.NOMBRE), nombre_config: op, identificador: vacioNull(d.IDENTIFICADOR), sexo: vacioNull(d.SEXO),
        raza: vacioNull(d.RAZA), fecha_nacimiento: soloFecha(vacioNull(d.FECHA_NACIMIENTO)), microchip: vacioNull(d.MICROCHIP),
        esterilizado: vacioNull(d.ESTERILIZADO), peso_kg: numOrNull(d.PESO_KG), veterinario: vacioNull(d.VETERINARIO),
        telefono_veterinario: vacioNull(d.TELEFONO_VETERINARIO), alergias_intolerancias: vacioNull(d.ALERGIAS_INTOLERANCIAS),
        enfermedades_lesiones: vacioNull(d.ENFERMEDADES_LESIONES), medicacion: vacioNull(d.MEDICACION),
        miedos_reacciones: vacioNull(d.MIEDOS_REACCIONES), tendencia_escape: vacioNull(d.TENDENCIA_ESCAPE),
        comportamiento: vacioNull(d.COMPORTAMIENTO), celo_estado: vacioNull(d.CELO_ESTADO),
        celo_fecha_inicio: soloFecha(vacioNull(d.CELO_FECHA_INICIO)), foto_url: vacioNull(d.FOTO_URL),
        precio_interno: numOrNull(d.PRECIO_INTERNO), dias_contratados: lista(d.DIAS_CONTRATADOS),
        tipo_planificacion: vacioNull(d.TIPO_PLANIFICACION), ruta: entOrNull(d.RUTA), orden_ruta: entOrNull(d.ORDEN_RUTA),
        temporal: false, fecha_inicio_servicio: soloFecha(vacioNull(d.FECHA_INICIO_SERVICIO)),
        fecha_baja_servicio: soloFecha(vacioNull(d.FECHA_BAJA_SERVICIO)), observaciones: vacioNull(d.OBSERVACIONES) });
    });
    perros = dedupe(perros, "id");
    var perroPorId = {}; perros.forEach(function (p) { perroPorId[p.id] = p; });

    // RUTAS_APP manda sobre DB_PERROS (recorrido, orden y temporal)
    var wsRutas = hoja("RUTAS_APP", false);
    if (wsRutas) filas(wsRutas, 2, 4).forEach(function (f) {
      if (f[0] === null) return;
      var pid = mapaOperativo[norm(f[0])], p = pid && perroPorId[pid];
      if (!p) return;
      p.ruta = entOrNull(f[1]); p.orden_ruta = entOrNull(f[2]); p.temporal = !!f[3];
    });
    out.perros = perros;

    // Hotel y eventos
    var wsHotel = hoja("HOTEL_CLIENTES", false);
    out.hotel_clientes = wsHotel ? dedupe(filas(wsHotel, 2, 4).filter(function (f) { return f[0]; }).map(function (f) {
      return { perro: norm(f[0]), cliente: vacioNull(f[1]), telefono: vacioNull(f[2]), actualizado_en: fechaHora(f[3]) };
    }), "perro") : [];
    var wsEv = hoja("EVENTOS_APP", false);
    out.eventos = wsEv ? dedupe(filas(wsEv, 2, 9).filter(function (f) { return f[0]; }).map(function (f) {
      return { id: uid(f[0], "EV-"), tipo: vacioNull(f[1]), fecha: fechaHora(f[2]), titulo: vacioNull(f[3]),
        perro_o_persona: vacioNull(f[4]), notas: vacioNull(f[5]), repeticion: vacioNull(f[6]),
        creado_en: fechaHora(f[7]), actualizado_en: fechaHora(f[8]) };
    }), "id") : [];

    // Identidad de perros con la misma regla de ambigüedad que la app antigua
    var alias = {}, operativos = {}, IDENT = {}, AMBIGUOS = {};
    catalogo.forEach(function (c) {
      (alias[clave(c[1])] = alias[clave(c[1])] || {})[c[0]] = 1;
      (alias[clave(c[2])] = alias[clave(c[2])] || {})[c[0]] = 1;
      (operativos[clave(c[2])] = operativos[clave(c[2])] || {})[c[0]] = 1;
    });
    Object.keys(alias).forEach(function (k) {
      var opc = Object.keys(operativos[k] || alias[k]);
      if (opc.length === 1) IDENT[k] = opc[0]; else AMBIGUOS[k] = true;
    });
    function idPerro(nombre) { return IDENT[clave(nombre)] || null; }

    // Pagos (PAGOS + los cerrados que solo estén en CIERRES_PAGOS)
    var pagos = [], vistosPago = {};
    var wsPagos = hoja("PAGOS", true);
    filas(wsPagos, 7, 6).forEach(function (f) {
      if (f[1] !== null && f[2] !== null && esNum(f[3])) {
        var fecha = soloFecha(f[1]), nombre = norm(f[2]);
        pagos.push({ fecha: fecha, nombre: nombre, importe: Number(f[3]), caja: metodo(f[4]), cierre: vacioNull(f[5]) });
        vistosPago[fecha + "|" + nombre + "|" + Number(f[3])] = true;
      }
    });
    var wsCierres = hoja("CIERRES_PAGOS", false), extra = 0;
    if (wsCierres) filas(wsCierres, 2, 6).forEach(function (f) {
      if (f[1] === null || !esNum(f[3])) return;
      var fecha = soloFecha(f[1]), nombre = norm(f[2]), k = fecha + "|" + nombre + "|" + Number(f[3]);
      if (!vistosPago[k]) { pagos.push({ fecha: fecha, nombre: nombre, importe: Number(f[3]), caja: metodo(f[4]), cierre: vacioNull(f[5]) }); extra++; }
    });
    if (extra) avisos.push(extra + " pagos cerrados solo estaban en CIERRES_PAGOS; se incluyen.");

    // Gastos
    var gastos = [];
    var wsGastos = hoja("GASTOS", true);
    filas(wsGastos, 14, 12).forEach(function (f) {
      if (f[1] !== null && f[2] !== null && esNum(f[4])) {
        gastos.push({ fecha: soloFecha(f[1]), concepto: norm(f[2]), categoria: vacioNull(f[3]), importe: Number(f[4]),
          iva: !!f[5], metodo: metodo(f[6]), notas: vacioNull(f[7]), cierre_id: vacioNull(f[9]) });
      }
    });

    // Cierres de caja
    var cierres = {};
    pagos.forEach(function (p) {
      if (!p.cierre) return;
      var c = cierres[p.cierre] = cierres[p.cierre] || { persona: p.caja, fecha: p.fecha, total: 0 };
      c.total += p.importe; if (p.fecha > c.fecha) c.fecha = p.fecha;
    });
    gastos.forEach(function (g) {
      if (g.cierre_id && !cierres[g.cierre_id]) cierres[g.cierre_id] = { persona: g.metodo, fecha: g.fecha, total: null };
    });
    out.cierres_caja = Object.keys(cierres).sort().map(function (id) {
      var c = cierres[id];
      return { id: id, persona: c.persona || "Sin asignar", fecha: c.fecha, total: c.total === null ? null : Math.round(c.total * 100) / 100 };
    });

    var sinPerro = {};
    out.pagos = pagos.map(function (p) {
      var pid = idPerro(p.nombre);
      if (!pid) sinPerro[p.nombre] = (sinPerro[p.nombre] || 0) + 1;
      return { fecha: p.fecha, perro_id: pid, nombre_perro: p.nombre, importe: p.importe, caja: p.caja, cierre_id: p.cierre };
    });
    if (Object.keys(sinPerro).length) avisos.push("Pagos con nombre que no coincide con ningún perro (se guardan solo con el nombre): " +
      Object.keys(sinPerro).map(function (k) { return k + " (" + sinPerro[k] + ")"; }).join(", "));
    out.gastos = gastos;

    // Cajas personales
    var wsCajas = hoja("CAJA_PERSONAS_APP", false);
    out.cajas_personas_movimientos = wsCajas ? filas(wsCajas, 2, 6).filter(function (f) { return f[0] && f[1]; }).map(function (f) {
      return { fecha_hora: fechaHora(f[0]), persona: f[1], tipo: f[2], importe: f[3] || 0, notas: vacioNull(f[4]), id_solicitud: vacioNull(f[5]) };
    }) : [];

    // Cargos generados (BALANCE)
    var wsBal = hoja("BALANCE", true);
    out.cargos = [];
    filas(wsBal, 7, 5).forEach(function (f) {
      if (f[1] instanceof Date && f[2] && esNum(f[4])) {
        var nom2 = norm(f[2]);
        out.cargos.push({ fecha: soloFecha(f[1]), perro_id: idPerro(nom2), nombre_perro: nom2, servicio: norm(f[3]) || "Guarderia", cargo: Number(f[4]) });
      }
    });

    // Asistencia: hojas mensuales, bloques de 10 columnas por día
    var vistos = {}, asistencia = [], rango = {}, omitidas = {}, libres = {};
    MESES_HOJA.forEach(function (mes) {
      var ws = hoja(mes, true), cols = ws.columnCount, ultima = Math.min(ULTIMA_FILA, ws.rowCount);
      for (var r2 = PRIMERA_FILA; r2 <= ultima; r2++) {
        for (var g = 0; g < Math.floor((cols - 1) / 10); g++) {
          var o = 1 + 10 * g;                       // posición (base 0) de la columna FECHA
          if (cols <= o + 5) continue;
          var f = val(ws, r2, o + 1), nombreCrudo = val(ws, r2, o + 3);
          if (!(f instanceof Date) || typeof nombreCrudo !== "string" || !nombreCrudo.trim()) continue;
          var dia = iso(f).slice(0, 10);
          if (!rango[mes]) rango[mes] = [dia, dia];
          if (dia < rango[mes][0]) rango[mes][0] = dia;
          if (dia > rango[mes][1]) rango[mes][1] = dia;
          var nombre = norm(nombreCrudo), ok = chk(val(ws, r2, o + 2)), anad = chk(val(ws, r2, o + 5)), canc = chk(val(ws, r2, o + 6));
          if (AMBIGUOS[clave(nombre)] && !(ok || anad)) { omitidas[clave(nombre)] = (omitidas[clave(nombre)] || 0) + 1; continue; }
          var pid = idPerro(nombre);
          if (!pid) libres[nombre] = (libres[nombre] || 0) + 1;
          var serv = norm(val(ws, r2, o + 4)) || "Guarderia"; if (serv === "Guareria") serv = "Guarderia";
          var k = dia + "|" + (pid || nombre);
          if (vistos[k]) continue;
          vistos[k] = true;
          var previsto = esVerde(celda(ws, r2, o + 3));
          // Se guardan solo los días con información; el resto de perros se completa solo con el catálogo.
          if (previsto || ok || anad || canc || !pid) {
            asistencia.push({ fecha: dia, perro_id: pid, nombre_libre: pid ? null : nombre, servicio: serv,
              ok: ok, anadido: anad, cancelado: canc, previsto: previsto });
          }
        }
      }
    });
    out.asistencia = asistencia;
    if (Object.keys(omitidas).length) avisos.push("Filas antiguas con nombre ambiguo y sin asistencia (se omiten): " +
      Object.keys(omitidas).map(function (k) { return k + " (" + omitidas[k] + ")"; }).join(", "));

    // Servicios que aparecen en la asistencia pero no en CONFIG
    asistencia.forEach(function (a) { if (!(a.servicio in servicios)) { servicios[a.servicio] = 0; avisos.push("Servicio «" + a.servicio + "» no estaba en CONFIG; se crea con precio 0."); } });
    out.servicios = Object.keys(servicios).map(function (k) { return { nombre: k, precio: servicios[k] }; });

    // Periodos mensuales (cada mes acaba el día anterior al inicio del siguiente)
    out.periodos = MESES_HOJA.filter(function (m) { return rango[m]; }).map(function (m, i, arr) {
      var fin = i + 1 < arr.length ? sumarDias(rango[arr[i + 1]][0], -1) : rango[m][1];
      return { nombre: m.charAt(0) + m.slice(1).toLowerCase(), indice: INDICE_MES[m], inicio: rango[m][0], fin: fin };
    });

    var resumen = {};
    Object.keys(out).forEach(function (k) { resumen[k] = out[k].length; });
    return { payload: out, resumen: resumen, avisos: Array.from(new Set(avisos)) };
  }

  window.DoggyExcelOriginal = { parsear: parsear, _test: { esVerde: esVerde, desenvolver: desenvolver, metodo: metodo, clave: clave } };
})();
