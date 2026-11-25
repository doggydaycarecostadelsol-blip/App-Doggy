/* Doggy Day Care · Historial por cliente con saldos.
 * Se carga después de backend-extra.js y añade a DoggyBackend:
 *   - obtenerListadoHistorialConSaldosApp()
 *   - obtenerDetalleHistorialApp(cliente, periodo, fechaIso)
 *
 * La cuenta es del CLIENTE (propietario): suma los cargos y pagos de todos sus perros.
 * Los cargos/pagos sin perro (hotel, transporte) se asignan al cliente de la tabla hotel_clientes.
 * Saldo = pagado − generado  (negativo = el cliente debe).
 */
(function () {
  "use strict";
  var C = window.DoggyCore, B = window.DoggyBackend;
  var sb = C.sb, norm = C.norm, sinSufijo = C.sinSufijo, comprobar = C.comprobar, deIso = C.deIso;
  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
    "septiembre", "octubre", "noviembre", "diciembre"];

  function redondear(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function mayus(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
  function hoyIso() { return C.aIso(new Date()); }

  function todo(tabla, cols) {
    var out = [];
    function pagina(desde) {
      return sb.from(tabla).select(cols).order("id").range(desde, desde + 999).then(function (r) {
        var d = comprobar(r) || [];
        out = out.concat(d);
        return d.length === 1000 ? pagina(desde + 1000) : out;
      });
    }
    return pagina(0);
  }
  function sinId(tabla, cols, orden) {
    return sb.from(tabla).select(cols).order(orden).range(0, 999).then(function (r) { return comprobar(r) || []; });
  }

  /* ---------- carga y agrupación por cliente ---------- */
  var cache = null, cacheHora = 0;

  function cargar(forzar) {
    if (!forzar && cache && Date.now() - cacheHora < 60000) return Promise.resolve(cache);
    return C.asegurarSesion().then(function () {
      return Promise.all([
        todo("cargos", "id,fecha,perro_id,nombre_perro,servicio,cargo"),
        todo("pagos", "id,fecha,perro_id,nombre_perro,importe,caja"),
        todo("perros", "id,cliente_id,nombre,nombre_config,estado"),
        todo("clientes", "id,nombre_completo,nombre_config"),
        sinId("hotel_clientes", "perro,cliente", "perro"),
        sinId("periodos", "nombre,indice,inicio,fin", "indice")
      ]);
    }).then(function (r) {
      cache = montar(r[0], r[1], r[2], r[3], r[4], r[5]);
      cacheHora = Date.now();
      return cache;
    });
  }

  function montar(cargos, pagos, perros, clientes, hoteles, periodos) {
    var etiquetaCliente = {};
    clientes.forEach(function (c) { etiquetaCliente[c.id] = c.nombre_config || c.nombre_completo || "Sin nombre"; });

    var perroPorId = {}, perroPorNombre = {}, ambiguos = {};
    perros.forEach(function (p) {
      var f = { id: p.id, cliente: etiquetaCliente[p.cliente_id] || "Sin cliente",
        nombre: p.nombre_config || p.nombre, estado: norm(p.estado) };
      perroPorId[p.id] = f;
      [p.nombre, p.nombre_config].forEach(function (n) {
        var k = norm(sinSufijo(n));
        if (!k) return;
        if (perroPorNombre[k] && perroPorNombre[k].id !== f.id) ambiguos[k] = true;
        else perroPorNombre[k] = f;
      });
    });
    var hotelPorNombre = {};
    hoteles.forEach(function (h) {
      if (h.perro && h.cliente) hotelPorNombre[norm(sinSufijo(h.perro))] = h.cliente;
    });

    // cuentas por cliente
    var cuentas = {};
    function cuenta(cliente) {
      return cuentas[cliente] || (cuentas[cliente] = { cliente: cliente, perros: {}, movs: [] });
    }
    function resolver(perroId, nombre) {
      var f = perroId ? perroPorId[perroId] : null;
      if (f) return { cliente: f.cliente, perro: f.nombre, ficha: f };
      var k = norm(sinSufijo(nombre));
      if (k && !ambiguos[k] && perroPorNombre[k])
        return { cliente: perroPorNombre[k].cliente, perro: perroPorNombre[k].nombre, ficha: perroPorNombre[k] };
      if (k && hotelPorNombre[k]) return { cliente: hotelPorNombre[k], perro: String(nombre || "").trim(), ficha: null };
      var t = sinSufijo(nombre) || "Sin asignar";
      return { cliente: t, perro: String(nombre || "").trim(), ficha: null };
    }

    cargos.forEach(function (x) {
      var d = resolver(x.perro_id, x.nombre_perro), c = cuenta(d.cliente);
      var servicio = String(x.servicio || "");
      var concepto = norm(servicio).indexOf("cortesia") >= 0 ? "Guardería de cortesía"
        : servicio.replace(/^Guarderia/, "Guardería");
      c.movs.push({ fecha: String(x.fecha), orden: 0, concepto: concepto || "Cargo", perro: d.perro,
        generado: redondear(x.cargo), cobrado: 0 });
      if (d.ficha) c.perros[d.ficha.id] = d.ficha; else c.perros["libre:" + norm(d.perro)] = { nombre: d.perro, estado: "libre" };
    });
    pagos.forEach(function (x) {
      var d = resolver(x.perro_id, x.nombre_perro), c = cuenta(d.cliente);
      c.movs.push({ fecha: String(x.fecha), orden: 1, concepto: x.caja ? "Pago · " + x.caja : "Pago", perro: d.perro,
        generado: 0, cobrado: redondear(x.importe) });
      if (d.ficha) c.perros[d.ficha.id] = d.ficha; else c.perros["libre:" + norm(d.perro)] = { nombre: d.perro, estado: "libre" };
    });
    // clientes con perros pero sin movimientos todavía
    perros.forEach(function (p) {
      var f = perroPorId[p.id];
      if (f.estado === "inactivo") return;
      cuenta(f.cliente).perros[f.id] = f;
    });

    Object.keys(cuentas).forEach(function (k) {
      var c = cuentas[k];
      c.movs.sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.orden - b.orden; });
      var acum = 0;
      c.movs.forEach(function (m) { acum = redondear(acum + m.generado - m.cobrado); m.saldo = acum; }); // saldo = deuda acumulada
      c.deuda = acum;
    });
    return { cuentas: cuentas, periodos: periodos };
  }

  /* ---------- periodos operativos (meses) ---------- */
  function mesDe(iso, periodos) {
    var p = periodos.filter(function (x) { return iso >= x.inicio && iso <= x.fin; })[0];
    if (p) return { clave: p.nombre + "|" + p.inicio, nombre: p.nombre + " " + p.fin.slice(0, 4), inicio: p.inicio, fin: p.fin, indice: p.indice };
    var a = iso.slice(0, 4), m = +iso.slice(5, 7);
    return { clave: a + "-" + iso.slice(5, 7), nombre: mayus(MESES[m - 1]) + " " + a, inicio: iso.slice(0, 7) + "-01",
      fin: iso.slice(0, 7) + "-31", indice: -1 };
  }
  function periodoActual(periodos, hoy) {
    var p = periodos.filter(function (x) { return hoy >= x.inicio && hoy <= x.fin; })[0];
    if (p) return p;
    var pasados = periodos.filter(function (x) { return x.inicio <= hoy; });
    return pasados.length ? pasados[pasados.length - 1] : null;
  }
  function inicioPeriodo(periodo, periodos, hoy) {
    var act = periodoActual(periodos, hoy);
    var nMeses = { "Mes actual": 1, "2 meses": 2, "3 meses": 3 }[periodo];
    if (nMeses) {
      if (act) {
        var visibles = periodos.filter(function (p) { return p.indice <= act.indice; })
          .sort(function (a, b) { return b.indice - a.indice; });
        var p = visibles[Math.min(nMeses, visibles.length) - 1];
        return { inicio: p.inicio, texto: nMeses === 1 ? act.nombre : (nMeses === 2 ? "Mes actual y anterior" : "Últimos 3 meses") };
      }
      var d = deIso(hoy); d.setMonth(d.getMonth() - (nMeses - 1));
      return { inicio: C.aIso(new Date(d.getFullYear(), d.getMonth(), 1)),
        texto: nMeses === 1 ? "Mes actual" : (nMeses === 2 ? "Mes actual y anterior" : "Últimos 3 meses") };
    }
    if (periodo === "Año actual") return { inicio: hoy.slice(0, 4) + "-01-01", texto: "Año " + hoy.slice(0, 4) };
    return { inicio: "", texto: "Historial completo" };
  }

  /* ---------- listado ---------- */
  B.obtenerListadoHistorialConSaldosApp = function () {
    return cargar(true).then(function (datos) {
      var perros = [], pendiente = 0;
      Object.keys(datos.cuentas).forEach(function (k) {
        var c = datos.cuentas[k];
        if (c.deuda > 0) pendiente += c.deuda;
        var lista = Object.keys(c.perros).map(function (i) { return c.perros[i]; })
          .filter(function (p) { return p.estado !== "inactivo" || c.movs.length; });
        if (!lista.length) lista = [{ nombre: c.cliente }];
        lista.forEach(function (p) {
          perros.push({ perro: p.nombre, cliente: c.cliente, saldoActual: redondear(-c.deuda) });
        });
      });
      perros.sort(function (a, b) { return a.perro.localeCompare(b.perro, "es", { sensitivity: "base" }); });
      return { perros: perros, pendienteCobroTotal: redondear(pendiente) };
    });
  };

  /* ---------- detalle de un cliente ---------- */
  function filaMov(m) {
    var d = deIso(m.fecha);
    return { concepto: m.concepto, fecha: m.fecha, fechaTexto: d ? C.textoFecha(d) : m.fecha, perro: m.perro,
      generado: m.generado, cobrado: m.cobrado, saldo: m.saldo };
  }

  B.obtenerDetalleHistorialApp = function (cliente, periodo, fechaIso) {
    periodo = String(periodo || "Completo");
    return cargar(false).then(function (datos) {
      var c = datos.cuentas[cliente];
      if (!c) throw new Error("No se encuentra al cliente «" + cliente + "».");
      var hoy = hoyIso(), periodos = datos.periodos, texto, inicio = "", fin = "";

      if (periodo === "Deuda hasta fecha") {
        fin = /^\d{4}-\d{2}-\d{2}$/.test(fechaIso || "") ? fechaIso : hoy;
        var df = deIso(fin);
        texto = "Deuda hasta el " + C.textoFecha(df);
      } else {
        var r = inicioPeriodo(periodo, periodos, hoy);
        inicio = r.inicio; texto = r.texto;
      }
      var hasta = c.movs.filter(function (m) { return !fin || m.fecha <= fin; });
      var anteriores = hasta.filter(function (m) { return inicio && m.fecha < inicio; });
      var enPeriodo = hasta.filter(function (m) { return !inicio || m.fecha >= inicio; });
      var saldoAnterior = anteriores.length ? anteriores[anteriores.length - 1].saldo : 0;
      var generado = 0, cobrado = 0;
      enPeriodo.forEach(function (m) { generado += m.generado; cobrado += m.cobrado; });
      generado = redondear(generado); cobrado = redondear(cobrado);
      var pendiente = hasta.length ? hasta[hasta.length - 1].saldo : 0;

      var resumirMeses = periodo === "Completo" || periodo === "Año actual" || periodo === "Deuda hasta fecha";
      var actual = periodoActual(periodos, hoy);
      var claveActual = actual ? actual.nombre + "|" + actual.inicio : mesDe(hoy, periodos).clave;
      var movimientos = [], detalleMeses = {};

      var recientes = enPeriodo.slice().reverse(); // más nuevo primero
      if (!resumirMeses) {
        recientes.forEach(function (m) { movimientos.push(filaMov(m)); });
      } else {
        var meses = [], porClave = {};
        recientes.forEach(function (m) {
          var mes = mesDe(m.fecha, periodos);
          var esActual = mes.clave === claveActual || (fin && mesDe(fin, periodos).clave === mes.clave);
          if (esActual) { movimientos.push(filaMov(m)); return; }
          var g = porClave[mes.clave];
          if (!g) { g = porClave[mes.clave] = { mes: mes, movs: [], gen: 0, cob: 0 }; meses.push(g); }
          g.movs.push(m); g.gen += m.generado; g.cob += m.cobrado;
        });
        // los meses ya van de más nuevo a más antiguo; se intercalan tras el mes en curso
        meses.forEach(function (g) {
          movimientos.push({ esResumen: true, resumenMes: true, claveMes: g.mes.clave, concepto: g.mes.nombre,
            resumenGenerado: redondear(g.gen), resumenCobrado: redondear(g.cob), saldo: g.movs[0].saldo,
            generado: 0, cobrado: 0 });
          detalleMeses[g.mes.clave] = g.movs.map(filaMov);
        });
      }
      if (saldoAnterior !== 0) {
        movimientos.push({ concepto: "Saldo anterior", fechaTexto: "Antes de " + C.textoFecha(deIso(inicio)),
          generado: saldoAnterior > 0 ? saldoAnterior : 0, cobrado: saldoAnterior < 0 ? -saldoAnterior : 0,
          saldo: saldoAnterior });
      }

      return {
        cliente: cliente, periodo: texto,
        generado: generado, cobrado: cobrado,
        pendiente: pendiente > 0 ? redondear(pendiente) : 0,
        saldoFavor: pendiente < 0 ? redondear(-pendiente) : 0,
        movimientos: movimientos, detalleMeses: detalleMeses
      };
    });
  };
})();
