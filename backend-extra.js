/* Doggy Day Care · dashboard, pagos, gastos, cajas personales y eventos.
 * Se carga después de supabase-shim.js y añade sus funciones a DoggyBackend.
 */
(function () {
  "use strict";
  var C = window.DoggyCore, B = window.DoggyBackend;
  var sb = C.sb, norm = C.norm, aIso = C.aIso, deIso = C.deIso, comprobar = C.comprobar;
  var sinSufijo = C.sinSufijo;
  var MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto",
    "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  var DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

  /* ---------- utilidades ---------- */
  function redondear(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function dia(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function suma(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function corta(d) { return C.dosDig(d.getDate()) + "/" + C.dosDig(d.getMonth() + 1); }
  function rango(a, b) { return corta(a) + " - " + corta(b); }
  function larga(d) {
    return DIAS[d.getDay()] + ", " + d.getDate() + " de " + MESES[d.getMonth()].toLowerCase() +
      " de " + d.getFullYear();
  }
  function lunesDe(d) { var w = d.getDay(); return suma(d, w === 0 ? -6 : 1 - w); }
  function esEfectivo(m) {
    m = norm(m);
    return m.indexOf("jorge") >= 0 || m.indexOf("rodri") >= 0 || m.indexOf("efectivo") >= 0;
  }
  function textoDia(iso) { var d = deIso(iso); return d ? C.textoFecha(d) : ""; }
  function numero(v) {
    // Acepta "1.234,50", "1,234.50", "12,5" o "12 €". Vacío = 0, como antes.
    var t = String(v === undefined || v === null ? "" : v).replace(/[€\s]/g, "");
    if (!t) return 0;
    var comas = (t.match(/,/g) || []).length, puntos = (t.match(/\./g) || []).length;
    if (comas && puntos) {
      if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", ".");
      else t = t.replace(/,/g, "");
    } else if (comas > 1) t = t.replace(/,/g, "");
    else if (comas === 1) t = t.replace(",", ".");
    else if (puntos > 1) t = t.replace(/\./g, "");
    var n = Number(t);
    return isFinite(n) ? n : NaN;
  }
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
  function sesion() { return C.asegurarSesion(); }

  /* ================= DASHBOARD ================= */
  function fuentes() {
    return Promise.all([
      todo("cargos", "id,fecha,nombre_perro,servicio,cargo"),
      todo("pagos", "id,fecha,nombre_perro,importe,caja,cierre_id"),
      todo("gastos", "id,fecha,concepto,categoria,importe,iva,metodo,notas,cierre_id")
    ]).then(function (r) { return { balance: r[0], pagos: r[1], gastos: r[2] }; });
  }
  function periodosOperativos() {
    return sb.from("periodos").select("nombre,indice,inicio,fin").order("indice").then(function (r) {
      var f = comprobar(r) || [];
      if (!f.length) throw new Error("No se encontraron los periodos mensuales.");
      return f.map(function (p) {
        return { indice: p.indice, nombre: p.nombre, inicio: deIso(p.inicio), fin: deIso(p.fin) };
      });
    });
  }
  function periodoActual(periodos, hoy) {
    var t = hoy.getTime();
    var enc = periodos.filter(function (p) { return t >= p.inicio.getTime() && t <= p.fin.getTime(); })[0];
    if (enc) return enc;
    var ya = periodos.filter(function (p) { return p.inicio.getTime() <= t; });
    return ya.length ? ya[ya.length - 1] : periodos[0];
  }
  function limites(periodo, hoy, periodos, actual) {
    var ini, fin;
    if (periodo === "semana") { ini = lunesDe(hoy); fin = suma(ini, 4); }
    else if (periodo === "mes") { ini = actual.inicio; fin = actual.fin; }
    else if (periodo === "anio") {
      var vis = periodos.filter(function (p) { return p.indice <= actual.indice; });
      ini = vis[0].inicio; fin = actual.fin;
    } else { ini = hoy; fin = hoy; }
    return { ini: aIso(ini), fin: aIso(fin) };
  }
  function dentro(r, ini, fin) { return r.fecha >= ini && r.fecha <= fin; }

  function resumen(f, ini, fin) {
    var r = {
      perros: { total: 0, guarderia: 0, hotel: 0 },
      generado: { total: 0, guarderia: 0, hotel: 0 },
      cobrado: { total: 0, efectivo: 0, banco: 0 },
      gastado: { total: 0, efectivo: 0, banco: 0 }
    };
    f.balance.forEach(function (x) {
      if (!dentro(x, ini, fin)) return;
      var cargo = Number(x.cargo) || 0, hotel = norm(x.servicio).indexOf("hotel") >= 0;
      r.perros.total++; r.generado.total += cargo;
      if (hotel) { r.perros.hotel++; r.generado.hotel += cargo; }
      else { r.perros.guarderia++; r.generado.guarderia += cargo; }
    });
    f.pagos.forEach(function (x) {
      if (!dentro(x, ini, fin)) return;
      var i = Number(x.importe) || 0;
      r.cobrado.total += i;
      if (esEfectivo(x.caja)) r.cobrado.efectivo += i; else r.cobrado.banco += i;
    });
    f.gastos.forEach(function (x) {
      if (!dentro(x, ini, fin)) return;
      var i = Number(x.importe) || 0;
      r.gastado.total += i;
      if (esEfectivo(x.metodo)) r.gastado.efectivo += i; else r.gastado.banco += i;
    });
    ["generado", "cobrado", "gastado"].forEach(function (k) {
      Object.keys(r[k]).forEach(function (c) { r[k][c] = redondear(r[k][c]); });
    });
    return r;
  }
  function elemento(nombre, subtitulo, res, destino, iso) {
    return {
      nombre: nombre, subtitulo: subtitulo, periodoDestino: destino || "", fechaIso: iso || "",
      perros: res.perros.total, generado: res.generado.total, cobrado: res.cobrado.total,
      gastado: res.gastado.total,
      tieneDatos: res.perros.total !== 0 || res.generado.total !== 0 ||
        res.cobrado.total !== 0 || res.gastado.total !== 0
    };
  }
  function desglose(periodo, hoy, f, periodos, actual) {
    var out = [], i;
    if (periodo === "semana") {
      var lun = lunesDe(hoy), nombres = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
      for (i = 0; i < 5; i++) {
        var d = suma(lun, i);
        out.push(elemento(nombres[i], corta(d), resumen(f, aIso(d), aIso(d)), "hoy", aIso(d)));
      }
    } else if (periodo === "mes") {
      var ini = actual.inicio, n = 1;
      while (ini.getTime() <= actual.fin.getTime()) {
        var fin = suma(ini, 6);
        if (fin.getTime() > actual.fin.getTime()) fin = actual.fin;
        out.push(elemento("Semana " + n, rango(ini, fin), resumen(f, aIso(ini), aIso(fin)), "semana", aIso(ini)));
        ini = suma(ini, 7); n++;
      }
    } else if (periodo === "anio") {
      periodos.filter(function (p) { return p.indice <= actual.indice; })
        .sort(function (a, b) { return b.indice - a.indice; })
        .forEach(function (p) {
          out.push(elemento(p.nombre, rango(p.inicio, p.fin), resumen(f, aIso(p.inicio), aIso(p.fin)), "mes", aIso(p.inicio)));
        });
    }
    return out;
  }
  function informacion(periodo, hoy, actual) {
    if (periodo === "semana") {
      var l = lunesDe(hoy), v = suma(l, 4);
      return { etiqueta: "RESUMEN SEMANAL",
        titulo: "Semana del " + l.getDate() + " al " + v.getDate() + " de " + MESES[v.getMonth()].toLowerCase(),
        tituloDesglose: "Días de la semana" };
    }
    if (periodo === "mes") {
      return { etiqueta: "RESUMEN MENSUAL", titulo: actual.nombre + " · " + rango(actual.inicio, actual.fin),
        tituloDesglose: "Semanas de " + actual.nombre.toLowerCase() };
    }
    if (periodo === "anio") {
      return { etiqueta: "RESUMEN ANUAL", titulo: "Año " + hoy.getFullYear(), tituloDesglose: "Meses del año" };
    }
    return { etiqueta: "RESUMEN DIARIO", titulo: larga(hoy), tituloDesglose: "" };
  }
  function gastoDetalle(g) {
    return {
      fila: g.id, fechaIso: g.fecha, fechaTexto: textoDia(g.fecha), concepto: g.concepto || "",
      categoria: g.categoria || "", importe: redondear(g.importe), iva: g.iva === true,
      metodo: g.metodo || "", notas: g.notas || ""
    };
  }
  function detallesDiarios(f, ini, fin) {
    var en = function (r) { return dentro(r, ini, fin); };
    return {
      generado: f.balance.filter(en).map(function (r) {
        return { nombre: r.nombre_perro, detalle: r.servicio || "Guardería", importe: redondear(r.cargo),
          fechaIso: r.fecha, perro: r.nombre_perro, servicio: r.servicio || "Guardería" };
      }),
      cobrado: f.pagos.filter(en).map(function (r) {
        return { nombre: r.nombre_perro || "Pago", detalle: r.caja || "Sin método", importe: redondear(r.importe),
          fechaIso: r.fecha, fechaTexto: textoDia(r.fecha), perro: r.nombre_perro || "", metodo: r.caja || "" };
      }),
      gastado: f.gastos.filter(en).map(function (r) {
        var g = gastoDetalle(r);
        g.nombre = r.concepto || "Gasto";
        g.detalle = [r.categoria, r.metodo].filter(Boolean).join(" · ") || "Sin detalle";
        return g;
      })
    };
  }
  function resumenDetalle(f, ini, fin) {
    var perros = { guarderia: { cantidad: 0, importe: 0 }, hotel: { cantidad: 0, importe: 0 } }, cats = {};
    f.balance.forEach(function (r) {
      if (!dentro(r, ini, fin)) return;
      var t = norm(r.servicio).indexOf("hotel") >= 0 ? "hotel" : "guarderia";
      perros[t].cantidad++; perros[t].importe += Number(r.cargo) || 0;
    });
    f.gastos.forEach(function (r) {
      if (!dentro(r, ini, fin)) return;
      var nombre = r.categoria || "Sin categoría", k = norm(nombre);
      cats[k] = cats[k] || { nombre: nombre, importe: 0 };
      cats[k].importe += Number(r.importe) || 0;
    });
    // Desglose de lo generado por tipo de servicio (suma = total generado del periodo).
    var gen = { guarderia: { n: 0, i: 0 }, hotel: { n: 0, i: 0 }, transporte: { n: 0, i: 0 } };
    var porPerro = {};
    f.balance.forEach(function (r) {
      if (!dentro(r, ini, fin)) return;
      var s = norm(r.servicio), k = s.indexOf("hotel") >= 0 ? "hotel" : s.indexOf("transporte") === 0 ? "transporte" : "guarderia";
      gen[k].n++; gen[k].i += Number(r.cargo) || 0;
      var pk = norm(sinSufijo(r.nombre_perro));
      porPerro[pk] = porPerro[pk] || { nombre: sinSufijo(r.nombre_perro), gen: 0, cob: 0 };
      porPerro[pk].gen += Number(r.cargo) || 0;
    });
    var cajas = {}, totalCobrado = 0;
    f.pagos.forEach(function (r) {
      if (!dentro(r, ini, fin)) return;
      var imp = Number(r.importe) || 0, c = String(r.caja || "").trim() || "Sin método";
      cajas[c] = cajas[c] || { n: 0, i: 0 }; cajas[c].n++; cajas[c].i += imp; totalCobrado += imp;
      var pk2 = norm(sinSufijo(r.nombre_perro));
      if (pk2) { porPerro[pk2] = porPerro[pk2] || { nombre: sinSufijo(r.nombre_perro), gen: 0, cob: 0 }; porPerro[pk2].cob += imp; }
    });
    var totalGenerado = gen.guarderia.i + gen.hotel.i + gen.transporte.i;
    var pendiente = totalGenerado - totalCobrado;
    function cant(n, u) { return n + " " + u + (n === 1 ? "" : "s"); }
    var generadoServicios = [
      { nombre: "Guardería", detalle: cant(gen.guarderia.n, "servicio"), importe: redondear(gen.guarderia.i) },
      { nombre: "Hotel", detalle: cant(gen.hotel.n, "servicio"), importe: redondear(gen.hotel.i) },
      { nombre: "Transporte", detalle: cant(gen.transporte.n, "servicio"), importe: redondear(gen.transporte.i) }
    ];
    var cobradoDesglose = Object.keys(cajas).sort().map(function (c) {
      return { nombre: "Cobrado · " + c, detalle: cant(cajas[c].n, "cobro"), importe: redondear(cajas[c].i) };
    });
    cobradoDesglose.push(
      { nombre: "Generado en el periodo", detalle: "Lo que toca cobrar", importe: redondear(totalGenerado), sinSuma: true },
      { nombre: pendiente >= 0 ? "Falta por cobrar" : "Cobrado de más (saldo a favor)",
        detalle: "Generado − cobrado en el periodo", importe: redondear(Math.abs(pendiente)), sinSuma: true, resalte: pendiente > 0 });
    Object.keys(porPerro).map(function (k) { return porPerro[k]; })
      .filter(function (x) { return x.gen - x.cob > 0.009; })
      .sort(function (a, b) { return (b.gen - b.cob) - (a.gen - a.cob); }).slice(0, 40)
      .forEach(function (x) {
        cobradoDesglose.push({ nombre: x.nombre, detalle: "Pendiente · generado " + redondear(x.gen) + " € · cobrado " + redondear(x.cob) + " €",
          importe: redondear(x.gen - x.cob), sinSuma: true });
      });
    return {
      generadoServicios: generadoServicios, cobradoDesglose: cobradoDesglose,
      perros: [
        { nombre: "Guardería", detalle: perros.guarderia.cantidad + " perros", cantidad: perros.guarderia.cantidad,
          importe: redondear(perros.guarderia.importe) },
        { nombre: "Hotel", detalle: perros.hotel.cantidad + " perros", cantidad: perros.hotel.cantidad,
          importe: redondear(perros.hotel.importe) }
      ],
      gastosCategorias: Object.keys(cats).map(function (k) {
        return { nombre: cats[k].nombre, detalle: "Categoría", importe: redondear(cats[k].importe) };
      }).sort(function (a, b) { return b.importe - a.importe; })
    };
  }
  function contexto(periodo, fechaIso) {
    periodo = norm(periodo || "hoy");
    var hoy = fechaIso ? deIso(fechaIso) : dia(new Date());
    if (!hoy) return Promise.reject(new Error("La fecha seleccionada no es válida."));
    var needs = periodo === "mes" || periodo === "anio";
    return Promise.all([fuentes(), needs ? periodosOperativos() : Promise.resolve([])]).then(function (r) {
      var periodos = r[1], actual = needs ? periodoActual(periodos, hoy) : null;
      return { periodo: periodo, hoy: hoy, f: r[0], periodos: periodos, actual: actual,
        lim: limites(periodo, hoy, periodos, actual) };
    });
  }

  B.obtenerDatosDashboard = function (periodo, fechaIso) {
    return sesion().then(function () { return contexto(periodo, fechaIso); }).then(function (x) {
      var res = resumen(x.f, x.lim.ini, x.lim.fin), info = informacion(x.periodo, x.hoy, x.actual);
      return {
        periodo: x.periodo, fechaIso: aIso(x.hoy), etiqueta: info.etiqueta, titulo: info.titulo,
        tituloDesglose: info.tituloDesglose, perros: res.perros, generado: res.generado,
        cobrado: res.cobrado, gastado: res.gastado,
        desglose: desglose(x.periodo, x.hoy, x.f, x.periodos, x.actual),
        detalles: x.periodo === "hoy" ? detallesDiarios(x.f, x.lim.ini, x.lim.fin) : null,
        resumenDetalle: resumenDetalle(x.f, x.lim.ini, x.lim.fin)
      };
    });
  };
  B.obtenerDetalleGastosCategoriaDashboard = function (periodo, fechaIso, categoria) {
    return sesion().then(function () { return contexto(periodo, fechaIso); }).then(function (x) {
      var buscada = norm(categoria);
      var lista = x.f.gastos.filter(function (g) {
        return dentro(g, x.lim.ini, x.lim.fin) && norm(g.categoria) === buscada;
      }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0; })
        .map(function (g) {
          var d = gastoDetalle(g);
          d.nombre = g.concepto || "Gasto";
          d.detalle = textoDia(g.fecha) + " · " + (g.metodo || "Sin método");
          return d;
        });
      return { categoria: String(categoria || "").trim(),
        total: lista.reduce(function (s, g) { return s + g.importe; }, 0), gastos: lista };
    });
  };

  /* ================= LISTADOS POR TRAMOS ================= */
  function desplazar(iso, dias) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("Fecha de listado no válida.");
    var f = new Date(iso + "T12:00:00Z");
    if (isNaN(f.getTime()) || f.toISOString().slice(0, 10) !== iso) throw new Error("Fecha de listado no válida.");
    f.setUTCDate(f.getUTCDate() + dias);
    return f.toISOString().slice(0, 10);
  }
  B.obtenerOperacionesTramoDoggy = function (s) {
    var tipo = s && s.tipo;
    if (tipo !== "pago" && tipo !== "gasto") return Promise.reject(new Error("Tipo de listado no válido."));
    var esPago = tipo === "pago";
    var fin, inicio, sig;
    try {
      fin = String(s.finIso || "") || aIso(new Date());
      inicio = desplazar(fin, -14); sig = desplazar(inicio, -1);
    } catch (e) { return Promise.reject(e); }
    var tabla = esPago ? "pagos" : "gastos";
    var cols = esPago ? "id,fecha,nombre_perro,perro_id,importe,caja,cierre_id" : "id,fecha,concepto,categoria,importe,iva,metodo,notas,cierre_id";
    return sesion().then(function () {
      return Promise.all([
        sb.from(tabla).select(cols).gte("fecha", inicio).lte("fecha", fin).range(0, 999),
        sb.from(tabla).select("id").lt("fecha", inicio).limit(1)
      ]);
    }).then(function (r) {
      var filas = comprobar(r[0]) || [], hayMas = (comprobar(r[1]) || []).length > 0, regs = [];
      filas.forEach(function (x) {
        var importe = Number(x.importe) || 0;
        if (esPago) {
          if (!String(x.nombre_perro || "").trim() || importe <= 0) return;
          regs.push({ fechaIso: x.fecha, fechaTexto: textoDia(x.fecha), importe: importe,
            metodo: x.caja || "", perro: x.nombre_perro, perroId: x.perro_id || "", cierre: x.cierre_id || "" });
        } else {
          if (!x.categoria && importe === 0) return;
          regs.push({ fechaIso: x.fecha, fechaTexto: textoDia(x.fecha), importe: importe, metodo: x.metodo || "",
            fila: x.id, concepto: x.concepto || "", categoria: x.categoria || "", iva: x.iva === true,
            notas: x.notas || "", cierre: x.cierre_id || "" });
        }
      });
      regs.sort(function (a, b) { return a.fechaIso < b.fechaIso ? 1 : a.fechaIso > b.fechaIso ? -1 : 0; });
      return { registros: regs, inicioIso: inicio, finIso: fin, siguienteFinIso: sig, hayMas: hayMas };
    });
  };

  /* Los cobros y gastos de un cierre de caja se pueden editar y borrar (decisión del negocio).
     Siguen asociados a su cierre; el total guardado de ese cierre no se recalcula. */
  function cierreBloquea() { return false; }

  /* ================= PAGOS ================= */
  var CAJAS = { banco: "Banco", rodri: "Rodri", jorge: "Jorge" };

  function buscarPago(fechaIso, perro, importeEsperado) {
    return sb.from("pagos").select("id,nombre_perro,perro_id,importe,caja,cierre_id").eq("fecha", fechaIso)
      .range(0, 999).then(function (r) {
        var k = norm(C.sinSufijo(perro));
        var lista = (comprobar(r) || []).filter(function (p) { return norm(C.sinSufijo(p.nombre_perro)) === k; });
        var esperado = numero(importeEsperado);
        if (isFinite(esperado) && esperado > 0) {
          var exacto = lista.filter(function (p) { return Math.abs(Number(p.importe) - esperado) <= 0.009; });
          if (!exacto.length && lista.length) throw new Error("Ese pago ha cambiado. Actualiza la lista antes de editarlo.");
          lista = exacto;
        }
        if (!lista.length) throw new Error("Ese pago ya no existe.");
        return lista[0];
      });
  }

  B.guardarPagoApp = function (s) {
    if (!s || typeof s !== "object") return Promise.reject(new Error("No se han recibido los datos del pago."));
    var fecha = deIso(s.fechaIso);
    if (!fecha) return Promise.reject(new Error("La fecha del pago no es válida."));
    var perroTexto = String(s.perro || "").trim();
    if (!perroTexto) return Promise.reject(new Error("Selecciona un perro."));
    var importe = numero(s.importe);
    if (!isFinite(importe) || importe <= 0) return Promise.reject(new Error("Introduce un importe válido."));
    var caja = CAJAS[norm(s.caja)] || "";
    if (!caja) return Promise.reject(new Error("Selecciona Banco, Rodri o Jorge."));
    var iso = aIso(fecha);
    var esEdicion = !!(String(s.fechaOriginal || "").trim() && String(s.perroOriginal || "").trim());

    return sesion().then(function () {
      return Promise.all([
        C.cargarCatalogo(),
        sb.from("asistencia").select("nombre_libre").eq("fecha", iso).not("nombre_libre", "is", null),
        sb.from("hotel_clientes").select("perro")
      ]);
    }).then(function (r) {
      var cat = r[0], ficha = s.perroId ? cat.porId[s.perroId] : cat.porNombre[norm(C.sinSufijo(perroTexto))];
      var origenP = esEdicion ? buscarPago(String(s.fechaOriginal), String(s.perroOriginal), s.importeOriginal)
        : Promise.resolve(null);
      return origenP.then(function (origen) {
        var nombreFinal;
        if (ficha) nombreFinal = ficha.nombreMostrar + C.sufijoDe(perroTexto);
        else if (origen && norm(C.sinSufijo(origen.nombre_perro)) === norm(C.sinSufijo(perroTexto))) {
          // Edición sin cambiar de perro: se conserva el nombre y el perro del cobro original.
          nombreFinal = origen.nombre_perro;
          if (origen.perro_id && cat.porId[origen.perro_id]) ficha = cat.porId[origen.perro_id];
        } else {
          var k = norm(C.sinSufijo(perroTexto));
          var conocidos = (comprobar(r[1]) || []).map(function (x) { return norm(C.sinSufijo(x.nombre_libre)); })
            .concat((comprobar(r[2]) || []).map(function (x) { return norm(C.sinSufijo(x.perro)); }));
          if (conocidos.indexOf(k) < 0) throw new Error("No se encuentra ese perro. Selecciónalo de la lista.");
          nombreFinal = perroTexto;
        }
        if (origen && cierreBloquea(origen.cierre_id))
          throw new Error("Este cobro ya está en el cierre de caja " + origen.cierre_id + " y no se puede modificar.");
        return sb.from("pagos").select("id,nombre_perro").eq("fecha", iso).range(0, 999).then(function (dup) {
          var k2 = norm(C.sinSufijo(nombreFinal));
          var otro = (comprobar(dup) || []).filter(function (p) {
            return norm(C.sinSufijo(p.nombre_perro)) === k2 && (!origen || p.id !== origen.id);
          });
          if (otro.length) throw new Error(nombreFinal + " ya tiene un pago registrado en esa fecha.");
          var fila = { fecha: iso, perro_id: ficha ? ficha.perroId : null, nombre_perro: nombreFinal,
            importe: importe, caja: caja };
          var op = origen ? sb.from("pagos").update(fila).eq("id", origen.id) : sb.from("pagos").insert(fila);
          return op.then(function (x) {
            comprobar(x);
            return { correcto: true, fechaTexto: C.textoFecha(fecha), perro: nombreFinal, importe: importe,
              caja: caja, aviso: "" };
          });
        });
      });
    });
  };

  B.borrarPagoApp = function (s) {
    if (!s || typeof s !== "object") return Promise.reject(new Error("No se han recibido los datos del pago."));
    return sesion().then(function () { return buscarPago(String(s.fechaIso || ""), String(s.perro || ""), s.importe); })
      .then(function (p) {
        if (cierreBloquea(p.cierre_id)) throw new Error("Este cobro ya está en el cierre de caja " + p.cierre_id + " y no se puede borrar.");
        return sb.from("pagos").delete().eq("id", p.id).then(function (x) {
          comprobar(x);
          return { correcto: true, perro: p.nombre_perro };
        });
      });
  };

  /* ================= GASTOS ================= */
  B.obtenerOpcionesGastoApp = function () {
    return sesion().then(function () {
      return sb.from("categorias_gasto").select("nombre,orden").order("orden");
    }).then(function (r) {
      var cats = (comprobar(r) || []).map(function (c) { return c.nombre; });
      if (!cats.length) throw new Error("No se encontraron categorías de gasto.");
      return { categorias: cats };
    });
  };
  var METODOS_GASTO = { banco: "Banco", rodri: "Rodri", jorge: "Jorge", efectivo: "Efectivo" };

  B.guardarGastoApp = function (s) {
    if (!s || typeof s !== "object") return Promise.reject(new Error("No se han recibido los datos del gasto."));
    var fecha = deIso(s.fechaIso);
    if (!fecha) return Promise.reject(new Error("La fecha del gasto no es válida."));
    var concepto = String(s.concepto || "").trim();
    var importe = numero(s.importe);
    if (!isFinite(importe) || importe === 0) return Promise.reject(new Error("Introduce un importe válido."));
    var metodo = METODOS_GASTO[norm(s.metodo).replace(/[^a-z]/g, "")] || "";
    if (!metodo) return Promise.reject(new Error("El método seleccionado no existe en GASTOS."));
    var iso = aIso(fecha), id = String(s.fila || "").trim();
    return sesion().then(function () { return B.obtenerOpcionesGastoApp(); }).then(function (o) {
      var categoria = o.categorias.filter(function (c) { return norm(c) === norm(s.categoria); })[0];
      if (!categoria) throw new Error("Selecciona una categoría válida.");
      var fila = { fecha: iso, concepto: concepto, categoria: categoria, importe: importe, iva: s.iva === true,
        metodo: metodo, notas: String(s.notas || "").trim() };
      var previo = id ? sb.from("gastos").select("id,fecha,importe,cierre_id").eq("id", id).limit(1)
        : Promise.resolve(null);
      return Promise.resolve(previo).then(function (p) {
        var op;
        if (id) {
          var actual = (comprobar(p) || [])[0];
          if (!actual) throw new Error("Ese gasto ya no existe. Actualiza la lista.");
          if (cierreBloquea(actual.cierre_id)) throw new Error("Este gasto ya está en el cierre de caja " + actual.cierre_id + " y no se puede modificar.");
          var orig = numero(s.importeOriginal);
          if ((String(s.fechaOriginal || "") && String(s.fechaOriginal) !== actual.fecha) ||
              (isFinite(orig) && Math.abs(orig - Number(actual.importe)) > 0.009))
            throw new Error("Ese gasto ha cambiado. Actualiza la lista antes de editarlo.");
          op = sb.from("gastos").update(fila).eq("id", id);
        } else op = sb.from("gastos").insert(fila);
        return op.then(function (x) {
          comprobar(x);
          return { correcto: true, fechaTexto: C.textoFecha(fecha), concepto: concepto, categoria: categoria,
            importe: importe, iva: fila.iva, metodo: metodo };
        });
      });
    });
  };

  B.borrarGastoApp = function (s) {
    var id = String(s && s.fila || "").trim();
    if (!id) return Promise.reject(new Error("No se ha indicado el gasto."));
    return sesion().then(function () {
      return sb.from("gastos").select("id,importe,cierre_id").eq("id", id).limit(1);
    }).then(function (r) {
      var g = (comprobar(r) || [])[0];
      if (!g) throw new Error("Ese gasto ya no existe.");
      if (cierreBloquea(g.cierre_id)) throw new Error("Este gasto ya está en el cierre de caja " + g.cierre_id + " y no se puede borrar.");
      var esp = numero(s.importe);
      if (isFinite(esp) && Math.abs(esp - Number(g.importe)) > 0.009)
        throw new Error("Ese gasto ha cambiado. Actualiza la lista antes de borrarlo.");
      return sb.from("gastos").delete().eq("id", id).then(function (x) { comprobar(x); return { correcto: true }; });
    });
  };

  /* ================= CAJAS PERSONALES ================= */
  function persona(p) { var t = norm(p); return t === "jorge" ? "Jorge" : t === "rodri" ? "Rodri" : ""; }
  function pertenece(metodo, p) { return norm(metodo).indexOf(norm(p)) >= 0; }

  function datosCajas() {
    return Promise.all([
      sb.from("cajas_personas_movimientos").select("num,fecha_hora,persona,tipo,importe,notas,id_solicitud")
        .order("num").range(0, 999),
      todo("pagos", "id,fecha,nombre_perro,importe,caja,cierre_id"),
      todo("gastos", "id,fecha,concepto,categoria,importe,metodo,cierre_id")
    ]).then(function (r) {
      return { control: comprobar(r[0]) || [], pagos: r[1], gastos: r[2] };
    });
  }
  function calcularCaja(nombre, d) {
    var movsP = d.control.filter(function (m) { return norm(m.persona) === norm(nombre); });
    var cortes = movsP.filter(function (m) { var t = norm(m.tipo); return t === "inicio" || t === "cierre"; });
    var ultimo = cortes[cortes.length - 1];
    var hoy0 = dia(new Date()).getTime();
    var desdeMs = ultimo ? new Date(ultimo.fecha_hora).getTime() + 1 : hoy0;
    var movs = [];
    d.pagos.forEach(function (p) {
      if (p.cierre_id || !p.nombre_perro || Number(p.importe) <= 0 || !pertenece(p.caja, nombre)) return;
      movs.push({ iso: p.fecha, tipo: "cobro", concepto: "Cobro · " + p.nombre_perro, importe: redondear(p.importe) });
    });
    d.gastos.forEach(function (g) {
      if (g.cierre_id || !g.concepto || Number(g.importe) === 0 || !pertenece(g.metodo, nombre)) return;
      movs.push({ iso: g.fecha, tipo: "gasto", concepto: "Gasto · " + (g.concepto || g.categoria || "Sin concepto"),
        importe: -redondear(g.importe) });
    });
    movsP.forEach(function (m) {
      if (norm(m.tipo) === "fondo" && new Date(m.fecha_hora).getTime() >= desdeMs) {
        movs.push({ iso: aIso(new Date(m.fecha_hora)), tipo: "fondo",
          concepto: "Fondo de caja" + (m.notas ? " · " + m.notas : ""),
          importe: Math.abs(redondear(m.importe)), filaControl: Number(m.num) + 1,
          idSolicitud: m.id_solicitud || "", notas: m.notas || "" });
      }
    });
    var desde = ultimo ? aIso(new Date(ultimo.fecha_hora)) : aIso(new Date());
    movs.forEach(function (m) { if (m.iso < desde) desde = m.iso; });
    var grupos = {};
    movs.forEach(function (m) {
      var g = grupos[m.iso] = grupos[m.iso] || { fechaIso: m.iso, fechaTexto: larga(deIso(m.iso)), total: 0, movimientos: [] };
      g.total += m.importe;
      g.movimientos.push({ tipo: m.tipo, concepto: m.concepto, importe: m.importe, filaControl: m.filaControl || 0,
        idSolicitud: m.idSolicitud || "", notas: m.notas || "" });
    });
    var dias = Object.keys(grupos).sort().reverse().map(function (k) { grupos[k].total = redondear(grupos[k].total); return grupos[k]; });
    return { persona: nombre, saldo: redondear(dias.reduce(function (s, x) { return s + x.total; }, 0)),
      desde: desde, dias: dias };
  }
  B.obtenerCajasPersonalesApp = function () {
    return sesion().then(datosCajas).then(function (d) {
      return { personas: ["Jorge", "Rodri"].map(function (p) { return calcularCaja(p, d); }) };
    });
  };
  function fondoProtegido(s) {
    var p = persona(s && s.persona), num = Number(s && s.fila) - 1;
    if (!p || !(num >= 1)) return Promise.reject(new Error("El movimiento de fondo no es válido."));
    return sb.from("cajas_personas_movimientos").select("id,persona,tipo,id_solicitud").eq("num", num).limit(1)
      .then(function (r) {
        var m = (comprobar(r) || [])[0];
        var id = String(s.idSolicitud || "").trim();
        if (!m || persona(m.persona) !== p || norm(m.tipo) !== "fondo" || (id && m.id_solicitud && id !== m.id_solicitud))
          throw new Error("El fondo ha cambiado. Cierra el panel y vuelve a abrirlo.");
        return m;
      });
  }
  B.registrarFondoCajaPersonaApp = function (s) {
    var p = persona(s && s.persona), importe = numero(s && s.importe);
    if (!p || !isFinite(importe) || importe <= 0) return Promise.reject(new Error("La persona o el importe no son válidos."));
    var idSol = String(s.idSolicitud || "").trim() || ("FONDO-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
    return sesion().then(function () {
      return sb.from("cajas_personas_movimientos").select("id").eq("id_solicitud", idSol).limit(1);
    }).then(function (r) {
      if ((comprobar(r) || []).length) return null;
      return sb.from("cajas_personas_movimientos").insert({ persona: p, tipo: "FONDO", importe: redondear(importe),
        notas: String(s.notas || "").trim(), id_solicitud: idSol }).then(comprobar);
    }).then(B.obtenerCajasPersonalesApp);
  };
  B.actualizarFondoCajaPersonaApp = function (s) {
    var importe = numero(s && s.importe);
    if (!isFinite(importe) || importe <= 0) return Promise.reject(new Error("Introduce un importe válido."));
    return sesion().then(function () { return fondoProtegido(s); }).then(function (m) {
      return sb.from("cajas_personas_movimientos").update({ importe: redondear(importe), notas: String(s.notas || "").trim() })
        .eq("id", m.id).then(comprobar);
    }).then(B.obtenerCajasPersonalesApp);
  };
  B.eliminarFondoCajaPersonaApp = function (s) {
    return sesion().then(function () { return fondoProtegido(s); }).then(function (m) {
      return sb.from("cajas_personas_movimientos").delete().eq("id", m.id).then(comprobar);
    }).then(B.obtenerCajasPersonalesApp);
  };
  B.cerrarCajaPersonaApp = function (s) {
    var p = persona(s && s.persona);
    if (!p) return Promise.reject(new Error("La persona no es válida."));
    var idSol = String(s.idSolicitud || "").trim() || ("CIERRE-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
    return sesion().then(function () {
      return sb.from("cajas_personas_movimientos").select("id").eq("id_solicitud", idSol).limit(1);
    }).then(function (r) {
      if ((comprobar(r) || []).length) return null;
      return datosCajas().then(function (d) {
        var caja = calcularCaja(p, d);
        var pendP = d.pagos.filter(function (x) { return !x.cierre_id && x.nombre_perro && Number(x.importe) > 0 && pertenece(x.caja, p); });
        var pendG = d.gastos.filter(function (x) { return !x.cierre_id && x.concepto && Number(x.importe) !== 0 && pertenece(x.metodo, p); });
        var hayFondos = caja.dias.some(function (dd) { return dd.movimientos.some(function (m) { return m.tipo === "fondo"; }); });
        if (!pendP.length && !pendG.length && !hayFondos) return null;
        return sb.from("cierres_caja").select("id").like("id", "CA-%").range(0, 999).then(function (c) {
          var max = 0;
          (comprobar(c) || []).forEach(function (x) { var n = parseInt(String(x.id).slice(3), 10); if (n > max) max = n; });
          var idCierre = "CA-" + ("0000" + (max + 1)).slice(-4);
          return sb.from("cierres_caja").insert({ id: idCierre, persona: p, fecha: aIso(new Date()), total: caja.saldo })
            .then(function (x) {
              comprobar(x);
              var ops = [];
              if (pendP.length) ops.push(sb.from("pagos").update({ cierre_id: idCierre }).in("id", pendP.map(function (x2) { return x2.id; })));
              if (pendG.length) ops.push(sb.from("gastos").update({ cierre_id: idCierre }).in("id", pendG.map(function (x2) { return x2.id; })));
              ops.push(sb.from("cajas_personas_movimientos").insert({ persona: p, tipo: "CIERRE", importe: caja.saldo,
                notas: "Cierre desde la app", id_solicitud: idSol }));
              return Promise.all(ops).then(function (rs) { rs.forEach(comprobar); });
            });
        });
      });
    }).then(B.obtenerCajasPersonalesApp);
  };

  /* ================= EVENTOS ================= */
  var TIPOS_EVENTO = ["Cumpleaños", "Cita", "ITV", "Pago", "Festivo", "Vacaciones", "Otro"];
  var ICONOS = { "Cumpleaños": "🎂", "Cita": "📅", "ITV": "🚐", "Pago": "💳", "Festivo": "🎉", "Vacaciones": "🏖️", "Otro": "📌" };
  var DIAS_MIN = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

  B.obtenerEventosApp = function () {
    return sesion().then(function () {
      return sb.from("eventos").select("id,tipo,fecha,titulo,perro_o_persona,notas,repeticion").range(0, 999);
    }).then(function (r) {
      var hoy = dia(new Date());
      return (comprobar(r) || []).map(function (e) {
        var base = deIso(String(e.fecha || "").slice(0, 10));
        if (!e.id || !base) return null;
        var tipo = e.tipo || "Otro", rep = e.repeticion || "No repetir", prox = new Date(base);
        if (rep === "Cada año" || tipo === "Cumpleaños") {
          var ano = hoy.getFullYear();
          var ult = new Date(ano, base.getMonth() + 1, 0).getDate();
          prox = new Date(ano, base.getMonth(), Math.min(base.getDate(), ult));
          if (prox < hoy) {
            ult = new Date(ano + 1, base.getMonth() + 1, 0).getDate();
            prox = new Date(ano + 1, base.getMonth(), Math.min(base.getDate(), ult));
          }
        }
        if (prox < hoy) return null;
        var edad = tipo === "Cumpleaños" && base.getFullYear() < prox.getFullYear() ? prox.getFullYear() - base.getFullYear() : 0;
        var titulo = e.titulo || "Evento";
        return { id: e.id, tipo: tipo, fechaBaseIso: aIso(base), fechaProximaIso: aIso(prox),
          fechaTexto: C.textoFecha(prox),
          fechaCorta: DIAS_MIN[prox.getDay()] + " " + prox.getDate() + "/" + MESES[prox.getMonth()].toLowerCase() + "/" + prox.getFullYear(),
          titulo: titulo, tituloMostrar: titulo + (edad > 0 ? " · " + edad + (edad === 1 ? " año" : " años") : ""),
          persona: e.perro_o_persona || "", notas: e.notas || "", repeticion: rep,
          icono: ICONOS[tipo] || "📌", orden: prox.getTime() };
      }).filter(Boolean).sort(function (a, b) { return a.orden - b.orden || a.titulo.localeCompare(b.titulo); });
    });
  };
  B.guardarEventoApp = function (d) {
    var tipo = String(d && d.tipo || "").trim(), titulo = String(d && d.titulo || "").trim();
    var fecha = deIso(d && d.fecha), persona2 = String(d && d.persona || "").trim(), notas = String(d && d.notas || "").trim();
    var rep = String(d && d.repeticion || "No repetir").trim() === "Cada año" ? "Cada año" : "No repetir";
    var id = String(d && d.id || "").trim();
    if (TIPOS_EVENTO.indexOf(tipo) < 0) return Promise.reject(new Error("Selecciona un tipo de evento válido."));
    if (!fecha) return Promise.reject(new Error("Selecciona una fecha válida."));
    if (!titulo) return Promise.reject(new Error("Escribe el título del evento."));
    if (titulo.length > 100 || persona2.length > 100 || notas.length > 500)
      return Promise.reject(new Error("El texto del evento es demasiado largo."));
    var fila = { tipo: tipo, fecha: aIso(fecha) + "T00:00:00", titulo: titulo, perro_o_persona: persona2, notas: notas,
      repeticion: tipo === "Cumpleaños" ? "Cada año" : rep, actualizado_en: new Date().toISOString() };
    return sesion().then(function () {
      if (id) {
        return sb.from("eventos").update(fila).eq("id", id).select("id").then(function (r) {
          if (!(comprobar(r) || []).length) throw new Error("El evento ya no existe o fue eliminado.");
          return { ok: true, id: id };
        });
      }
      return sb.from("eventos").insert(fila).select("id").then(function (r) {
        return { ok: true, id: (comprobar(r) || [])[0].id };
      });
    });
  };
  B.eliminarEventoApp = function (id) {
    var limpio = String(id || "").trim();
    if (!limpio) return Promise.reject(new Error("No se ha indicado el evento."));
    return sesion().then(function () {
      return sb.from("eventos").delete().eq("id", limpio).select("id");
    }).then(function (r) {
      if (!(comprobar(r) || []).length) throw new Error("El evento ya no existe.");
      return { ok: true };
    });
  };
})();
