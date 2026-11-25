/* Doggy Day Care · funciones de asistencia que faltaban en la capa Supabase:
 *   - actualizarServicioAsistenciaDiaApp  (cambiar el servicio de un perro en «Perros de hoy»)
 *   - actualizarServicioGeneradoApp       (cambiar el servicio desde el detalle de «generado»)
 *   - comprobarFechasProgramacionAsistenciaApp / programarAsistenciasMultiplesApp (Programar asistencia)
 *   - guardarTransporteHotelApp / guardarTransporteHotelHabitualApp (hotel y transporte)
 * Se apoyan en guardarAsistenciaApp (supabase-shim.js), que ya mantiene asistencia y cargos.
 */
(function () {
  "use strict";
  var B = window.DoggyBackend, C = window.DoggyCore;
  if (!B || !C) return;
  var sb = C.sb, norm = C.norm, sinSufijo = C.sinSufijo, comprobar = C.comprobar;

  var CORTESIA = "Guardería de cortesía";

  function cargarBase() {
    return C.asegurarSesion().then(function () {
      return Promise.all([C.cargarCatalogo(), sb.from("servicios").select("nombre,precio").eq("activo", true)]);
    }).then(function (r) { return { cat: r[0], servicios: comprobar(r[1]) || [] }; });
  }

  function servicioValido(nombre, pre) {
    var k = norm(nombre);
    if (k === norm(CORTESIA)) return CORTESIA;
    for (var i = 0; i < pre.servicios.length; i++) if (norm(pre.servicios[i].nombre) === k) return pre.servicios[i].nombre;
    return "";
  }

  function validarServicioFecha(servicio, iso, pre) {
    var sv = servicioValido(servicio, pre);
    if (!sv) return "Selecciona un servicio válido.";
    if (norm(sv) === "guarderia promo tina" && iso < "2026-11-02")
      return "Guarderia Promo Tina solo está disponible desde el 02/11/2026.";
    return "";
  }

  /* Localiza al perro: ficha (perro registrado) o nombre libre (hotel/transporte puntual). */
  function resolverPerro(texto, perroId, cat) {
    var t = String(texto || "").trim();
    if (perroId) {
      var f = cat.porId[perroId];
      if (!f) throw new Error("El perro seleccionado ya no existe. Actualiza la lista.");
      return { ficha: f, nombreLibre: null };
    }
    if (!t) throw new Error("No se ha indicado el perro.");
    var k = norm(sinSufijo(t));
    if (cat.ambiguos[k]) throw new Error('El nombre "' + t + '" corresponde a varios perros. Selecciona su nombre completo.');
    var ficha = cat.porNombre[k] || null;
    return { ficha: ficha, nombreLibre: ficha ? null : t };
  }

  function filaAsistencia(iso, id) {
    var q = sb.from("asistencia").select("id,servicio,ok,anadido,cancelado,previsto").eq("fecha", iso);
    q = id.ficha ? q.eq("perro_id", id.ficha.perroId) : q.eq("nombre_libre", id.nombreLibre);
    return q.limit(1).then(function (r) { return (comprobar(r) || [])[0] || null; });
  }
  function activa(f) { return !!f && !f.cancelado && (!!f.previsto || !!f.ok || !!f.anadido); }

  function fechaValida(iso) {
    var d = C.deIso(iso);
    if (!d) throw new Error("La fecha seleccionada no es válida.");
    return d;
  }

  /* ---------- cambiar servicio de un perro ya en la lista ---------- */
  function cambiarServicio(s) {
    if (!s || typeof s !== "object") return Promise.reject(new Error("No se han recibido datos."));
    var iso;
    try { iso = C.aIso(fechaValida(s.fechaIso)); } catch (e) { return Promise.reject(e); }
    return cargarBase().then(function (pre) {
      var id = resolverPerro(s.perro, s.perroId, pre.cat);
      var err = validarServicioFecha(s.servicio, iso, pre);
      if (err) throw new Error(err);
      var servicio = servicioValido(s.servicio, pre);
      return filaAsistencia(iso, id).then(function (fila) {
        if (!fila) {
          // No estaba en la lista de ese día: se añade con el servicio elegido.
          return B.guardarAsistenciaApp({ accion: "anadir", fechaIso: iso, perro: s.perro, perroId: s.perroId || "", servicio: servicio }, pre);
        }
        if (fila.ok) {
          // Ya recogido (tiene cargo): se guarda de nuevo con el servicio nuevo para recalcular el importe.
          return B.guardarAsistenciaApp({
            accion: "confirmar", fechaIso: iso,
            perro: s.perro, perroId: s.perroId || "", servicio: servicio
          }, pre);
        }
        // Previsto o añadido sin recoger (sin cargo): basta con cambiar el servicio.
        return sb.from("asistencia").update({ servicio: servicio, actualizado_en: new Date().toISOString() })
          .eq("id", fila.id).then(function (u) {
            comprobar(u);
            return { correcto: true, accion: "servicio", perro: s.perro, fechaIso: iso, servicio: servicio };
          });
      });
    });
  }
  B.actualizarServicioAsistenciaDiaApp = cambiarServicio;
  B.actualizarServicioGeneradoApp = cambiarServicio;

  /* ---------- programar asistencia ---------- */
  B.comprobarFechasProgramacionAsistenciaApp = function (s) {
    var fechas = (s && Array.isArray(s.fechas) ? s.fechas : []).filter(Boolean);
    return cargarBase().then(function (pre) {
      var id = resolverPerro(s.perro, s.perroId, pre.cat);
      return Promise.all(fechas.map(function (iso) {
        var d = C.deIso(iso);
        if (!d) return { fechaIso: iso, fechaTexto: iso, incluido: false, valido: false, mensaje: "Fecha no válida." };
        return filaAsistencia(iso, id).then(function (f) {
          return { fechaIso: iso, fechaTexto: C.textoFecha(d), incluido: activa(f), valido: true };
        });
      }));
    }).then(function (estados) { return { estados: estados }; });
  };

  /* Lista de {iso, servicio, etiqueta} a partir de las programaciones del formulario. */
  function expandir(programaciones) {
    var out = [];
    programaciones.forEach(function (p) {
      if (p.fechaIda || p.fechaVuelta) {
        if (p.fechaIda) out.push({ iso: p.fechaIda, servicio: p.servicio, etiqueta: "ida" });
        if (p.fechaVuelta) out.push({ iso: p.fechaVuelta, servicio: p.servicio, etiqueta: "vuelta" });
      } else {
        out.push({ iso: p.fechaIso, servicio: p.servicio, etiqueta: "" });
      }
    });
    return out;
  }

  B.programarAsistenciasMultiplesApp = function (s) {
    if (!s || !Array.isArray(s.programaciones) || !s.programaciones.length)
      return Promise.reject(new Error("No hay fechas que guardar."));
    if (s.programaciones.length > 60) return Promise.reject(new Error("Hay demasiadas fechas en una sola operación."));
    var items = expandir(s.programaciones);
    return cargarBase().then(function (pre) {
      var id = resolverPerro(s.perro, s.perroId, pre.cat);
      var errores = [];
      items.forEach(function (it) {
        if (!C.deIso(it.iso)) { errores.push({ mensaje: "La fecha " + it.iso + " no es válida." }); return; }
        var e = validarServicioFecha(it.servicio, it.iso, pre);
        if (e) errores.push({ mensaje: e });
      });
      if (errores.length) return { correcto: false, errores: errores };
      // Se comprueba todo antes de guardar nada, para no dejar la programación a medias.
      return Promise.all(items.map(function (it) { return filaAsistencia(it.iso, id); })).then(function (filas) {
        filas.forEach(function (f, i) {
          if (activa(f)) errores.push({ mensaje: "Ya está en la lista el " + C.textoFecha(C.deIso(items[i].iso)) + "." });
        });
        if (errores.length) return { correcto: false, errores: errores };
        var p = Promise.resolve();
        items.forEach(function (it) {
          p = p.then(function () {
            return B.guardarAsistenciaApp({
              accion: "anadir", fechaIso: it.iso, perro: s.perro, perroId: s.perroId || "", servicio: it.servicio,
              movimiento: it.etiqueta === "ida" ? "I" : (it.etiqueta === "vuelta" ? "V" : "")
            }, pre);
          });
        });
        return p.then(function () { return { correcto: true, total: items.length }; });
      });
    });
  };

  /* ---------- hotel y transporte ---------- */
  function guardarHotel(s, habitual) {
    if (!s || !String(s.perro || "").trim()) return Promise.reject(new Error("No se ha indicado el perro."));
    if (!s.fechaIda && !s.fechaVuelta) return Promise.reject(new Error("Selecciona al menos la ida o la vuelta."));
    if (s.fechaIda && s.fechaVuelta && s.fechaVuelta < s.fechaIda)
      return Promise.reject(new Error("La vuelta no puede ser anterior a la ida."));
    var hoy = C.aIso(new Date());
    var perro = String(s.perro).trim();
    return cargarBase().then(function (pre) {
      var fechas = [["ida", s.fechaIda], ["vuelta", s.fechaVuelta]].filter(function (x) { return x[1]; });
      for (var i = 0; i < fechas.length; i++) {
        if (!C.deIso(fechas[i][1])) throw new Error("La fecha de " + fechas[i][0] + " no es válida.");
        var e = validarServicioFecha(s.servicio, fechas[i][1], pre);
        if (e) throw new Error(e);
      }
      var previo = Promise.resolve();
      if (!habitual) {
        // Cliente de hotel/transporte puntual: se recuerda para la lista de puntuales.
        previo = sb.from("hotel_clientes").upsert({
          perro: perro, cliente: String(s.cliente || perro).trim(),
          telefono: String(s.telefono || "").trim() || null, actualizado_en: new Date().toISOString()
        }, { onConflict: "perro" }).then(comprobar);
      }
      var res = { correcto: true, perro: perro, servicio: s.servicio };
      var p = previo;
      fechas.forEach(function (x) {
        p = p.then(function () {
          var acc = norm(s.accion) === "confirmar" && x[1] <= hoy ? "confirmar" : "anadir";
          return B.guardarAsistenciaApp({ accion: acc, fechaIso: x[1], perro: perro, servicio: s.servicio, movimiento: x[0] === "ida" ? "I" : "V" }, pre);
        }).then(function (r) { res[x[0]] = { fechaIso: x[1], fechaTexto: r.fechaTexto }; });
      });
      return p.then(function () { return res; });
    });
  }
  B.guardarTransporteHotelApp = function (s) { return guardarHotel(s, !!(s && s.perroHabitual)); };
  B.guardarTransporteHotelHabitualApp = function (s) { return guardarHotel(s, true); };
})();
