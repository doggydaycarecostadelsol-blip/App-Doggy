/* Doggy Day Care · exportar a Excel e importar desde Excel.
 *
 * Exportar: crea un .xlsx con una hoja por tabla.
 * Importar (detecta el formato solo):
 *   · Excel exportado por la app → AÑADE o ACTUALIZA filas por "id". Nunca borra.
 *   · Excel original de producción (transitorio) → ver excel-original.js: actualiza la app con él.
 */
(function () {
  "use strict";

  // Orden pensado para respetar las relaciones entre tablas al importar.
  var TABLAS = [
    { t: "clientes", clave: "id", orden: "id" },
    { t: "perros", clave: "id", orden: "id", listas: ["dias_contratados"] },
    { t: "servicios", clave: "nombre", orden: "nombre" },
    { t: "periodos", clave: "nombre", orden: "indice", dias: ["inicio", "fin"] },
    { t: "categorias_gasto", clave: "nombre", orden: "orden" },
    { t: "hotel_clientes", clave: "perro", orden: "perro" },
    { t: "cierres_caja", clave: "id", orden: "id", dias: ["fecha"] },
    { t: "asistencia", clave: "id", orden: "id", dias: ["fecha"] },
    { t: "cargos", clave: "id", orden: "id", dias: ["fecha"] },
    { t: "pagos", clave: "id", orden: "id", dias: ["fecha"] },
    { t: "gastos", clave: "id", orden: "id", dias: ["fecha"] },
    { t: "cajas_personas_movimientos", clave: "id", orden: "id", ignorar: ["num"] },
    { t: "eventos", clave: "id", orden: "id" },
    { t: "cambios_plan", clave: "id", orden: "id", dias: ["fecha_efecto"],
      listas: ["dias_anteriores", "dias_nuevos"], json: ["detalle"] }
  ];
  var LOTE = 400;

  /* ---------- conversión de filas ---------- */
  function paraExcel(fila) {
    var o = {};
    Object.keys(fila).forEach(function (k) {
      var v = fila[k];
      if (Array.isArray(v)) v = v.join(",");
      else if (v !== null && typeof v === "object") v = JSON.stringify(v);
      o[k] = v;
    });
    return o;
  }
  function serialAFecha(n, conHora) {
    var ms = Math.round((n - 25569) * 86400 * 1000);
    var iso = new Date(ms).toISOString();
    return conHora ? iso : iso.slice(0, 10);
  }
  function limpiarFilas(tabla, filas) {
    var ignorar = tabla.ignorar || [], listas = tabla.listas || [], json = tabla.json || [], dias = tabla.dias || [];
    var out = [];
    filas.forEach(function (f) {
      var o = {}, hayDato = false;
      Object.keys(f).forEach(function (k0) {
        var k = String(k0).trim();
        if (!k || ignorar.indexOf(k) >= 0) return;
        var v = f[k0];
        if (typeof v === "string") { v = v.trim(); if (v === "") v = null; }
        if (v === undefined) v = null;
        if (v !== null) {
          hayDato = true;
          if (listas.indexOf(k) >= 0) v = String(v).split(",").map(function (x) { return x.trim(); }).filter(Boolean);
          else if (json.indexOf(k) >= 0 && typeof v === "string") { try { v = JSON.parse(v); } catch (e) { /* se deja como texto */ } }
          else if (typeof v === "number" && v > 20000 && v < 80000 && (dias.indexOf(k) >= 0)) v = serialAFecha(v, false);
          else if (typeof v === "number" && v > 20000 && v < 80000 && /(^fecha|_en$|^creado|^actualizado)/.test(k) && dias.indexOf(k) < 0 && k !== "importe") v = serialAFecha(v, true);
        }
        o[k] = v;
      });
      if (hayDato) out.push(o);
    });
    // Las columnas totalmente vacías se omiten para que la base use sus valores por defecto.
    if (out.length) {
      Object.keys(out[0]).forEach(function (k) {
        if (out.every(function (r) { return r[k] === null || r[k] === undefined; })) out.forEach(function (r) { delete r[k]; });
      });
    }
    return out;
  }

  /* ---------- acceso a la base ---------- */
  function core() { return window.DoggyCore; }
  function leerTodo(tabla) {
    var C = core(), out = [];
    function pagina(desde) {
      return C.sb.from(tabla.t).select("*").order(tabla.orden).range(desde, desde + 999).then(function (r) {
        var d = C.comprobar(r) || [];
        out = out.concat(d);
        return d.length === 1000 ? pagina(desde + 1000) : out;
      });
    }
    return pagina(0);
  }
  function subirTabla(tabla, filas) {
    var C = core(), conClave = [], sinId = [];
    filas.forEach(function (f) {
      if (tabla.clave === "id" && (f.id === null || f.id === undefined)) { var c = Object.assign({}, f); delete c.id; sinId.push(c); }
      else conClave.push(f);
    });
    function enLotes(lista, op) {
      var p = Promise.resolve();
      for (var i = 0; i < lista.length; i += LOTE) (function (lote) { p = p.then(function () { return op(lote); }); })(lista.slice(i, i + LOTE));
      return p;
    }
    return enLotes(conClave, function (lote) {
      return C.sb.from(tabla.t).upsert(lote, { onConflict: tabla.clave }).then(C.comprobar);
    }).then(function () {
      return enLotes(sinId, function (lote) { return C.sb.from(tabla.t).insert(lote).then(C.comprobar); });
    });
  }

  /* ---------- interfaz ---------- */
  function estado(titulo, detalle) {
    var a = document.getElementById("doggyBackupEstado"), b = document.getElementById("doggyBackupFecha");
    if (a && titulo !== null) a.textContent = titulo;
    if (b && detalle !== null) b.textContent = detalle;
  }
  function bloquear(si) {
    ["doggyExportarExcel", "doggyImportarExcel"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = si;
    });
  }
  function hoyTexto() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function hayLibreria() {
    if (window.XLSX) return true;
    estado("No se pudo cargar Excel", "Comprueba la conexión y recarga la página.");
    return false;
  }

  // Crea y descarga el Excel con los datos actuales. Devuelve una promesa con el nombre y las filas.
  function generarExcel() {
    return core().asegurarSesion().then(function () {
      var libro = window.XLSX.utils.book_new(), total = 0;
      var p = Promise.resolve();
      TABLAS.forEach(function (tabla) {
        p = p.then(function () {
          estado(null, "Leyendo " + tabla.t + "…");
          return leerTodo(tabla).then(function (filas) {
            if (!filas.length) return;
            total += filas.length;
            window.XLSX.utils.book_append_sheet(libro, window.XLSX.utils.json_to_sheet(filas.map(paraExcel)), tabla.t);
          });
        });
      });
      return p.then(function () {
        var nombre = "DoggyDayCare_" + hoyTexto() + ".xlsx";
        window.XLSX.writeFile(libro, nombre);
        return { nombre: nombre, filas: total };
      });
    });
  }

  function exportar() {
    if (!hayLibreria()) return;
    bloquear(true);
    estado("Exportando…", "Preparando el archivo Excel");
    generarExcel().then(function (r) {
      estado("Excel exportado", r.nombre + " · " + r.filas + " filas");
    }).catch(function (e) {
      estado("No se pudo exportar", e && e.message ? e.message : "Error desconocido");
    }).then(function () { bloquear(false); });
  }

  /* ----- Formato de exportación de la app (una hoja por tabla) ----- */
  function importarFormatoApp(buf, nombreArchivo) {
    var libro = window.XLSX.read(buf, { type: "array" });
    var plan = [], ignoradas = [];
    libro.SheetNames.forEach(function (n) {
      if (!TABLAS.some(function (t) { return t.t === n; })) ignoradas.push(n);
    });
    TABLAS.forEach(function (tabla) {
      var hoja = libro.Sheets[tabla.t];
      if (!hoja) return;
      var filas = limpiarFilas(tabla, window.XLSX.utils.sheet_to_json(hoja, { defval: null, raw: true }));
      if (filas.length) plan.push({ tabla: tabla, filas: filas });
    });
    if (!plan.length) throw new Error("El archivo no tiene hojas con datos reconocibles.");
    var resumen = plan.map(function (x) { return "• " + x.tabla.t + ": " + x.filas.length + " filas"; }).join("\n");
    var aviso = ignoradas.length ? "\n\nSe ignorarán estas hojas: " + ignoradas.join(", ") : "";
    var ok = window.confirm("Se añadirán o actualizarán estos datos:\n\n" + resumen + aviso +
      "\n\nNo se borra nada. Las filas que ya existan (mismo id) se sobrescriben.\n\n¿Importar ahora?");
    if (!ok) { estado("Importación cancelada", "No se ha cambiado nada."); return null; }
    return core().asegurarSesion().then(function () {
      var p = Promise.resolve(), hechas = 0;
      plan.forEach(function (x) {
        p = p.then(function () {
          estado("Importando…", x.tabla.t + " (" + x.filas.length + " filas)");
          return subirTabla(x.tabla, x.filas).catch(function (e) {
            throw new Error("Falló la hoja «" + x.tabla.t + "»: " + (e && e.message ? e.message : e) +
              (hechas ? " (las hojas anteriores sí se importaron)" : ""));
          }).then(function () { hechas++; });
        });
      });
      return p.then(function () {
        estado("Importación terminada", hechas + " hojas importadas. Recargando…");
        window.setTimeout(function () { window.location.reload(); }, 1500);
      });
    });
  }

  /* ----- Formato del Excel ORIGINAL de producción (transitorio) ----- */
  function cargarExcelJS() {
    if (window.ExcelJS) return Promise.resolve();
    return new Promise(function (ok, ko) {
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
      s.onload = ok;
      s.onerror = function () { ko(new Error("No se pudo cargar el lector de Excel. Comprueba la conexión.")); };
      document.head.appendChild(s);
    });
  }
  function importarFormatoOriginal(buf) {
    estado("Leyendo el Excel original…", "Puede tardar un minuto; no cierres la página.");
    return cargarExcelJS().then(function () {
      var libro = new window.ExcelJS.Workbook();
      return libro.xlsx.load(buf).then(function () { return libro; });
    }).then(function (libro) {
      var r = window.DoggyExcelOriginal.parsear(libro), c = r.resumen;
      var texto = "EXCEL ORIGINAL DE PRODUCCIÓN\n\n" +
        "Se SUSTITUIRÁN por los del Excel:\n" +
        "• asistencia (" + c.asistencia + " filas), cargos (" + c.cargos + "), pagos (" + c.pagos + "),\n" +
        "  gastos (" + c.gastos + "), cierres (" + c.cierres_caja + ") y cajas personales (" + c.cajas_personas_movimientos + ")\n\n" +
        "Se ACTUALIZARÁN, sin borrar nada:\n" +
        "• clientes (" + c.clientes + "), perros (" + c.perros + "), servicios, periodos, hotel y eventos\n\n" +
        "Lo que se haya anotado SOLO en la app y no esté en el Excel se perderá.\n" +
        "Antes se descargará una copia en Excel de los datos actuales.\n" +
        (r.avisos.length ? "\nAvisos:\n- " + r.avisos.join("\n- ").slice(0, 600) + "\n" : "") +
        "\n¿Continuar?";
      if (!window.confirm(texto)) { estado("Importación cancelada", "No se ha cambiado nada."); return null; }
      estado("Copia de seguridad…", "Descargando una copia de los datos actuales");
      return generarExcel().then(function () {
        estado("Importando…", "Cargando los datos en Supabase");
        return core().sb.rpc("importar_original", { p: r.payload });
      }).then(function (res) {
        if (res.error) {
          var m = res.error.message || "Error de base de datos.";
          if (/importar_original|schema cache|Could not find/i.test(m))
            m = "Falta crear la función en Supabase: ejecuta db/funcion_importar_original.sql en el SQL Editor. (" + m + ")";
          throw new Error(m);
        }
        estado("Importación terminada", "Datos actualizados desde el Excel. Recargando…");
        window.setTimeout(function () { window.location.reload(); }, 1800);
      });
    });
  }

  function importar(archivo) {
    if (!archivo || !hayLibreria()) return;
    bloquear(true);
    estado("Leyendo Excel…", archivo.name);
    archivo.arrayBuffer().then(function (buf) {
      var nombres = window.XLSX.read(buf, { type: "array", bookSheets: true }).SheetNames || [];
      var esOriginal = nombres.indexOf("DB_CLIENTES") >= 0 && nombres.indexOf("DB_PERROS") >= 0;
      return esOriginal ? importarFormatoOriginal(buf) : importarFormatoApp(buf, archivo.name);
    }).catch(function (e) {
      estado("No se pudo importar", e && e.message ? e.message : "Error desconocido");
    }).then(function () { bloquear(false); });
  }

  function iniciar() {
    var exp = document.getElementById("doggyExportarExcel"), imp = document.getElementById("doggyImportarExcel"),
      fich = document.getElementById("doggyArchivoExcel");
    if (!exp || !imp || !fich) return;
    exp.addEventListener("click", exportar);
    imp.addEventListener("click", function () { fich.value = ""; fich.click(); });
    fich.addEventListener("change", function () { importar(fich.files && fich.files[0]); });
  }
  document.addEventListener("DOMContentLoaded", iniciar);
  window.DoggyExcel = { _test: { limpiarFilas: limpiarFilas, paraExcel: paraExcel, TABLAS: TABLAS } };
})();
