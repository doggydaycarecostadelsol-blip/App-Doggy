/* Doggy Day Care · capa de compatibilidad con Supabase.
 *
 * La interfaz original llamaba a google.script.run.<funcion>(...).
 * Aquí se define el mismo "google.script.run", pero cada función
 * lee y escribe en Supabase. Así la pantalla no cambia.
 * Las funciones aún no migradas devuelven un error claro.
 */
(function () {
  "use strict";
  var cfg = window.DOGGY_CONFIG || {};
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  /* ---------- utilidades ---------- */
  function norm(t) {
    return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/\s+/g, " ").trim();
  }
  function sinSufijo(n) {
    return String(n || "").replace(/(?:\s*\([IV]\))+\s*$/i, "").trim();
  }
  function sufijoDe(n) {
    var m = String(n || "").match(/(?:\s*\([IV]\))+\s*$/i);
    return m ? m[0] : "";
  }
  function dosDig(n) { return (n < 10 ? "0" : "") + n; }
  function aIso(d) {
    return d.getFullYear() + "-" + dosDig(d.getMonth() + 1) + "-" + dosDig(d.getDate());
  }
  function deIso(s) {
    var m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }
  function textoFecha(d) {
    return dosDig(d.getDate()) + "/" + dosDig(d.getMonth() + 1) + "/" + d.getFullYear();
  }
  function ultimoDiaLaborable() {
    var d = new Date();
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    return d;
  }
  function esNombreHotelOculto(n) { return norm(n).indexOf("hotel") === 0; }
  function esTemporal(n) {
    var t = norm(sinSufijo(n));
    return t.indexOf("hotel ") === 0 || t.indexOf("transporte 40 ") === 0;
  }
  function comprobar(res) {
    if (res.error) throw new Error(res.error.message || "Error de base de datos.");
    return res.data;
  }

  /* ---------- sesión ---------- */
  var sesionLista = null;
  function asegurarSesion() {
    if (sesionLista) return sesionLista;
    sesionLista = sb.auth.getSession().then(function (r) {
      if (r.data && r.data.session) return r.data.session;
      return pedirLogin();
    }).catch(function (e) {
      sesionLista = null; // un fallo (p. ej. sin conexión) no debe quedarse guardado para siempre
      throw e;
    });
    return sesionLista;
  }
  // Si la sesión se cierra (aquí o en otra pestaña), la siguiente operación vuelve a pedir el acceso.
  sb.auth.onAuthStateChange(function (evento) {
    if (evento === "SIGNED_OUT") sesionLista = null;
  });
  function cerrarSesion() {
    return sb.auth.signOut().then(function () { sesionLista = null; window.location.reload(); });
  }
  function pedirLogin() {
    return new Promise(function (resolver) {
      var cap = document.createElement("div");
      cap.style.cssText = "position:fixed;inset:0;z-index:99999;background:#050b18;" +
        "display:flex;align-items:center;justify-content:center;padding:24px;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;";
      cap.innerHTML =
        '<form style="width:100%;max-width:340px;display:grid;gap:12px;color:#fff">' +
        '<div style="font-size:22px;font-weight:800;letter-spacing:.5px">DOGGY DAY CARE</div>' +
        '<input name="email" type="email" placeholder="Correo" autocomplete="username" required ' +
        'style="padding:14px;border-radius:12px;border:1px solid #2a3a55;background:#0b1830;color:#fff;font-size:16px">' +
        '<input name="clave" type="password" placeholder="Contraseña" autocomplete="current-password" required ' +
        'style="padding:14px;border-radius:12px;border:1px solid #2a3a55;background:#0b1830;color:#fff;font-size:16px">' +
        '<button type="submit" style="padding:14px;border-radius:12px;border:0;background:#6aa84f;color:#fff;font-size:16px;font-weight:800">Entrar</button>' +
        '<div data-error style="color:#ff8a8a;font-size:14px;min-height:18px"></div></form>';
      document.body.appendChild(cap);
      cap.querySelector("form").addEventListener("submit", function (ev) {
        ev.preventDefault();
        var f = ev.target;
        var boton = f.querySelector("button[type=submit]");
        var aviso = cap.querySelector("[data-error]");
        boton.disabled = true;
        aviso.textContent = "";
        sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.clave.value })
          .then(function (r) {
            if (r.error) {
              aviso.textContent = "Correo o contraseña incorrectos.";
              boton.disabled = false;
              return;
            }
            cap.remove();
            resolver(r.data.session);
          })
          .catch(function () {
            aviso.textContent = "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.";
            boton.disabled = false;
          });
      });
    });
  }

  /* ---------- catálogo de perros (identidad) ---------- */
  function cargarCatalogo() {
    return sb.from("perros")
      .select("id,nombre,nombre_config,estado,ruta,orden_ruta,temporal,precio_interno,fecha_baja_servicio")
      .range(0, 999).then(function (res) {
        var filas = comprobar(res) || [];
        var cat = { porId: {}, porNombre: {}, ambiguos: {}, activos: [] };
        var alias = {};
        filas.forEach(function (p) {
          var f = {
            perroId: p.id, nombre: p.nombre,
            nombreMostrar: p.nombre_config || p.nombre,
            estado: (norm(p.estado) === "activo" && p.fecha_baja_servicio && p.fecha_baja_servicio <= aIso(new Date())) ? "inactivo" : norm(p.estado), ruta: p.ruta || 0, orden: p.orden_ruta || 0,
            temporal: !!p.temporal, precio: p.precio_interno
          };
          cat.porId[f.perroId] = f;
          if (f.estado !== "inactivo") cat.activos.push(f);
          [f.nombre, f.nombreMostrar].forEach(function (n) {
            var k = norm(sinSufijo(n));
            if (!k) return;
            alias[k] = alias[k] || {};
            alias[k][f.perroId] = f;
          });
        });
        Object.keys(alias).forEach(function (k) {
          // Un nombre operativo exacto tiene prioridad sobre un alias abreviado.
          var exactos = Object.keys(alias[k]).map(function (i) { return alias[k][i]; })
            .filter(function (f) { return norm(sinSufijo(f.nombreMostrar)) === k; });
          var ops = exactos.length ? exactos : Object.keys(alias[k]).map(function (i) { return alias[k][i]; });
          if (ops.length === 1) cat.porNombre[k] = ops[0];
          else cat.ambiguos[k] = true;
        });
        return cat;
      });
  }
  function identidad(nombre, cat) {
    var t = String(nombre || "").trim();
    var ficha = cat.porNombre[norm(sinSufijo(t))];
    if (!ficha) return { perroId: "", nombreMostrar: t, ficha: null };
    return { perroId: ficha.perroId, nombreMostrar: ficha.nombreMostrar + sufijoDe(t), ficha: ficha };
  }

  /* ---------- funciones del backend ---------- */
  var backend = {};

  backend.obtenerListadoPerrosAsistenciaApp = function (fechaIso) {
    var fecha = fechaIso ? deIso(fechaIso) : ultimoDiaLaborable();
    if (!fecha) return Promise.reject(new Error("La fecha seleccionada no es válida."));
    var iso = aIso(fecha);
    return asegurarSesion().then(function () {
      return Promise.all([
        cargarCatalogo(),
        sb.from("asistencia")
          .select("perro_id,nombre_libre,servicio,ok,anadido,cancelado,previsto,movimiento")
          .eq("fecha", iso).range(0, 999).then(function (res) {
            // Si aún no existe la columna «movimiento» (falta ejecutar el SQL), se lee sin ella.
            if (res && res.error) return sb.from("asistencia")
              .select("perro_id,nombre_libre,servicio,ok,anadido,cancelado,previsto")
              .eq("fecha", iso).range(0, 999);
            return res;
          }),
        sb.from("hotel_clientes").select("perro,cliente,telefono")
      ]);
    }).then(function (r) {
      var cat = r[0], filas = comprobar(r[1]) || [], hotel = comprobar(r[2]) || [];
      var lista = [], vistos = {};

      filas.forEach(function (a) {
        var ficha = a.perro_id ? cat.porId[a.perro_id] : null;
        var nombre = ficha ? ficha.nombreMostrar : String(a.nombre_libre || "").trim();
        if (!nombre || esNombreHotelOculto(nombre)) return;
        var clave = ficha ? "ID:" + ficha.perroId : "N:" + norm(sinSufijo(nombre));
        if (vistos[clave]) return;
        vistos[clave] = true;
        var cancelado = !!a.cancelado, anadido = !!a.anadido, ok = !!a.ok;
        lista.push({
          perro: nombre, perroHoja: nombre,
          perroId: ficha ? ficha.perroId : "",
          nombreMostrar: nombre,
          servicio: a.servicio || "Guarderia",
          ok: ok, anadido: anadido, cancelado: cancelado,
          previsto: !cancelado && (ok || anadido || !!a.previsto),
          colorFondo: "",
          movimiento: a.movimiento || "",
          ruta: ficha ? ficha.ruta : 0,
          orden: ficha ? ficha.orden : 0,
          temporal: ficha ? ficha.temporal : esTemporal(nombre)
        });
      });

      cat.activos.forEach(function (f) {
        if (esNombreHotelOculto(f.nombreMostrar)) return;
        var clave = "ID:" + f.perroId;
        if (vistos[clave]) return;
        vistos[clave] = true;
        lista.push({
          perro: f.nombreMostrar, perroHoja: f.nombreMostrar, perroId: f.perroId,
          nombreMostrar: f.nombreMostrar, servicio: "Guarderia",
          ok: false, anadido: false, cancelado: false, previsto: false,
          colorFondo: "", ruta: f.ruta, orden: f.orden, temporal: false
        });
      });

      lista.sort(function (a, b) {
        if (a.previsto !== b.previsto) return a.previsto ? -1 : 1;
        if (a.previsto) {
          var ra = a.ruta || 99, rb = b.ruta || 99;
          if (ra !== rb) return ra - rb;
          if (a.temporal !== b.temporal) return a.temporal ? 1 : -1;
          var oa = a.orden || 9999, ob = b.orden || 9999;
          if (oa !== ob) return oa - ob;
        }
        return (a.nombreMostrar || a.perro).localeCompare(b.nombreMostrar || b.perro, "es", { sensitivity: "base" });
      });

      var puntuales = hotel.filter(function (h) { return h.perro && !esNombreHotelOculto(h.perro); })
        .map(function (h) {
          var idt = identidad(h.perro, cat);
          return {
            perro: String(h.perro).trim(), cliente: String(h.cliente || "").trim(),
            telefono: String(h.telefono || "").trim(),
            perroId: idt.perroId, nombreMostrar: idt.nombreMostrar || h.perro
          };
        })
        .filter(function (h) { return !esNombreHotelOculto(h.nombreMostrar); })
        .sort(function (a, b) {
          return String(a.nombreMostrar).localeCompare(String(b.nombreMostrar), "es", { sensitivity: "base" });
        });

      var previstos = lista.filter(function (i) { return i.previsto; });
      return {
        totalPerros: lista.length, fechaIso: iso, fechaTexto: textoFecha(fecha),
        totalPrevistos: previstos.length,
        totalRecogidos: previstos.filter(function (i) { return i.ok; }).length,
        perros: lista, puntuales: puntuales
      };
    });
  };

  backend.obtenerCatalogoRapidoPerrosApp = function () {
    return asegurarSesion().then(cargarCatalogo).then(function (cat) {
      var perros = cat.activos.filter(function (f) { return !esNombreHotelOculto(f.nombreMostrar); })
        .map(function (f) { return { perro: f.nombreMostrar, perroId: f.perroId, nombreMostrar: f.nombreMostrar }; });
      return { totalPerros: perros.length, perros: perros };
    });
  };

  backend.guardarAsistenciaApp = function (s, pre) {
    if (!s || typeof s !== "object") return Promise.reject(new Error("No se han recibido datos de asistencia."));
    var accion = norm(s.accion);
    if (["confirmar", "anadir", "cancelar", "deshacer"].indexOf(accion) < 0)
      return Promise.reject(new Error("La acción solicitada no es válida."));
    var fecha = deIso(s.fechaIso);
    if (!fecha) return Promise.reject(new Error("La fecha seleccionada no es válida."));
    var iso = aIso(fecha);
    var necesitaServicio = accion === "confirmar" || accion === "anadir";

    return asegurarSesion().then(function () {
      if (pre) return [pre.cat, { data: pre.servicios, error: null }];   // llamada desde el lote
      return Promise.all([cargarCatalogo(), sb.from("servicios").select("nombre,precio").eq("activo", true)]);
    }).then(function (r) {
      var cat = r[0], servicios = comprobar(r[1]) || [];

      var texto = String(s.perro || "").trim();
      if (!texto && !s.perroId) throw new Error("No se ha indicado el perro.");
      var ficha = null, nombreLibre = null;
      if (s.perroId) {
        ficha = cat.porId[s.perroId];
        if (!ficha) throw new Error("El perro seleccionado ya no existe. Actualiza la lista.");
      } else {
        var k = norm(sinSufijo(texto));
        if (cat.ambiguos[k]) throw new Error('El nombre "' + texto + '" corresponde a varios perros. Selecciona su nombre completo.');
        ficha = cat.porNombre[k] || null;
        if (!ficha) nombreLibre = texto;
      }
      var nombreFinal = ficha ? ficha.nombreMostrar + sufijoDe(texto) : nombreLibre;

      var validos = {}, precios = {};
      servicios.forEach(function (sv) { validos[norm(sv.nombre)] = sv.nombre; precios[norm(sv.nombre)] = Number(sv.precio) || 0; });
      validos[norm("Guardería de cortesía")] = "Guardería de cortesía";
      var servicio = validos[norm(s.servicio)] || "";
      if (necesitaServicio && !servicio) throw new Error("Selecciona un servicio válido.");
      if (necesitaServicio && norm(servicio) === "guarderia promo tina" && iso < "2026-11-02")
        throw new Error("Guarderia Promo Tina solo está disponible desde el 02/11/2026.");

      var cambios = {};
      if (accion === "confirmar") cambios = { servicio: servicio, cancelado: false, anadido: false, ok: true };
      if (accion === "anadir") cambios = { servicio: servicio, cancelado: false, ok: false, anadido: true };
      if (accion === "cancelar") cambios = { ok: false, anadido: false, cancelado: true };
      if (accion === "deshacer") cambios = { ok: false, cancelado: false };
      if ((accion === "confirmar" || accion === "anadir") && (s.movimiento === "I" || s.movimiento === "V")) cambios.movimiento = s.movimiento;
      cambios.actualizado_en = new Date().toISOString();

      var consulta = sb.from("asistencia").select("id,servicio").eq("fecha", iso);
      consulta = ficha ? consulta.eq("perro_id", ficha.perroId) : consulta.eq("nombre_libre", nombreLibre);
      return consulta.limit(1).then(function (res) {
        var existente = (comprobar(res) || [])[0];
        if (existente) {
          return sb.from("asistencia").update(cambios).eq("id", existente.id).then(function (u) {
            comprobar(u);
            return existente.servicio;
          });
        }
        var fila = Object.assign({
          fecha: iso, perro_id: ficha ? ficha.perroId : null,
          nombre_libre: ficha ? null : nombreLibre, servicio: "Guarderia",
          ok: false, anadido: false, cancelado: false, previsto: false
        }, cambios);
        return sb.from("asistencia").insert(fila).then(function (i) {
          if (i.error && i.error.code === "23505") {
            // Otra operación creó la fila a la vez (índice único): se actualiza esa en vez de fallar.
            var q = sb.from("asistencia").select("id,servicio").eq("fecha", iso);
            q = ficha ? q.eq("perro_id", ficha.perroId) : q.eq("nombre_libre", nombreLibre);
            return q.limit(1).then(function (res2) {
              var ya = (comprobar(res2) || [])[0];
              if (!ya) throw new Error(i.error.message || "Error de base de datos.");
              return sb.from("asistencia").update(cambios).eq("id", ya.id).then(function (u) {
                comprobar(u);
                return ya.servicio;
              });
            });
          }
          comprobar(i);
          return fila.servicio;
        });
      }).then(function (servicioFinal) {
        var servFinal = servicio || servicioFinal;
        return sincronizarCargo(iso, ficha, nombreLibre, nombreFinal, accion, servFinal, precios)
          .then(function () {
            return {
              correcto: true, accion: accion, perro: nombreFinal, fechaIso: iso,
              fechaTexto: textoFecha(fecha), servicio: servFinal
            };
          });
      });
    });
  };

  /* Guarda varios cambios de asistencia de un mismo día (la interfaz los agrupa al marcar perros). */
  backend.guardarAsistenciasLoteApp = function (solicitudes) {
    if (!Array.isArray(solicitudes) || solicitudes.length === 0)
      return Promise.reject(new Error("No hay cambios pendientes para guardar."));
    if (solicitudes.length > 100)
      return Promise.reject(new Error("Hay demasiados cambios en una sola operación."));
    var fechaIso = String(solicitudes[0].fechaIso || "").trim();
    if (!deIso(fechaIso)) return Promise.reject(new Error("La fecha seleccionada no es válida."));
    for (var i = 0; i < solicitudes.length; i++) {
      var it = solicitudes[i] || {};
      if (String(it.fechaIso || "").trim() !== fechaIso)
        return Promise.reject(new Error("Todos los cambios deben pertenecer al mismo día."));
      if (!String(it.perro || "").trim() && !it.perroId)
        return Promise.reject(new Error("No se ha indicado uno de los perros."));
      if (["confirmar", "anadir", "cancelar", "deshacer"].indexOf(norm(it.accion)) < 0)
        return Promise.reject(new Error("Una de las acciones no es válida."));
    }
    return asegurarSesion().then(function () {
      return Promise.all([cargarCatalogo(), sb.from("servicios").select("nombre,precio").eq("activo", true)]);
    }).then(function (r) {
      var pre = { cat: r[0], servicios: comprobar(r[1]) || [] }, hechos = 0, p = Promise.resolve();
      solicitudes.forEach(function (item) {   // en orden: un mismo perro puede cambiar varias veces
        p = p.then(function () { return backend.guardarAsistenciaApp(item, pre); }).then(function () { hechos++; });
      });
      return p.then(function () { return { correcto: true, total: hechos, fechaIso: fechaIso }; });
    });
  };

  /* Mantiene el registro de lo generado (cargos). El importe solo existe cuando el perro está
     RECOGIDO (accion "confirmar"). Añadir/programar, cancelar o deshacer no generan importe. */
  function sincronizarCargo(iso, ficha, nombreLibre, nombreFinal, accion, servicio, precios) {
    var del = sb.from("cargos").delete().eq("fecha", iso);
    del = ficha ? del.eq("perro_id", ficha.perroId) : del.eq("nombre_perro", sinSufijo(nombreLibre));
    return del.then(function (r) {
      comprobar(r);
      if (accion !== "confirmar") return null;
      var clave = norm(servicio);
      var precio = precios[clave] || 0;
      if (clave === "guarderia" && ficha && ficha.precio !== null && ficha.precio !== undefined)
        precio = Number(ficha.precio) || 0;
      if (clave.indexOf("cortesia") >= 0) precio = 0;
      return sb.from("cargos").insert({
        fecha: iso, perro_id: ficha ? ficha.perroId : null,
        nombre_perro: sinSufijo(nombreFinal), servicio: servicio, cargo: precio
      }).then(comprobar);
    });
  }

  backend.guardarRutaPerroAsistenciaApp = function (s) {
    var ruta = Number(s && s.ruta), orden = Number(s && s.orden) || null;
    if (!s || !String(s.perro || "").trim()) return Promise.reject(new Error("No se ha indicado el perro."));
    if ([1, 2].indexOf(ruta) < 0) return Promise.reject(new Error("Selecciona el recorrido 1 o 2."));
    return asegurarSesion().then(cargarCatalogo).then(function (cat) {
      var ficha = s.perroId ? cat.porId[s.perroId] : cat.porNombre[norm(sinSufijo(s.perro))];
      if (!ficha) throw new Error("No se encuentra el perro en la base de datos.");
      return sb.from("perros").update({ ruta: ruta, orden_ruta: orden, temporal: !!s.temporal })
        .eq("id", ficha.perroId).then(function (u) {
          comprobar(u);
          return { correcto: true, perro: s.perro, ruta: ruta, orden: orden };
        });
    });
  };

  /* ---------- google.script.run compatible ---------- */
  function ejecutor(ok, fallo) {
    return new Proxy({}, {
      get: function (_, nombre) {
        if (nombre === "withSuccessHandler") return function (f) { return ejecutor(f, fallo); };
        if (nombre === "withFailureHandler") return function (f) { return ejecutor(ok, f); };
        if (nombre === "withUserObject") return function () { return ejecutor(ok, fallo); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          Promise.resolve().then(function () {
            if (typeof backend[nombre] !== "function")
              throw new Error("Esta función todavía no está migrada a Supabase: " + String(nombre));
            return backend[nombre].apply(null, args);
          }).then(function (r) { if (ok) ok(r); },
                  function (e) {
                    console.error(nombre, e);
                    if (fallo) fallo(e instanceof Error ? e : new Error(String(e)));
                  });
        };
      }
    });
  }
  window.google = { script: { run: ejecutor(null, null) } };
  window.DoggyBackend = backend; // útil para pruebas
  window.DoggyCore = {
    sb: sb, norm: norm, sinSufijo: sinSufijo, sufijoDe: sufijoDe, dosDig: dosDig, aIso: aIso,
    deIso: deIso, textoFecha: textoFecha, comprobar: comprobar, asegurarSesion: asegurarSesion,
    cerrarSesion: cerrarSesion,
    cargarCatalogo: cargarCatalogo, identidad: identidad, esNombreHotelOculto: esNombreHotelOculto
  };
})();
