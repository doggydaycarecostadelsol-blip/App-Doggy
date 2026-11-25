/* Doggy Day Care · módulo REGISTRO (clientes y perros) + acceso a FACTURAS.
 * Sustituye a la app de Apps Script «Doggy Day Care - Registro».
 * Lee y escribe en las tablas clientes, perros (y auditoria) de Supabase.
 * Expone window.DoggyVistas.{abrir(modulo), cerrar()} para la cabecera y la navegación.
 */
(function () {
  "use strict";
  var C = window.DoggyCore;
  var sb = C.sb, comprobar = C.comprobar, norm = C.norm;

  /* Nombres de los recorridos (la base guarda 1 o 2). */
  var RUTAS = { 1: "Ruta Marbella", 2: "Ruta Cancelada" };
  var DIAS = ["L", "M", "X", "J", "V"];

  var estado = {
    modulo: null, tab: "perros", q: "", bajas: false, cargado: false,
    clientes: [], perros: [], periodos: [], servicios: [], alta: null
  };

  /* ---------- utilidades ---------- */
  function pata(px) {
    return '<svg class="rg-pata" width="' + px + '" height="' + px + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><ellipse cx=\'5\' cy=\'11\' rx=\'2.1\' ry=\'2.8\'/><ellipse cx=\'9.5\' cy=\'6\' rx=\'2.2\' ry=\'3\'/><ellipse cx=\'14.5\' cy=\'6\' rx=\'2.2\' ry=\'3\'/><ellipse cx=\'19\' cy=\'11\' rx=\'2.1\' ry=\'2.8\'/><path d=\'M12 11.5c-3 0-6 3.2-6 6 0 2 1.6 3 3.2 3 1.2 0 1.8-.6 2.8-.6s1.6.6 2.8.6c1.6 0 3.2-1 3.2-3 0-2.8-3-6-6-6z\'/></svg>';
  }
  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function activo(x) { return norm(x.estado) === "activo" && !(x.fecha_baja_servicio && x.fecha_baja_servicio <= hoyIso()); }
  function rotuloEstado(x, esPerro) { return activo(x) ? "ACTIVO" : (esPerro ? "INACTIVO" : String(x.estado || "").toUpperCase()); }
  function fmtFecha(iso) { return iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : ""; }
  function hoyIso() { return C.aIso(new Date()); }
  function porNombre(a, b) { return norm(a).localeCompare(norm(b), "es"); }
  function $(id) { return document.getElementById(id); }
  function vacioNull(v) { v = String(v == null ? "" : v).trim(); return v === "" ? null : v; }

  function aviso(texto, error) {
    var t = document.createElement("div");
    t.className = "rg-aviso" + (error ? " rg-aviso-error" : "");
    t.textContent = texto;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, error ? 5200 : 2800);
  }

  /* ---------- estilos ---------- */
  var CSS = [
    /* cabecera clara: tres botones iguales (Gestión, Registro, Facturas) */
    ".cabecera{display:grid!important;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;background:#fff!important;border-bottom:1px solid #d6deee!important;padding:0 10px 0 0!important;backdrop-filter:none!important;}",
    ".cab-modulos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));min-width:0;}",
    ".cab-modulo{display:flex;align-items:center;justify-content:center;height:58px;padding:0 10px;border:0;border-bottom:3px solid transparent;background:#fff;cursor:pointer;min-width:0;}",
    ".cab-modulo img{display:block;width:100%;max-width:150px;max-height:38px;object-fit:contain;}",
    ".cab-modulo.activo{border-bottom-color:#12299a;background:#f2f6ff;}",
    ".cab-modulo:focus-visible{outline:3px solid #2f6bff;outline-offset:-3px;}",
    ".cabecera .cabecera-acciones{gap:6px;}",
    ".cabecera .boton-icono{background:#eef2fb;border:1px solid #d6deee;color:#0b2a6f;}",
    ".cabecera .boton-instalar{background:#e8f0ff;border-color:#9db8f0;color:#0b2a6f;font-size:0;padding:0 11px;}",
    ".cabecera .boton-instalar::before{content:'⬇️';font-size:15px;}",
    "@media(min-width:760px){.cabecera{padding:0 28px!important;}.cabecera .boton-instalar{font-size:12px;}.cabecera .boton-instalar::before{content:none;}.cab-modulos{max-width:760px;}.cab-modulo{height:64px;}}",

    /* vistas: estilo claro del Registro original */
    ".rg-vista{--fondo:#f3f6fc;--tarjeta:#fff;--borde:#d6deee;--texto:#0f1d45;--suave:#5b6a8c;--azul:#12299a;padding:18px 14px 110px;min-height:100vh;background:var(--fondo);color:var(--texto);}",
    ".rg-vista[hidden]{display:none;}",
    ".rg-wrap{max-width:900px;margin:0 auto;}",
    ".rg-titulo{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px;}",
    ".rg-titulo h2{font-size:26px;color:var(--texto);margin:0;}",
    ".rg-titulo p{color:var(--suave);font-size:13px;margin-top:4px;}",
    ".rg-botones{display:flex;gap:8px;flex-wrap:wrap;}",
    ".rg-btn{min-height:42px;padding:0 16px;border-radius:10px;border:1px solid var(--azul);background:#fff;color:var(--azul);font-size:14px;font-weight:800;cursor:pointer;}",
    ".rg-btn:hover{background:#eef2ff;}",
    ".rg-btn.principal{background:var(--azul);border-color:var(--azul);color:#fff;}",
    ".rg-btn.principal:hover{background:#0d1f7a;}",
    ".rg-btn.peligro{border-color:#e7a3a3;color:#b42318;background:#fff3f2;}",
    ".rg-btn:disabled{opacity:.5;cursor:not-allowed;}",
    ".rg-btn:focus-visible,.rg-tab:focus-visible,.rg-item:focus-visible{outline:3px solid #2f6bff;outline-offset:2px;}",
    ".rg-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;}",
    ".rg-stat{padding:12px;border-radius:12px;background:var(--tarjeta);border:1px solid var(--borde);}",
    ".rg-stat span{display:block;color:var(--suave);font-size:12px;font-weight:700;}",
    ".rg-stat strong{display:block;margin-top:4px;font-size:26px;color:var(--azul);}",
    ".rg-stat.aviso{background:#fff7e0;border-color:#efd58a;}.rg-stat.aviso strong{color:#9a6a00;}",
    ".rg-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;}",
    ".rg-tab{min-height:44px;border-radius:10px;border:1px solid var(--borde);background:#fff;color:var(--texto);font-weight:800;font-size:14px;cursor:pointer;}",
    ".rg-tab.activo{border:2px solid var(--azul);background:#eef2ff;color:var(--azul);}",
    ".rg-buscar{display:block;margin-bottom:10px;}",
    ".rg-buscar span,.rg-campo>span{display:block;margin:0 0 5px;color:var(--texto);font-size:12px;font-weight:800;}",
    ".rg-vista input,.rg-vista select,.rg-vista textarea{width:100%;padding:12px 13px;border:1px solid #c3cde3;border-radius:8px;background:#fff;color:var(--texto);font-size:16px;font-family:inherit;}",
    ".rg-vista input::placeholder,.rg-vista textarea::placeholder{color:#8a97b4;}",
    ".rg-vista input:focus,.rg-vista select:focus,.rg-vista textarea:focus{outline:2px solid #2f6bff;outline-offset:0;border-color:#2f6bff;}",
    ".rg-vista input[type=checkbox]{width:auto;}",
    ".rg-cuenta{display:flex;justify-content:space-between;align-items:center;margin:4px 0 10px;color:var(--suave);font-size:13px;font-weight:700;}",
    ".rg-cuenta label{display:flex;align-items:center;gap:6px;cursor:pointer;}",
    ".rg-lista{display:grid;gap:8px;}",
    "@media(min-width:760px){.rg-lista{grid-template-columns:1fr 1fr;}.rg-vista{padding:24px 28px 110px;}}",
    ".rg-item{display:flex;align-items:center;gap:11px;width:100%;padding:12px;border-radius:10px;border:1px solid var(--borde);background:#fff;color:var(--texto);text-align:left;cursor:pointer;}",
    ".rg-item:hover{border-color:#8da2d9;background:#fafcff;}",
    ".rg-avatar{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:8px;background:#eaf0ff;color:var(--azul);font-weight:900;font-size:14px;}",
    ".rg-item-txt{min-width:0;flex:1;}",
    ".rg-item-txt strong{display:flex;align-items:center;gap:7px;font-size:15px;color:var(--texto);}",
    ".rg-item-txt small.rg-item-plan{color:var(--azul);font-weight:600;}",
    ".rg-item-txt small.rg-item-plan b{font-weight:800;}",
    ".rg-item-txt small{display:block;margin-top:3px;color:var(--suave);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".rg-chip{display:inline-block;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:900;background:#dff5e6;color:#13703a;}",
    ".rg-chip.baja{background:#fde4e4;color:#a31d1d;}",
    ".rg-chip.falta{background:#fff1cc;color:#8a5a00;}",
    ".rg-pata{display:block;}",
    ".rg-tabicono{display:inline-flex;vertical-align:-2px;margin-right:6px;}",
    ".rg-flecha{color:var(--azul);font-size:20px;}",
    ".rg-vacio{padding:30px 12px;text-align:center;color:var(--suave);}",

    /* formularios */
    ".rg-volver{margin:0 0 14px;}",
    ".rg-panel{padding:16px;border-radius:12px;border:1px solid var(--borde);background:var(--tarjeta);margin-bottom:14px;}",
    ".rg-panel h3{font-size:17px;color:var(--texto);margin:0 0 4px;display:flex;align-items:center;gap:10px;}",
    ".rg-num{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;background:var(--azul);color:#fff;font-size:13px;font-weight:900;flex:0 0 auto;}",
    ".rg-panel>p,.rg-panel-cab p{color:var(--suave);font-size:12px;margin-bottom:12px;}",
    ".rg-panel-cab{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px;}",
    ".rg-grid{display:grid;gap:12px;}",
    "@media(min-width:620px){.rg-grid.dos{grid-template-columns:1fr 1fr;}.rg-grid .ancho{grid-column:1/-1;}}",
    ".rg-dias{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;}",
    ".rg-dia{min-height:44px;border-radius:8px;border:1px solid #c3cde3;background:#fff;color:var(--texto);font-weight:900;cursor:pointer;}",
    ".rg-dia.on{background:var(--azul);border-color:var(--azul);color:#fff;}",
    ".rg-orden{max-height:150px;overflow:auto;padding:6px 10px;border:1px solid #c3cde3;border-radius:8px;background:#fafcff;font-size:13px;}",
    ".rg-orden.alto{max-height:340px;}",
    ".rg-orden.previstos b{width:auto;min-width:92px;}",
    ".rg-orden div.nuevo{background:#dff5e6;color:#13703a;font-weight:800;border-radius:6px;padding-left:6px;}",
    ".rg-orden div.nuevo b{color:#13703a;}",
    ".rg-check{display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:800;color:var(--texto);}",
    ".rg-check input{width:22px;height:22px;}",
    ".rg-orden div{display:flex;gap:10px;padding:4px 0;border-bottom:1px solid #e3e9f6;color:var(--texto);}",
    ".rg-orden div:last-child{border:0;}.rg-orden b{width:22px;color:var(--azul);}",
    ".rg-perro-bloque{padding:14px;border-radius:10px;border:1px solid var(--borde);background:#f8faff;margin-top:10px;}",
    ".rg-perro-bloque>header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}",
    ".rg-perro-bloque>header strong{color:var(--azul);}",
    ".rg-obl{color:#c0261b;}",
    ".rg-err{margin:10px 0;padding:10px 12px;border-radius:8px;background:#fde8e8;color:#9b1c1c;font-size:13px;font-weight:700;border:1px solid #f3b8b8;}",
    ".rg-err ul{margin:4px 0 0 18px;}",
    ".rg-btn[hidden]{display:none!important;}",
    ".rg-acciones-top{justify-content:flex-start;margin:0 0 12px;}",
    ".rg-ficha-lectura input:disabled,.rg-ficha-lectura select:disabled,.rg-ficha-lectura textarea:disabled{background:#f4f6fb;color:var(--texto);opacity:1;-webkit-text-fill-color:var(--texto);}",
    ".rg-ficha-lectura .rg-dia:disabled{opacity:.8;cursor:default;}",
    ".rg-acciones{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:6px;}",
    ".rg-resumen dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:14px;}",
    ".rg-resumen dt{color:var(--suave);}.rg-resumen dd{color:var(--texto);font-weight:700;margin:0;}",
    ".rg-aviso{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:99998;max-width:92vw;padding:12px 18px;border-radius:10px;background:#15803d;color:#fff;font-weight:800;font-size:14px;box-shadow:0 10px 30px rgba(0,0,0,.3);}",
    ".rg-aviso-error{background:#b91c1c;}",
    "nav.navegacion-inferior.rg-oculta{display:none!important;}",
    "#vistaRegistroApp{padding-bottom:30px;}",
    "#vistaFacturasApp{padding:0;min-height:0;}",
    ".rg-facturas-frame{display:block;width:100%;height:calc(100vh - 70px);height:calc(100dvh - 70px);border:0;background:#fff;}",
    ".rg-facturas{display:flex;flex-direction:column;align-items:center;gap:14px;padding-top:40px;text-align:center;color:#5b6a8c;}",
    ".rg-facturas img{width:min(340px,80vw);}",
    ".rg-facturas h2{color:#0f1d45;font-size:22px;}"
  ].join("\n");

  function inyectarEstilos() {
    var s = document.createElement("style");
    s.id = "estilos-registro";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- cabecera ---------- */
  function montarCabecera() {
    var cab = document.querySelector("header.cabecera");
    if (!cab || cab.querySelector(".cab-modulos")) return;
    var marca = cab.querySelector(".marca");
    if (marca) marca.remove();
    var mod = document.createElement("nav");
    mod.className = "cab-modulos";
    mod.setAttribute("aria-label", "Módulos");
    mod.innerHTML =
      '<button type="button" class="cab-modulo" data-modulo="gestion" aria-label="Gestión (inicio)"><img src="logo-gestion.png" alt="Gestión"></button>' +
      '<button type="button" class="cab-modulo" data-modulo="registro" aria-label="Registro"><img src="logo-registro.png" alt="Registro"></button>' +
      '<button type="button" class="cab-modulo" data-modulo="facturas" aria-label="Facturas"><img src="logo-facturas.png" alt="Facturas"></button>';
    cab.insertBefore(mod, cab.firstChild);
    mod.addEventListener("click", function (e) {
      var b = e.target.closest(".cab-modulo");
      if (!b) return;
      if (b.dataset.modulo === "gestion") { volverInicio(); return; }
      if (estado.modulo === b.dataset.modulo) return;
      abrir(b.dataset.modulo);
    });
    marcarModulo();
  }

  /* Facturas es una app aparte (Google Apps Script): se muestra dentro de esta misma app, en un iframe */
  function montarFacturas() {
    var cont = $("vistaFacturasApp");
    if (!cont || cont.querySelector("iframe")) return;
    var url = (window.DOGGY_CONFIG && window.DOGGY_CONFIG.FACTURAS_URL) || "";
    if (!url) {
      cont.innerHTML = '<div class="rg-facturas"><img src="logo-facturas.png" alt="Facturas"><h2>Facturas</h2><p>Falta poner la dirección de la app de Facturas en config.js (FACTURAS_URL).</p></div>';
      return;
    }
    cont.innerHTML = '<iframe class="rg-facturas-frame" title="Facturas" src="' + url + '" allow="camera; microphone; clipboard-write; fullscreen"></iframe>';
  }

  function marcarModulo() {
    /* la navegación inferior (Inicio/Historial/Eventos) solo se ve en Gestión */
    var navInf = document.querySelector("nav.navegacion-inferior");
    if (navInf) navInf.classList.toggle("rg-oculta", !!estado.modulo);
    document.querySelectorAll(".cab-modulo").forEach(function (b) {
      var on = b.dataset.modulo === (estado.modulo || "gestion");
      b.classList.toggle("activo", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
  }

  /* ---------- vistas ---------- */
  function montarVistas() {
    var app = document.querySelector(".app");
    var nav = document.querySelector("nav.navegacion-inferior");
    ["vistaRegistroApp", "vistaFacturasApp"].forEach(function (id) {
      var s = document.createElement("section");
      s.id = id; s.className = "rg-vista"; s.hidden = true;
      app.insertBefore(s, nav);
    });
  }

  function ocultarResto() {
    var principal = document.querySelector("main.contenido");
    var hist = $("vistaHistorialApp");
    if (principal) principal.hidden = true;
    if (hist) hist.hidden = true;
  }

  function abrir(modulo) {
    ocultarResto();
    estado.modulo = modulo;
    $("vistaRegistroApp").hidden = modulo !== "registro";
    $("vistaFacturasApp").hidden = modulo !== "facturas";
    document.querySelectorAll(".nav-item").forEach(function (b) {
      b.classList.remove("activo"); b.removeAttribute("aria-current");
    });
    marcarModulo();
    if (modulo === "registro") { pintarLista(); cargar(); }
    if (modulo === "facturas") montarFacturas();
    window.scrollTo({ top: 0 });
  }

  function cerrar() {
    estado.modulo = null;
    var a = $("vistaRegistroApp"), b = $("vistaFacturasApp");
    if (a) a.hidden = true;
    if (b) b.hidden = true;
    marcarModulo();
  }

  function volverInicio() {
    cerrar();
    var principal = document.querySelector("main.contenido");
    if (principal) principal.hidden = false;
    var inicio = document.querySelector(".nav-item");
    if (inicio) { document.querySelectorAll(".nav-item").forEach(function (b) { b.classList.remove("activo"); }); inicio.classList.add("activo"); }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- datos ---------- */
  function cargar(forzar) {
    if (estado.cargado && !forzar) return Promise.resolve();
    return C.asegurarSesion().then(function () {
      return Promise.all([
        sb.from("clientes").select("*").order("nombre_completo").range(0, 999),
        sb.from("perros").select("*").order("nombre").range(0, 999),
        sb.from("periodos").select("nombre,indice,inicio,fin").order("indice"),
        sb.from("servicios").select("nombre,precio,activo")
      ]);
    }).then(function (r) {
      estado.clientes = comprobar(r[0]) || [];
      estado.perros = comprobar(r[1]) || [];
      estado.periodos = comprobar(r[2]) || [];
      estado.servicios = comprobar(r[3]) || [];
      estado.cargado = true;
      if (estado.modulo === "registro" && !estado.alta && !estado.ficha) pintarLista();
    }).catch(function (e) {
      aviso("No se pudieron cargar los datos: " + e.message, true);
    });
  }

  function clienteDe(p) {
    for (var i = 0; i < estado.clientes.length; i++) if (estado.clientes[i].id === p.cliente_id) return estado.clientes[i];
    return null;
  }
  function perrosDe(c) { return estado.perros.filter(function (p) { return p.cliente_id === c.id; }); }
  function fichaIncompleta(c) { return !vacioNull(c.telefono_whatsapp); }

  /* ---------- lista ---------- */
  function raiz() { return $("vistaRegistroApp"); }

  function pintarLista() {
    estado.ficha = null; estado.alta = null;
    var cl = estado.clientes, pe = estado.perros;
    var pendientes = cl.filter(function (c) { return activo(c) && fichaIncompleta(c); }).length;
    raiz().innerHTML =
      '<div class="rg-wrap">' +
      '<div class="rg-titulo"><div><h2>Clientes y perros</h2><p>Consulta las fichas o prepara una nueva alta.</p></div>' +
      '<div class="rg-botones"><button class="rg-btn" id="rgActualizar" type="button">↻ Actualizar</button>' +
      '<button class="rg-btn principal" id="rgNueva" type="button">+ Nueva alta</button></div></div>' +
      '<div class="rg-stats">' +
      '<div class="rg-stat"><span>Clientes</span><strong>' + cl.filter(activo).length + "</strong></div>" +
      '<div class="rg-stat"><span>Perros</span><strong>' + pe.filter(activo).length + "</strong></div>" +
      '<div class="rg-stat' + (pendientes ? " aviso" : "") + '"><span>Fichas por completar</span><strong>' + pendientes + "</strong></div></div>" +
      '<div class="rg-tabs" role="tablist">' +
      '<button class="rg-tab' + (estado.tab === "perros" ? " activo" : "") + '" data-tab="perros" role="tab"><span class="rg-tabicono">' + pata(16) + '</span>Perros</button>' +
      '<button class="rg-tab' + (estado.tab === "clientes" ? " activo" : "") + '" data-tab="clientes" role="tab">Clientes</button></div>' +
      '<label class="rg-buscar"><span>' + (estado.tab === "perros" ? "Buscar perro o propietario" : "Buscar cliente o perro") + "</span>" +
      '<input id="rgBuscar" type="search" autocomplete="off" placeholder="' + (estado.tab === "perros" ? "Nombre del perro o propietario" : "Nombre, perro, teléfono o localidad") + '" value="' + esc(estado.q) + '"></label>' +
      '<div class="rg-cuenta"><span id="rgCuenta"></span><label><input type="checkbox" id="rgBajas"' + (estado.bajas ? " checked" : "") + "> Mostrar bajas</label></div>" +
      '<div class="rg-lista" id="rgLista"></div></div>';

    $("rgActualizar").onclick = function () { cargar(true).then(function () { aviso("Datos actualizados"); }); };
    $("rgNueva").onclick = function () { nuevaAlta(); };
    $("rgBuscar").oninput = function () { estado.q = this.value; pintarItems(); };
    $("rgBajas").onchange = function () { estado.bajas = this.checked; pintarItems(); };
    raiz().querySelectorAll(".rg-tab").forEach(function (b) {
      b.onclick = function () { estado.tab = b.dataset.tab; pintarLista(); };
    });
    pintarItems();
  }

  /* importe diario y días de recogida de un perro, para la tarjeta */
  function importePerro(p) {
    var n = parseFloat(p.precio_interno);
    if (isNaN(n)) return "Sin importe";
    return n.toLocaleString("es-ES", { maximumFractionDigits: 2 }) + " €/día";
  }
  function diasPerro(p) {
    var d = p.dias_contratados || [];
    return d.length ? d.join(" ") : "Ocasional";
  }

  function pintarItems() {
    var q = norm(estado.q), html = "", n = 0;
    if (estado.tab === "perros") {
      var lista = estado.perros.filter(function (p) {
        if (!estado.bajas && !activo(p)) return false;
        var c = clienteDe(p);
        return !q || norm(p.nombre + " " + (p.nombre_config || "") + " " + (c ? c.nombre_completo : "")).indexOf(q) >= 0;
      }).sort(function (a, b) { return porNombre(a.nombre, b.nombre); });
      n = lista.length;
      html = lista.map(function (p) {
        var c = clienteDe(p);
        return '<button type="button" class="rg-item" data-tipo="perro" data-id="' + p.id + '">' +
          '<span class="rg-avatar" aria-hidden="true">' + pata(20) + '</span><span class="rg-item-txt"><strong>' + esc(p.nombre) +
          (activo(p) ? '<span class="rg-chip">ACTIVO</span>' : '<span class="rg-chip baja">' + esc(rotuloEstado(p, true)) + "</span>") + "</strong>" +
          "<small>Cliente: " + esc(c ? c.nombre_completo : "—") + '</small>' +
          '<small class="rg-item-plan"><b>' + esc(diasPerro(p)) + "</b> · " + esc(importePerro(p)) + '</small></span><span class="rg-flecha">›</span></button>';
      }).join("");
    } else {
      var lc = estado.clientes.filter(function (c) {
        if (!estado.bajas && !activo(c)) return false;
        var perros = perrosDe(c).map(function (p) { return p.nombre; }).join(" ");
        return !q || norm([c.nombre_completo, c.nombre_config, c.telefono_whatsapp, c.localidad, perros].join(" ")).indexOf(q) >= 0;
      }).sort(function (a, b) { return porNombre(a.nombre_completo, b.nombre_completo); });
      n = lc.length;
      html = lc.map(function (c) {
        var ps = perrosDe(c).map(function (p) { return p.nombre; }).join(", ");
        var det = [c.telefono_whatsapp, c.localidad].filter(Boolean).join(" · ");
        return '<button type="button" class="rg-item" data-tipo="cliente" data-id="' + c.id + '">' +
          '<span class="rg-avatar" aria-hidden="true">' + esc((c.nombre_completo || "?").charAt(0).toUpperCase()) + '</span><span class="rg-item-txt"><strong>' + esc(c.nombre_completo) +
          (activo(c) ? '<span class="rg-chip">ACTIVO</span>' : '<span class="rg-chip baja">' + esc(c.estado) + "</span>") +
          (fichaIncompleta(c) ? '<span class="rg-chip falta">SIN TELÉFONO</span>' : "") + "</strong>" +
          "<small>" + esc(det || "Sin teléfono ni localidad") + (ps ? " — " + esc(ps) : "") + '</small></span><span class="rg-flecha">›</span></button>';
      }).join("");
    }
    $("rgCuenta").textContent = n + (estado.tab === "perros" ? (n === 1 ? " perro" : " perros") : (n === 1 ? " cliente" : " clientes"));
    $("rgLista").innerHTML = html || '<div class="rg-vacio">' + (estado.cargado ? "No hay resultados." : "Cargando…") + "</div>";
    $("rgLista").querySelectorAll(".rg-item").forEach(function (b) {
      b.onclick = function () { abrirFicha(b.dataset.tipo, b.dataset.id); };
    });
  }

  /* ---------- ficha (ver y editar) ---------- */
  var CAMPOS_CLIENTE = [
    ["nombre_completo", "Nombre completo", "text", true], ["telefono_whatsapp", "Teléfono / WhatsApp", "tel"],
    ["telefono_alternativo", "Teléfono alternativo", "tel"], ["email", "Correo electrónico", "email"],
    ["direccion", "Dirección", "text", false, true], ["codigo_postal", "Código postal", "text"], ["localidad", "Localidad", "text"],
    ["tipo_documento", "Tipo de documento", "text"], ["numero_documento", "Documento", "text"], ["idioma", "Idioma", "text"],
    ["contacto_emergencia_nombre", "Contacto de emergencia", "text"], ["contacto_emergencia_telefono", "Teléfono de emergencia", "tel"],
    ["contacto_emergencia_relacion", "Relación con el cliente", "text"], ["metodo_recogida", "Método de recogida", "text"],
    ["instrucciones_recogida", "Instrucciones de recogida", "textarea", false, true]
  ];
  var CAMPOS_PERRO = [
    ["nombre", "Nombre del perro", "text", true], ["identificador", "Identificador", "text"],
    ["sexo", "Sexo", "sexo"], ["raza", "Raza", "text"],
    ["fecha_nacimiento", "Fecha de nacimiento", "date"], ["microchip", "Microchip", "text"],
    ["fecha_inicio_servicio", "Fecha de inicio", "date"], ["precio_interno", "Precio interno por día (€)", "number"],
    ["tipo_planificacion", "Planificación", "plan"], ["ruta", "Ruta", "ruta"],
    ["_ordenhojas", "", "ordenhojas"],
    ["alergias_intolerancias", "Alergias / intolerancias", "text"], ["enfermedades_lesiones", "Enfermedades o lesiones", "text"],
    ["medicacion", "Medicación", "text"], ["comportamiento", "Comportamiento", "text"],
    ["observaciones", "Observaciones", "textarea", false, true]
  ];

  function opcionesSexo(v) {
    return ["", "Macho", "Hembra"].map(function (o) { return '<option value="' + o + '"' + (o === (v || "") ? " selected" : "") + ">" + (o || "Sin indicar") + "</option>"; }).join("");
  }
  function opcionesPlan(v) {
    var cur = norm(v) === "ocasional" ? "OCASIONAL" : "FIJO";
    return [["FIJO", "Días fijos"], ["OCASIONAL", "Ocasional"]].map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === cur ? " selected" : "") + ">" + o[1] + "</option>";
    }).join("");
  }
  function opcionesRuta(v) {
    return Object.keys(RUTAS).map(function (k) { return '<option value="' + k + '"' + (Number(v) === Number(k) ? " selected" : "") + ">" + esc(RUTAS[k]) + "</option>"; }).join("");
  }

  function campoHtml(def, valor, prefijo) {
    var id = prefijo + def[0], t = def[2], v = valor == null ? "" : valor, cls = "rg-campo" + (def[4] ? " ancho" : "");
    var ob = def[3] ? ' <b class="rg-obl">*</b>' : "";
    var ctl;
    if (t === "sexo") ctl = '<select id="' + id + '">' + opcionesSexo(v) + "</select>";
    else if (t === "plan") ctl = '<select id="' + id + '">' + opcionesPlan(v) + "</select>";
    else if (t === "ruta") ctl = '<select id="' + id + '">' + opcionesRuta(v) + "</select>";
    else if (t === "textarea") ctl = '<textarea id="' + id + '" rows="3">' + esc(v) + "</textarea>";
    else if (t === "number") ctl = '<input id="' + id + '" type="number" step="0.01" inputmode="decimal" value="' + esc(v) + '">';
    else ctl = '<input id="' + id + '" type="' + t + '" value="' + esc(v) + '">';
    return '<label class="' + cls + '"><span>' + esc(def[1]) + ob + "</span>" + ctl + "</label>";
  }

  function diasHtml(sel, id) {
    return '<div class="rg-dias" id="' + id + '">' + DIAS.map(function (d) {
      var on = (sel || []).indexOf(d) >= 0;
      return '<button type="button" class="rg-dia' + (on ? " on" : "") + '" data-dia="' + d + '" aria-pressed="' + on + '">' + d + "</button>";
    }).join("") + "</div>";
  }
  function ligarDias(contenedor) {
    contenedor.querySelectorAll(".rg-dia").forEach(function (b) {
      b.onclick = function () { b.classList.toggle("on"); b.setAttribute("aria-pressed", b.classList.contains("on")); };
    });
  }
  function leerDias(contenedor) {
    return Array.prototype.map.call(contenedor.querySelectorAll(".rg-dia.on"), function (b) { return b.dataset.dia; });
  }

  /* La ficha se abre en modo lectura; «Editar» habilita los campos. */
  function modoEdicion(on) {
    raiz().querySelectorAll('.rg-ficha-lectura input, .rg-ficha-lectura select, .rg-ficha-lectura textarea, .rg-ficha-lectura .rg-dia')
      .forEach(function (el) { el.disabled = !on; });
    estado.fichaEdit = on;
    var ps = $("rgPasSel"); if (ps) ps.style.display = on ? "" : "none";
    $("rgEditarFicha").hidden = on;
    $("rgGuardarFicha").hidden = !on;
    $("rgCancelarEdicion").hidden = !on;
    $("rgEstado").hidden = on;
    if (on) { var pb = $("rgBajaPanel"); if (pb) pb.innerHTML = ""; }
  }

  function abrirFicha(tipo, id) {
    var obj = (tipo === "perro" ? estado.perros : estado.clientes).filter(function (x) { return x.id === id; })[0];
    if (!obj) return;
    estado.ficha = { tipo: tipo, id: id }; estado.pasaporteNuevo = null;
    var esPerro = tipo === "perro";
    var cli = esPerro ? clienteDe(obj) : obj;
    var campos = esPerro ? CAMPOS_PERRO : CAMPOS_CLIENTE;
    var html = '<div class="rg-wrap"><button class="rg-btn rg-volver" id="rgVolver" type="button">← Volver al listado</button>' +
      '<div class="rg-titulo"><div><h2>' + esc(esPerro ? obj.nombre : obj.nombre_completo) + "</h2><p>" +
      (esPerro ? "Cliente: " + esc(cli ? cli.nombre_completo : "—") : "Ficha de cliente") + " · " +
      (activo(obj) ? "Activo" + (esPerro && obj.fecha_baja_servicio ? " · baja programada " + fmtFecha(obj.fecha_baja_servicio) : "")
        : (esPerro ? "Inactivo" + (obj.fecha_baja_servicio ? " desde " + fmtFecha(obj.fecha_baja_servicio) : "") : esc(obj.estado))) + "</p></div></div>" +
      '<div class="rg-acciones rg-acciones-top">' +
      '<button class="rg-btn" id="rgEditarFicha" type="button">✎ Editar</button>' +
      '<button class="rg-btn principal" id="rgGuardarFicha" type="button" hidden>Guardar cambios</button>' +
      '<button class="rg-btn" id="rgCancelarEdicion" type="button" hidden>Cancelar</button>' +
      '<button class="rg-btn ' + (activo(obj) ? "peligro" : "") + '" id="rgEstado" type="button">' + (activo(obj) ? "Dar de baja" : "Reactivar") + "</button></div>" +
      '<div id="rgBajaPanel"></div><div id="rgErrFicha"></div>' +
      '<div class="rg-panel rg-ficha-lectura"><div class="rg-grid dos">' +
      campos.map(function (d) {
        var v = obj[d[0]];
        if (d[0] === "tipo_planificacion" && !v) v = "FIJO";
        if (d[2] === "ordenhojas") return fichaOrdenHtml(obj);
        return campoHtml(d, v, "f_");
      }).join("");
    if (esPerro) html += '<div class="rg-campo ancho"><span>Días contratados</span>' + diasHtml(obj.dias_contratados, "f_dias") + "</div>";
    html += '</div></div>';
    if (esPerro) html += '<div class="rg-panel" id="rgPasaporte"></div>';
    if (!esPerro) {
      var ps = perrosDe(obj);
      html += '<div class="rg-panel"><h3>Perros de este cliente</h3><p>' + ps.length + " registrado(s)</p><div class=\"rg-lista\">" +
        (ps.map(function (p) {
          return '<button type="button" class="rg-item" data-id="' + p.id + '"><span class="rg-avatar" aria-hidden="true">' + pata(20) + '</span><span class="rg-item-txt"><strong>' +
            esc(p.nombre) + '</strong><small>' + esc((p.dias_contratados || []).join(" ") || "Ocasional") + '</small></span><span class="rg-flecha">›</span></button>';
        }).join("") || '<div class="rg-vacio">Sin perros.</div>') + "</div>" +
        '<div class="rg-acciones"><button class="rg-btn" id="rgAnadirPerro" type="button">+ Añadir otro perro</button></div></div>';
    }
    html += "</div>";
    raiz().innerHTML = html;
    window.scrollTo({ top: 0 });
    ligarDias(raiz());
    $("rgVolver").onclick = function () { pintarLista(); };
    $("rgGuardarFicha").onclick = function () { guardarFicha(esPerro, obj); };
    $("rgEstado").onclick = function () { cambiarEstado(esPerro, obj); };
    $("rgEditarFicha").onclick = function () { modoEdicion(true); };
    $("rgCancelarEdicion").onclick = function () { abrirFicha(tipo, id); };
    modoEdicion(false);
    if (esPerro) {
      ligarColocacion(raiz());
      $("f_ruta").onchange = function () { refrescarOrdenFicha(obj, false); };
      if ($("f_posicion")) $("f_posicion").onchange = function () { refrescarOrdenFicha(obj, true); };
      refrescarOrdenFicha(obj, false);
      pintarPasaporte(obj);
    }
    if (!esPerro) {
      raiz().querySelectorAll(".rg-lista .rg-item").forEach(function (b) { b.onclick = function () { abrirFicha("perro", b.dataset.id); }; });
      $("rgAnadirPerro").onclick = function () { nuevaAlta(obj.id); };
    }
  }

  function leerFicha(esPerro) {
    var campos = esPerro ? CAMPOS_PERRO : CAMPOS_CLIENTE, o = {}, errores = [];
    campos.forEach(function (d) {
      if (d[2] === "ordenhojas") return;
      var el = $("f_" + d[0]), v = vacioNull(el.value);
      if (d[3] && !v) errores.push("«" + d[1] + "» es obligatorio.");
      if (d[2] === "number") v = v === null ? null : Number(String(v).replace(",", "."));
      if (d[0] === "ruta" || d[0] === "orden_ruta") v = v === null ? null : Number(v);
      o[d[0]] = v;
    });
    if (esPerro) {
      o.dias_contratados = leerDias($("f_dias"));
      o.colocacion_hojas = $("f_colocacion_hojas").value || "hermanos";
      o.colocacion_hojas_ref = o.colocacion_hojas === "debajo" ? (vacioNull($("f_colocacion_hojas_ref").value)) : null;
      if (o.colocacion_hojas === "debajo" && !o.colocacion_hojas_ref) errores.push("Elige debajo de qué perro va en las hojas mensuales.");
      if (o.tipo_planificacion === "FIJO" && !o.dias_contratados.length) errores.push("Marca al menos un día contratado.");
      if (o.precio_interno != null && (isNaN(o.precio_interno) || o.precio_interno < 0)) errores.push("El precio no es válido.");
    }
    return { datos: o, errores: errores };
  }

  function mostrarErrores(id, errores) {
    $(id).innerHTML = errores.length ? '<div class="rg-err" role="alert">Revisa:<ul>' + errores.map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + "</ul></div>" : "";
  }

  function auditar(accion, entidad, id, antes, despues) {
    return sb.from("auditoria").insert({ usuario: "Registro", accion: accion, entidad: entidad, entidad_id: String(id),
      detalle_antes: antes || null, detalle_despues: despues || null, resultado: "OK" }).then(function () {}, function () {});
  }

  function guardarFicha(esPerro, obj) {
    var r = leerFicha(esPerro);
    mostrarErrores("rgErrFicha", r.errores);
    if (r.errores.length) return;
    var btn = $("rgGuardarFicha"); btn.disabled = true;
    var tabla = esPerro ? "perros" : "clientes";
    var datos = r.datos; datos.actualizado_en = new Date().toISOString();
    if (esPerro) datos.nombre_config = obj.nombre_config || datos.nombre;
    var cambioPlan = esPerro && activo(obj) && (
      (datos.dias_contratados || []).join() !== (obj.dias_contratados || []).join() ||
      datos.tipo_planificacion !== (norm(obj.tipo_planificacion) === "ocasional" ? "OCASIONAL" : "FIJO"));
    var texto = "Cambios guardados";
    var pend = esPerro && estado.pasaporteNuevo && estado.pasaporteNuevo.id === obj.id ? estado.pasaporteNuevo.file : null;
    var cadena = Promise.resolve();
    if (pend) {
      var cliF = clienteDe(obj);
      aviso("Subiendo pasaporte a Drive…");
      cadena = subirADrive(pend, datos.nombre || obj.nombre, cliF ? cliF.nombre_completo : "").then(function (url) {
        datos.pasaporte_url = url; datos.pasaporte_actualizado = new Date().toISOString();
      }).catch(function (e) { throw new Error("no se pudo subir el pasaporte (" + e.message + "). No se ha guardado nada."); });
    }
    if (esPerro) cadena = cadena.then(function () { return reordenarFicha(obj, datos); });
    cadena.then(function () { return sb.from(tabla).update(datos).eq("id", obj.id).select().single(); }).then(function (res) {
      var nuevo = comprobar(res);
      Object.assign(obj, nuevo);
      return auditar("EDITAR", tabla, obj.id, null, datos);
    }).then(function () {
      if (!cambioPlan) return;
      return limpiarPrevistos(obj.id, hoyIso()).then(function () { return generarPrevistos(obj, hoyIso()); })
        .then(function () { texto = "Cambios guardados · días previstos actualizados desde hoy"; });
    }).then(function () {
      aviso(texto);
      abrirFicha(esPerro ? "perro" : "cliente", obj.id);
    }).catch(function (e) { btn.disabled = false; aviso("No se pudo guardar: " + e.message, true); });
  }

  /* Baja de un perro: se conservan todos sus datos; desde la fecha indicada se paran su ruta y sus días de salida. */
  function pedirFechaBaja(obj) {
    var p = $("rgBajaPanel");
    p.innerHTML = '<div class="rg-panel"><h3>Dar de baja a ' + esc(obj.nombre) + '</h3>' +
      '<p>Se conservan todos sus datos. Desde la fecha que indiques se paraliza su ruta y sus días de salida, y pasa a INACTIVO.</p>' +
      '<label class="rg-campo"><span>Fecha de baja</span><input type="date" id="rgFechaBaja" value="' + hoyIso() + '"></label>' +
      '<div class="rg-acciones"><button class="rg-btn" id="rgBajaNo" type="button">Cancelar</button>' +
      '<button class="rg-btn peligro" id="rgBajaSi" type="button">Confirmar baja</button></div></div>';
    $("rgBajaNo").onclick = function () { p.innerHTML = ""; };
    $("rgBajaSi").onclick = function () {
      var f = $("rgFechaBaja").value;
      if (!f) { aviso("Indica la fecha de baja.", true); return; }
      confirmarBajaPerro(obj, f);
    };
    p.scrollIntoView({ block: "center" });
  }
  function confirmarBajaPerro(obj, fecha) {
    var efectiva = fecha <= hoyIso();
    var datos = { fecha_baja_servicio: fecha, actualizado_en: new Date().toISOString() };
    if (efectiva) datos.estado = "INACTIVO";
    $("rgBajaSi").disabled = true;
    sb.from("perros").update(datos).eq("id", obj.id).select().single().then(function (res) {
      Object.assign(obj, comprobar(res));
      return auditar("BAJA", "perros", obj.id, null, datos);
    }).then(function () { return limpiarPrevistos(obj.id, fecha); })
      .then(function () {
        aviso(efectiva ? "Dado de baja: ahora figura como INACTIVO" : "Baja programada para el " + fmtFecha(fecha));
        abrirFicha("perro", obj.id);
      }).catch(function (e) { $("rgBajaSi").disabled = false; aviso("No se pudo dar de baja: " + e.message, true); });
  }

  function cambiarEstado(esPerro, obj) {
    var baja = activo(obj);
    if (esPerro && baja) { pedirFechaBaja(obj); return; }
    if (baja && !window.confirm("¿Dar de baja a " + (esPerro ? obj.nombre : obj.nombre_completo) + "?" +
      (esPerro ? "\nSe quitarán sus días previstos desde hoy." : ""))) return;
    var tabla = esPerro ? "perros" : "clientes";
    var datos = { estado: baja ? "BAJA" : "ACTIVO", actualizado_en: new Date().toISOString() };
    if (esPerro) datos.fecha_baja_servicio = baja ? hoyIso() : null;
    sb.from(tabla).update(datos).eq("id", obj.id).select().single().then(function (res) {
      Object.assign(obj, comprobar(res));
      return auditar(baja ? "BAJA" : "REACTIVAR", tabla, obj.id, null, datos);
    }).then(function () {
      if (!esPerro) return;
      return baja ? limpiarPrevistos(obj.id, hoyIso()) : generarPrevistos(obj, hoyIso());
    }).then(function () {
      aviso(baja ? "Dado de baja" : "Reactivado");
      abrirFicha(esPerro ? "perro" : "cliente", obj.id);
    }).catch(function (e) { aviso("No se pudo cambiar el estado: " + e.message, true); });
  }

  /* ---------- días previstos (los «días verdes» de la asistencia) ---------- */
  var SEMANA = { L: 1, M: 2, X: 3, J: 4, V: 5 };

  function finPrevistos() {
    var fin = "2027-01-01";
    if (estado.periodos.length) fin = estado.periodos.reduce(function (m, x) { return x.fin > m ? x.fin : m; }, "0000-00-00");
    return fin;
  }
  function fechasPrevistas(dias, desdeIso) {
    var out = [], d = C.deIso(desdeIso), fin = C.deIso(finPrevistos());
    if (!d || !fin || !dias || !dias.length) return out;
    var nums = dias.map(function (x) { return SEMANA[x]; });
    for (; d <= fin; d.setDate(d.getDate() + 1)) if (nums.indexOf(d.getDay()) >= 0) out.push(C.aIso(d));
    return out;
  }
  function resumenPorPeriodo(fechas) {
    return estado.periodos.map(function (pe) {
      return { nombre: pe.nombre, n: fechas.filter(function (f) { return f >= pe.inicio && f <= pe.fin; }).length };
    }).filter(function (x) { return x.n > 0; });
  }
  function servicioGuarderia(precio) {
    var p = Number(precio), m = estado.servicios.filter(function (x) {
      return x.activo !== false && norm(x.nombre).indexOf("guarderia") === 0 && Number(x.precio) === p;
    })[0];
    return m ? m.nombre : "Guarderia";
  }
  function limpiarPrevistos(perroId, desdeIso) {
    return sb.from("asistencia").delete().eq("perro_id", perroId).gte("fecha", desdeIso)
      .eq("previsto", true).eq("ok", false).eq("anadido", false).then(function (r) { comprobar(r); });
  }
  function generarPrevistos(perro, desdeIso) {
    if (norm(perro.tipo_planificacion) === "ocasional") return Promise.resolve(0);
    var desde = perro.fecha_inicio_servicio && perro.fecha_inicio_servicio > desdeIso ? perro.fecha_inicio_servicio : desdeIso;
    var fechas = fechasPrevistas(perro.dias_contratados, desde);
    if (!fechas.length) return Promise.resolve(0);
    return sb.from("asistencia").select("fecha").eq("perro_id", perro.id).gte("fecha", desde).then(function (r) {
      var ya = {}; (comprobar(r) || []).forEach(function (x) { ya[x.fecha] = 1; });
      var servicio = servicioGuarderia(perro.precio_interno);
      var filas = fechas.filter(function (f) { return !ya[f]; }).map(function (f) {
        return { fecha: f, perro_id: perro.id, servicio: servicio, ok: false, anadido: false, cancelado: false, previsto: true };
      });
      var cadena = Promise.resolve();
      for (var i = 0; i < filas.length; i += 400) (function (trozo) {
        cadena = cadena.then(function () { return sb.from("asistencia").insert(trozo).then(function (r2) { comprobar(r2); }); });
      })(filas.slice(i, i + 400));
      return cadena.then(function () { return filas.length; });
    });
  }

  /* ---------- nueva alta ---------- */
  function perroVacio() {
    return { nombre: "", identificador: "", sexo: "", raza: "", fecha_nacimiento: "", microchip: "",
      fecha_inicio_servicio: hoyIso(), precio_interno: "20", plan: "FIJO", dias: [], ruta: 1, posicion: "final", colocacion: "hermanos", colocacion_ref: "", pasaporte_archivo: null, observaciones: "" };
  }

  function nuevaAlta(clienteId) {
    estado.alta = {
      modo: clienteId ? "existente" : "nuevo", clienteId: clienteId || "",
      cliente: { nombre_completo: "", telefono_whatsapp: "", email: "", direccion: "", codigo_postal: "", localidad: "" },
      perros: [perroVacio()], paso: "form", errores: []
    };
    pintarAlta();
  }

  function ordenDeRuta(ruta, excluirNuevos) {
    return estado.perros.filter(function (p) { return activo(p) && Number(p.ruta) === Number(ruta); })
      .sort(function (a, b) { return (a.orden_ruta || 999) - (b.orden_ruta || 999); });
  }

  /* ---------- pasaporte: foto o archivo -> carpeta de Google Drive ---------- */
  function urlDriveSegura(u) { return /^https:\/\/(drive|docs)\.google\.com\//.test(String(u || "")); }

  /* botones «Hacer foto» / «Elegir del dispositivo» (se usan en Editar y en Nueva alta).
     El archivo solo se guarda en memoria: se sube a Drive al pulsar Guardar. */
  function pasaporteSelHtml() {
    return '<div class="rg-acciones"><button class="rg-btn" type="button" data-pas="foto">📷 Hacer foto</button>' +
      '<button class="rg-btn" type="button" data-pas="archivo">🖼 Elegir del dispositivo</button></div>' +
      '<input type="file" accept="image/*" capture="environment" hidden data-pas-in="foto">' +
      '<input type="file" accept="image/*,application/pdf" hidden data-pas-in="archivo">' +
      '<div data-pas-estado role="status"></div>';
  }
  function errorArchivoPasaporte(f) {
    if (f.type === "application/pdf") return f.size > 8 * 1024 * 1024 ? "El PDF pesa más de 8 MB. Usa una foto o un PDF más ligero." : "";
    return f.type.indexOf("image/") === 0 ? "" : "Elige una foto o un PDF.";
  }
  function ligarPasaporte(cont, obtener, poner) {
    function pintarEstado() {
      var f = obtener(), e = cont.querySelector("[data-pas-estado]");
      e.innerHTML = f ? "✔ " + esc(f.name || "Foto") + " · se subirá a Drive al guardar " + '<button class="rg-btn" type="button" data-pas="quitar">Quitar</button>' : "";
      var q = e.querySelector('[data-pas="quitar"]'); if (q) q.onclick = function () { poner(null); pintarEstado(); };
    }
    ["foto", "archivo"].forEach(function (k) {
      var inp = cont.querySelector('[data-pas-in="' + k + '"]');
      cont.querySelector('[data-pas="' + k + '"]').onclick = function () { inp.click(); };
      inp.onchange = function () {
        var f = inp.files && inp.files[0]; inp.value = "";
        if (!f) return;
        var err = errorArchivoPasaporte(f);
        if (err) { aviso(err, true); return; }
        poner(f); pintarEstado();
      };
    });
    pintarEstado();
  }

  /* ficha del perro: el enlace se ve siempre; los botones de subir y quitar solo al pulsar Editar */
  function pintarPasaporte(obj) {
    var c = $("rgPasaporte"); if (!c) return;
    var tiene = urlDriveSegura(obj.pasaporte_url);
    c.innerHTML = "<h3>Pasaporte</h3><p>" +
      (tiene ? "Subido el " + esc(fmtFecha(obj.pasaporte_actualizado)) + ' · <a href="' + esc(obj.pasaporte_url) + '" target="_blank" rel="noopener">Abrir en Drive</a>'
        : "Todavía no hay pasaporte subido.") + "</p>" +
      '<div id="rgPasSel" style="display:' + (estado.fichaEdit ? "" : "none") + '">' + pasaporteSelHtml() +
      (tiene ? '<div class="rg-acciones"><button class="rg-btn peligro" id="rgQuitarPasaporte" type="button">🗑 Quitar pasaporte subido</button></div>' : "") + "</div>";
    ligarPasaporte($("rgPasSel"),
      function () { return estado.pasaporteNuevo && estado.pasaporteNuevo.id === obj.id ? estado.pasaporteNuevo.file : null; },
      function (f) { estado.pasaporteNuevo = f ? { id: obj.id, file: f } : null; });
    var q = $("rgQuitarPasaporte");
    if (q) q.onclick = function () { quitarPasaporte(obj); };
  }

  /* id del archivo dentro de la dirección de Drive (…/file/d/<ID>/… o …?id=<ID>) */
  function idArchivoDrive(u) {
    var m = String(u || "").match(/\/d\/([\w-]+)/) || String(u || "").match(/[?&]id=([\w-]+)/);
    return m ? m[1] : null;
  }

  /* pide al script de Drive que mande el archivo a la papelera (se puede recuperar desde Drive).
     Devuelve true si se borró; false si no se pudo (p. ej. el script aún no está actualizado). */
  function borrarEnDrive(url) {
    var cfg = window.DOGGY_CONFIG || {}, id = idArchivoDrive(url);
    if (!cfg.PASAPORTES_URL || !id) return Promise.resolve(false);
    return fetch(cfg.PASAPORTES_URL, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token: cfg.PASAPORTES_TOKEN || "", accion: "borrar", id: id })
    }).then(function (r) { return r.json(); }).then(function (r) { return !!(r && r.ok); })
      .catch(function () { return false; });
  }

  function quitarPasaporte(obj) {
    if (!window.confirm("¿Quitar el pasaporte de " + obj.nombre + "?\n\nSe desvinculará de la ficha y el archivo se mandará a la papelera de Drive.")) return;
    var btn = $("rgQuitarPasaporte"); if (btn) btn.disabled = true;
    var urlAntes = obj.pasaporte_url, borrado = false;
    aviso("Quitando pasaporte…");
    borrarEnDrive(urlAntes).then(function (ok) {
      borrado = ok;
      var datos = { pasaporte_url: null, pasaporte_actualizado: null, actualizado_en: new Date().toISOString() };
      return sb.from("perros").update(datos).eq("id", obj.id).select().single().then(function (res) {
        Object.assign(obj, comprobar(res));
        return auditar("QUITAR_PASAPORTE", "perros", obj.id, { pasaporte_url: urlAntes }, { pasaporte_url: null });
      });
    }).then(function () {
      estado.pasaporteNuevo = null;
      pintarPasaporte(obj);
      aviso(borrado ? "Pasaporte quitado (archivo enviado a la papelera de Drive)"
        : "Pasaporte quitado de la ficha. El archivo sigue en Drive: bórralo allí a mano o actualiza el script de Drive (apps-script-pasaportes.gs).", !borrado);
    }).catch(function (e) { if (btn) btn.disabled = false; aviso("No se pudo quitar el pasaporte: " + e.message, true); });
  }

  function leerBase64(file) {
    return new Promise(function (ok, ko) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).split(",")[1]); };
      r.onerror = function () { ko(new Error("No se pudo leer el archivo")); };
      r.readAsDataURL(file);
    });
  }

  /* reduce la foto (lado mayor 1800 px, JPEG) para que suba rápido con datos móviles */
  function reducirImagen(file, max, calidad) {
    return new Promise(function (ok, ko) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        ok(cv.toDataURL("image/jpeg", calidad).split(",")[1]);
      };
      img.onerror = function () { URL.revokeObjectURL(url); ko(new Error("No se pudo leer la imagen")); };
      img.src = url;
    });
  }

  /* sube el archivo a la carpeta de Drive y devuelve la dirección del archivo */
  function subirADrive(file, nombrePerro, nombreCliente) {
    var cfg = window.DOGGY_CONFIG || {};
    if (!cfg.PASAPORTES_URL) return Promise.reject(new Error("falta configurar PASAPORTES_URL en config.js"));
    var esPdf = file.type === "application/pdf";
    return (esPdf ? leerBase64(file) : reducirImagen(file, 1800, 0.85)).then(function (b64) {
      /* text/plain evita la petición previa (CORS) que Apps Script no admite */
      return fetch(cfg.PASAPORTES_URL, {
        method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ token: cfg.PASAPORTES_TOKEN || "", perro: nombrePerro, cliente: nombreCliente || "",
          mime: esPdf ? "application/pdf" : "image/jpeg", data: b64 })
      });
    }).then(function (r) { return r.json(); }).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || "Drive no respondió");
      if (!urlDriveSegura(r.url)) throw new Error("Drive devolvió una dirección no válida");
      return r.url;
    });
  }

  /* ---------- colocación en las hojas mensuales ---------- */
  var COLOCACIONES = [
    ["hermanos", "Junto a sus hermanos; si no tiene, por orden alfabético"],
    ["alfabetico", "Por orden alfabético"],
    ["debajo", "Debajo de un perro concreto"]
  ];
  function opcionesColocacion(v) {
    v = v || "hermanos";
    return COLOCACIONES.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === v ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("");
  }
  function opcionesRefPerro(sel, excluirId) {
    var o = '<option value="">Selecciona un perro</option>';
    estado.perros.filter(function (x) { return activo(x) && x.id !== excluirId; })
      .sort(function (a, b) { return porNombre(a.nombre, b.nombre); })
      .forEach(function (x) { o += '<option value="' + x.id + '"' + (sel === x.id ? " selected" : "") + ">" + esc(x.nombre) + "</option>"; });
    return o;
  }
  /* attrTipo / attrRef: atributos para localizar cada select (data-k="…" en el alta, id="…" en la ficha) */
  function colocacionHtml(tipo, ref, excluirId, attrTipo, attrRef) {
    tipo = tipo || "hermanos";
    return '<div class="rg-campo ancho rg-coloc"><span>Colocación en las hojas mensuales <b class="rg-obl">*</b></span>' +
      "<select " + attrTipo + ' data-coloc="tipo">' + opcionesColocacion(tipo) + "</select>" +
      "<select " + attrRef + ' data-coloc="ref" style="margin-top:8px;' + (tipo === "debajo" ? "" : "display:none;") + '">' + opcionesRefPerro(ref, excluirId) + "</select></div>";
  }
  function ligarColocacion(contenedor) {
    contenedor.querySelectorAll(".rg-coloc").forEach(function (c) {
      var t = c.querySelector('[data-coloc="tipo"]'), r = c.querySelector('[data-coloc="ref"]');
      t.onchange = function () { r.style.display = t.value === "debajo" ? "" : "none"; if (t.value !== "debajo") r.value = ""; };
    });
  }

  /* Orden de los perros en las hojas mensuales según la colocación de cada uno.
     - alfabético: por nombre.
     - hermanos: el grupo de hermanos (mismo cliente) va junto, en el sitio alfabético de su primer miembro;
       si no tiene hermanos, por orden alfabético.
     - debajo: justo debajo del perro elegido (si ese perro no está en la lista, cae a hermanos/alfabético). */
  function ordenHojas(perros) {
    var lista = perros.slice();
    var ids = {}; lista.forEach(function (x) { ids[x.id] = 1; });
    var esDebajo = function (x) { return x.colocacion_hojas === "debajo" && x.colocacion_hojas_ref && ids[x.colocacion_hojas_ref] && x.colocacion_hojas_ref !== x.id; };
    var libres = lista.filter(function (x) { return !esDebajo(x); });
    var grupos = {}, unidades = [];
    libres.forEach(function (x) {
      if ((x.colocacion_hojas || "hermanos") === "hermanos" && x.cliente_id) (grupos[x.cliente_id] = grupos[x.cliente_id] || []).push(x);
    });
    var usados = {};
    libres.slice().sort(function (a, b) { return porNombre(a.nombre, b.nombre); }).forEach(function (x) {
      if (usados[x.id]) return;
      var g = (x.colocacion_hojas || "hermanos") === "hermanos" && x.cliente_id ? grupos[x.cliente_id] : null;
      if (g && g.length > 1) { g.slice().sort(function (a, b) { return porNombre(a.nombre, b.nombre); }).forEach(function (m) { usados[m.id] = 1; unidades.push(m); }); }
      else { usados[x.id] = 1; unidades.push(x); }
    });
    var pend = lista.filter(esDebajo).sort(function (a, b) { return porNombre(a.nombre, b.nombre); }), res = unidades.slice();
    var vueltas = pend.length + 1;
    while (pend.length && vueltas--) {
      pend = pend.filter(function (x) {
        var i = -1; res.forEach(function (r, n) { if (r.id === x.colocacion_hojas_ref) i = n; });
        if (i < 0) return true;
        while (i + 1 < res.length && esDebajo(res[i + 1]) && res[i + 1].colocacion_hojas_ref === x.colocacion_hojas_ref) i++;
        res.splice(i + 1, 0, x); return false;
      });
    }
    return res.concat(pend);
  }

  /* ---------- posición y orden en la ficha del perro ---------- */
  function fichaOrdenHtml(obj) {
    var h = "";
    if (activo(obj)) {
      h += '<label class="rg-campo"><span>Posición de recogida <b class="rg-obl">*</b></span><select id="f_posicion"></select></label>' +
        '<div class="rg-campo ancho"><span id="f_orden_tit">Orden actual de la ruta</span><div class="rg-orden" id="f_orden"></div></div>';
    } else {
      h += '<div class="rg-campo ancho"><span>Posición de recogida</span><div class="rg-orden"><div><span>Perro de baja: no ocupa sitio en la ruta.</span></div></div></div>';
    }
    return h + colocacionHtml(obj.colocacion_hojas, obj.colocacion_hojas_ref, obj.id, 'id="f_colocacion_hojas"', 'id="f_colocacion_hojas_ref"');
  }

  /* orden que quedaría en la ruta si el perro se pone en `pos` */
  function ordenFicha(obj, ruta, pos) {
    var actual = ordenDeRuta(ruta), idxActual = -1;
    actual.forEach(function (x, n) { if (x.id === obj.id) idxActual = n; });
    var base = actual.filter(function (x) { return x.id !== obj.id; }), i = base.length;
    if (pos === "inicio") i = 0;
    else if (pos === "actual" && idxActual >= 0) i = idxActual;
    else if (pos.indexOf("despues:") === 0) {
      var idx = -1, id = pos.split(":")[1];
      base.forEach(function (x, n) { if (x.id === id) idx = n; });
      if (idx >= 0) i = idx + 1;
    }
    var lista = base.map(function (x) { return { id: x.id, nombre: x.nombre, orden: x.orden_ruta, nuevo: false }; });
    lista.splice(i, 0, { id: obj.id, nombre: obj.nombre, orden: obj.orden_ruta, nuevo: true });
    return lista;
  }

  function refrescarOrdenFicha(obj, conservar) {
    var sel = $("f_posicion"); if (!sel) return;
    var ruta = Number($("f_ruta").value), mismaRuta = Number(obj.ruta) === ruta;
    var previo = conservar ? sel.value : (mismaRuta ? "actual" : "final");
    var o = mismaRuta ? '<option value="actual">Se queda donde está</option>' : "";
    o += '<option value="final">Al final de la ruta</option><option value="inicio">Al principio de la ruta</option>';
    ordenDeRuta(ruta).filter(function (x) { return x.id !== obj.id; }).forEach(function (x) {
      o += '<option value="despues:' + x.id + '">Después de ' + esc(x.nombre) + "</option>";
    });
    sel.innerHTML = o;
    if (!Array.prototype.some.call(sel.options, function (op) { return op.value === previo; })) previo = mismaRuta ? "actual" : "final";
    sel.value = previo;
    $("f_orden_tit").textContent = "Orden actual de la ruta (" + (RUTAS[ruta] || "") + ")";
    var lista = ordenFicha(obj, ruta, sel.value);
    $("f_orden").innerHTML = lista.map(function (x, n) {
      return '<div' + (x.nuevo ? ' class="nuevo"' : "") + "><b>" + (n + 1) + "</b><span>" + esc(x.nombre) + "</span></div>";
    }).join("");
    var nuevo = $("f_orden").querySelector(".nuevo"); if (nuevo && nuevo.scrollIntoView && conservar) nuevo.scrollIntoView({ block: "nearest" });
  }

  /* guarda la nueva posición: renumera la ruta (y la antigua si cambia de ruta) y deja el nº del perro en datos */
  function reordenarFicha(obj, datos) {
    var sel = $("f_posicion");
    if (!sel || !activo(obj)) return Promise.resolve();
    var ruta = Number(datos.ruta), pos = sel.value, mismaRuta = Number(obj.ruta) === ruta;
    if (mismaRuta && pos === "actual") return Promise.resolve();
    var lista = ordenFicha(obj, ruta, pos), tareas = Promise.resolve(), cambios = [];
    lista.forEach(function (x, n) {
      if (x.id === obj.id) { datos.orden_ruta = n + 1; return; }
      if (Number(x.orden) !== n + 1) cambios.push({ id: x.id, orden: n + 1 });
    });
    if (!mismaRuta) {   /* cerrar el hueco en la ruta de origen */
      ordenDeRuta(obj.ruta).filter(function (x) { return x.id !== obj.id; }).forEach(function (x, n) {
        if (Number(x.orden_ruta) !== n + 1) cambios.push({ id: x.id, orden: n + 1 });
      });
    }
    cambios.forEach(function (c) {
      tareas = tareas.then(function () {
        return sb.from("perros").update({ orden_ruta: c.orden }).eq("id", c.id).then(function (r) {
          comprobar(r);
          var d = estado.perros.filter(function (y) { return y.id === c.id; })[0]; if (d) d.orden_ruta = c.orden;
        });
      });
    });
    return tareas;
  }

  function opcionesPosicion(ruta, sel) {
    var l = ordenDeRuta(ruta), o = '<option value="final"' + (sel === "final" ? " selected" : "") + ">Al final de la ruta</option>" +
      '<option value="inicio"' + (sel === "inicio" ? " selected" : "") + ">Al principio de la ruta</option>";
    l.forEach(function (p) { o += '<option value="despues:' + p.id + '"' + (sel === "despues:" + p.id ? " selected" : "") + ">Después de " + esc(p.nombre) + "</option>"; });
    return o;
  }

  function pintarAlta() {
    var a = estado.alta;
    if (a.paso === "revision") return pintarRevision();
    var h = '<div class="rg-wrap"><button class="rg-btn rg-volver" id="rgCancelarArriba" type="button">← Cancelar y volver</button>' +
      '<div class="rg-titulo"><div><h2>Nueva alta</h2><p>Prepara el cliente, sus perros, los días y el orden de recogida.</p></div></div>' +
      '<div class="rg-panel"><h3><span class="rg-num">1</span>Cliente</h3><p>Selecciona si ya existe o si es un cliente nuevo.</p>' +
      '<div class="rg-tabs"><button class="rg-tab' + (a.modo === "nuevo" ? " activo" : "") + '" data-modo="nuevo" type="button">Cliente nuevo</button>' +
      '<button class="rg-tab' + (a.modo === "existente" ? " activo" : "") + '" data-modo="existente" type="button">Cliente existente</button></div>';
    if (a.modo === "nuevo") {
      h += '<div class="rg-grid dos">' +
        '<label class="rg-campo ancho"><span>Nombre completo <b class="rg-obl">*</b></span><input id="a_nombre" value="' + esc(a.cliente.nombre_completo) + '" autocomplete="off"></label>' +
        '<label class="rg-campo"><span>Teléfono / WhatsApp <b class="rg-obl">*</b></span><input id="a_tel" type="tel" value="' + esc(a.cliente.telefono_whatsapp) + '"></label>' +
        '<label class="rg-campo"><span>Correo electrónico</span><input id="a_email" type="email" value="' + esc(a.cliente.email) + '"></label>' +
        '<label class="rg-campo ancho"><span>Dirección</span><input id="a_dir" value="' + esc(a.cliente.direccion) + '"></label>' +
        '<label class="rg-campo"><span>Código postal</span><input id="a_cp" value="' + esc(a.cliente.codigo_postal) + '"></label>' +
        '<label class="rg-campo"><span>Localidad</span><input id="a_loc" value="' + esc(a.cliente.localidad) + '"></label></div>';
    } else {
      h += '<label class="rg-campo"><span>Seleccionar cliente <b class="rg-obl">*</b></span><select id="a_cliente"><option value="">Selecciona un cliente</option>' +
        estado.clientes.filter(activo).sort(function (x, y) { return porNombre(x.nombre_completo, y.nombre_completo); }).map(function (c) {
          return '<option value="' + c.id + '"' + (a.clienteId === c.id ? " selected" : "") + ">" + esc(c.nombre_completo) + "</option>";
        }).join("") + "</select></label>";
    }
    h += '</div><div class="rg-panel"><div class="rg-panel-cab"><div><h3><span class="rg-num">2</span>Perros</h3><p>Puedes incluir varios perros en la misma alta.</p></div>' +
      '<button class="rg-btn" id="rgAnadirBloque" type="button">+ Añadir perro</button></div><div id="rgPerros">';
    a.perros.forEach(function (p, i) { h += bloquePerro(p, i, a.perros.length); });
    h += '</div></div><div id="rgErrAlta">' + "</div>" +
      '<div class="rg-acciones"><button class="rg-btn" id="rgCancelar" type="button">Cancelar</button>' +
      '<button class="rg-btn principal" id="rgRevisar" type="button">Revisar antes de guardar →</button></div></div>';
    raiz().innerHTML = h;
    window.scrollTo({ top: 0 });
    mostrarErrores("rgErrAlta", a.errores || []);
    ligarAlta();
  }

  function bloquePerro(p, i, total) {
    var l = ordenDeRuta(p.ruta);
    return '<div class="rg-perro-bloque" data-i="' + i + '"><header><strong>Perro ' + (i + 1) + "</strong>" +
      (total > 1 ? '<button class="rg-btn peligro" type="button" data-quitar="' + i + '">Eliminar</button>' : "") + "</header>" +
      '<div class="rg-grid dos">' +
      '<label class="rg-campo"><span>Nombre del perro <b class="rg-obl">*</b></span><input data-k="nombre" value="' + esc(p.nombre) + '" autocomplete="off"></label>' +
      '<label class="rg-campo"><span>Identificador (opcional)</span><input data-k="identificador" value="' + esc(p.identificador) + '"></label>' +
      '<label class="rg-campo"><span>Sexo (opcional)</span><select data-k="sexo">' + opcionesSexo(p.sexo) + "</select></label>" +
      '<label class="rg-campo"><span>Raza (opcional)</span><input data-k="raza" value="' + esc(p.raza) + '"></label>' +
      '<label class="rg-campo"><span>Fecha de nacimiento (opcional)</span><input data-k="fecha_nacimiento" type="date" value="' + esc(p.fecha_nacimiento) + '"></label>' +
      '<label class="rg-campo"><span>Microchip (opcional)</span><input data-k="microchip" value="' + esc(p.microchip) + '"></label>' +
      '<label class="rg-campo"><span>Fecha de inicio <b class="rg-obl">*</b></span><input data-k="fecha_inicio_servicio" type="date" value="' + esc(p.fecha_inicio_servicio) + '"></label>' +
      '<label class="rg-campo"><span>Precio interno por día (€) <b class="rg-obl">*</b></span><input data-k="precio_interno" type="number" step="0.01" inputmode="decimal" value="' + esc(p.precio_interno) + '"></label>' +
      '<label class="rg-campo"><span>Planificación <b class="rg-obl">*</b></span><select data-k="plan">' + opcionesPlan(p.plan) + "</select></label>" +
      '<div class="rg-campo ancho"><span>Días contratados <b class="rg-obl">*</b></span>' + diasHtml(p.dias, "a_dias_" + i) + "</div>" +
      '<label class="rg-campo"><span>Ruta <b class="rg-obl">*</b></span><select data-k="ruta">' + opcionesRuta(p.ruta) + "</select></label>" +
      '<label class="rg-campo"><span>Posición de recogida <b class="rg-obl">*</b></span><select data-k="posicion">' + opcionesPosicion(p.ruta, p.posicion) + "</select></label>" +
      '<div class="rg-campo ancho"><span>Orden actual de la ruta (' + esc(RUTAS[p.ruta]) + ")</span><div class=\"rg-orden\">" +
      (l.map(function (x, n) { return "<div><b>" + (n + 1) + "</b><span>" + esc(x.nombre) + "</span></div>"; }).join("") || "<div><span>Ruta vacía</span></div>") + "</div></div>" +
      colocacionHtml(p.colocacion, p.colocacion_ref, "", 'data-k="colocacion"', 'data-k="colocacion_ref"') +
      '<div class="rg-campo ancho rg-pas"><span>Pasaporte (opcional)</span>' + pasaporteSelHtml() + "</div>" +
      '<label class="rg-campo ancho"><span>Observaciones</span><textarea data-k="observaciones" rows="2">' + esc(p.observaciones) + "</textarea></label>" +
      "</div></div>";
  }

  function recogerAlta() {
    var a = estado.alta;
    if (a.modo === "nuevo") {
      a.cliente = { nombre_completo: $("a_nombre").value, telefono_whatsapp: $("a_tel").value, email: $("a_email").value,
        direccion: $("a_dir").value, codigo_postal: $("a_cp").value, localidad: $("a_loc").value };
    } else a.clienteId = $("a_cliente").value;
    raiz().querySelectorAll(".rg-perro-bloque").forEach(function (bl) {
      var p = a.perros[Number(bl.dataset.i)];
      bl.querySelectorAll("[data-k]").forEach(function (el) { p[el.dataset.k] = el.value; });
      p.dias = leerDias(bl);
      p.ruta = Number(p.ruta);
    });
  }

  function ligarAlta() {
    var a = estado.alta;
    function cancelar() { pintarLista(); }
    $("rgCancelarArriba").onclick = cancelar; $("rgCancelar").onclick = cancelar;
    raiz().querySelectorAll("[data-modo]").forEach(function (b) {
      b.onclick = function () { recogerAlta(); a.modo = b.dataset.modo; a.errores = []; pintarAlta(); };
    });
    $("rgAnadirBloque").onclick = function () { recogerAlta(); a.perros.push(perroVacio()); pintarAlta(); };
    raiz().querySelectorAll("[data-quitar]").forEach(function (b) {
      b.onclick = function () { recogerAlta(); a.perros.splice(Number(b.dataset.quitar), 1); pintarAlta(); };
    });
    raiz().querySelectorAll(".rg-perro-bloque").forEach(function (bl) {
      ligarDias(bl); ligarColocacion(bl);
      (function (i) {
        ligarPasaporte(bl.querySelector(".rg-pas"), function () { return a.perros[i].pasaporte_archivo; }, function (f) { a.perros[i].pasaporte_archivo = f; });
      })(Number(bl.dataset.i));
      bl.querySelector('[data-k="ruta"]').onchange = function () {
        recogerAlta(); a.perros[Number(bl.dataset.i)].posicion = "final"; pintarAlta();
      };
    });
    $("rgRevisar").onclick = function () {
      recogerAlta();
      a.errores = validarAlta(a);
      if (a.errores.length) { pintarAlta(); window.scrollTo({ top: document.body.scrollHeight }); return; }
      a.paso = "revision"; pintarAlta();
    };
  }

  function validarAlta(a) {
    var e = [];
    if (a.modo === "nuevo") {
      if (!vacioNull(a.cliente.nombre_completo)) e.push("El nombre completo del cliente es obligatorio.");
      if (!vacioNull(a.cliente.telefono_whatsapp)) e.push("El teléfono / WhatsApp del cliente es obligatorio.");
      var dup = estado.clientes.filter(function (c) { return norm(c.nombre_completo) === norm(a.cliente.nombre_completo); })[0];
      if (dup) e.push("Ya existe un cliente llamado «" + dup.nombre_completo + "». Si es el mismo, usa «Cliente existente».");
    } else if (!a.clienteId) e.push("Selecciona un cliente.");
    var nombres = {};
    a.perros.forEach(function (p, i) {
      var n = "Perro " + (i + 1) + ": ";
      if (!vacioNull(p.nombre)) e.push(n + "falta el nombre.");
      else {
        if (nombres[norm(p.nombre)]) e.push(n + "el nombre está repetido en esta alta."); nombres[norm(p.nombre)] = 1;
        if (a.modo === "existente" && a.clienteId && perrosDe({ id: a.clienteId }).some(function (x) { return norm(x.nombre) === norm(p.nombre); }))
          e.push(n + "este cliente ya tiene un perro con ese nombre.");
      }
      if (!p.fecha_inicio_servicio) e.push(n + "falta la fecha de inicio.");
      if (p.colocacion === "debajo" && !p.colocacion_ref) e.push(n + "elige debajo de qué perro va en las hojas mensuales.");
      var pr = Number(String(p.precio_interno).replace(",", "."));
      if (p.precio_interno === "" || isNaN(pr) || pr < 0) e.push(n + "el precio por día no es válido.");
      if (p.plan === "FIJO" && !p.dias.length) e.push(n + "marca al menos un día contratado.");
    });
    return e;
  }

  function etiquetaPosicion(p) {
    if (p.posicion === "final") return "Al final de la ruta";
    if (p.posicion === "inicio") return "Al principio de la ruta";
    var id = p.posicion.split(":")[1], ref = estado.perros.filter(function (x) { return x.id === id; })[0];
    return "Después de " + (ref ? ref.nombre : "—");
  }

  function etiquetaColocacion(p) {
    if (p.colocacion === "alfabetico") return "Por orden alfabético";
    if (p.colocacion === "debajo") {
      var ref = estado.perros.filter(function (x) { return x.id === p.colocacion_ref; })[0];
      return "Debajo de " + (ref ? ref.nombre : "—");
    }
    return "Junto a sus hermanos; si no tiene, por orden alfabético";
  }

  function ordenResultante(ruta, nuevos) {
    var lista = ordenDeRuta(ruta).map(function (x) { return { id: x.id, nombre: x.nombre, nuevo: false }; });
    nuevos.forEach(function (p) {
      var item = { nombre: p.nombre.trim(), nuevo: true }, i = lista.length;
      if (p.posicion === "inicio") i = 0;
      else if (p.posicion.indexOf("despues:") === 0) {
        var idx = -1, id = p.posicion.split(":")[1];
        lista.forEach(function (x, n) { if (x.id === id) idx = n; });
        if (idx >= 0) i = idx + 1;
      }
      lista.splice(i, 0, item);
    });
    return lista;
  }

  function pintarRevision() {
    var a = estado.alta, cli;
    if (a.modo === "nuevo") cli = a.cliente; else cli = estado.clientes.filter(function (c) { return c.id === a.clienteId; })[0] || {};
    var h = '<div class="rg-wrap"><button class="rg-btn rg-volver" id="rgEditar" type="button">← Volver y corregir</button>' +
      '<div class="rg-titulo"><div><h2>Revisión del alta</h2><p><strong>No se ha guardado nada.</strong> Comprueba cliente, perros, rutas, días y orden antes de continuar.</p></div></div>' +
      '<div class="rg-panel rg-resumen"><h3>Cliente</h3><dl>' +
      "<dt>Tipo</dt><dd>" + (a.modo === "nuevo" ? "Cliente nuevo" : "Cliente existente") + "</dd>" +
      "<dt>Nombre</dt><dd>" + esc(cli.nombre_completo) + "</dd>" +
      (a.modo === "nuevo" ? "<dt>Teléfono / WhatsApp</dt><dd>" + esc(cli.telefono_whatsapp) + "</dd>" +
        (vacioNull(cli.email) ? "<dt>Correo</dt><dd>" + esc(cli.email) + "</dd>" : "") +
        (vacioNull(cli.direccion) ? "<dt>Dirección</dt><dd>" + esc(cli.direccion) + "</dd>" : "") +
        (vacioNull(cli.codigo_postal) || vacioNull(cli.localidad) ? "<dt>Localidad</dt><dd>" + esc([cli.codigo_postal, cli.localidad].filter(Boolean).join(" ")) + "</dd>" : "") : "") +
      "</dl></div>";
    var previstosHtml = "", rutas = {};
    a.perros.forEach(function (p, i) {
      var fechas = p.plan === "FIJO" ? fechasPrevistas(p.dias, p.fecha_inicio_servicio) : [];
      h += '<div class="rg-panel rg-resumen"><h3>Perro: ' + esc(p.nombre) + "</h3><dl>" +
        "<dt>Identificador</dt><dd>" + esc(vacioNull(p.identificador) || "Sin identificador") + "</dd>" +
        "<dt>Inicio</dt><dd>" + esc(p.fecha_inicio_servicio.split("-").reverse().join("/")) + "</dd>" +
        "<dt>Precio interno</dt><dd>" + esc(p.precio_interno) + " €</dd>" +
        "<dt>Planificación</dt><dd>" + (p.plan === "FIJO" ? "Días fijos" : "Ocasional") + "</dd>" +
        (p.plan === "FIJO" ? "<dt>Días</dt><dd>" + esc(p.dias.join(", ")) + "</dd>" : "") +
        "<dt>Ruta</dt><dd>" + esc(RUTAS[p.ruta]) + "</dd><dt>Posición</dt><dd>" + esc(etiquetaPosicion(p)) + "</dd>" +
        "<dt>Hojas mensuales</dt><dd>" + esc(etiquetaColocacion(p)) + "</dd>" +
        (p.pasaporte_archivo ? "<dt>Pasaporte</dt><dd>" + esc(p.pasaporte_archivo.name || "Foto") + " (se subirá a Drive)</dd>" : "") +
        (vacioNull(p.raza) ? "<dt>Raza</dt><dd>" + esc(p.raza) + "</dd>" : "") +
        (vacioNull(p.observaciones) ? "<dt>Observaciones</dt><dd>" + esc(p.observaciones) + "</dd>" : "") + "</dl></div>";
      (rutas[p.ruta] = rutas[p.ruta] || []).push(p);
      var res = resumenPorPeriodo(fechas);
      previstosHtml += res.length
        ? res.map(function (x) { return "<div><b>" + esc(x.nombre.toUpperCase()) + "</b> · " + esc(p.nombre) + " · " + x.n + (x.n === 1 ? " día previsto" : " días previstos") + "</div>"; }).join("")
        : "<div><b>" + esc(p.nombre) + "</b> · sin días previstos (planificación ocasional)</div>";
    });
    Object.keys(rutas).forEach(function (ruta) {
      h += '<div class="rg-panel"><h3>' + esc(RUTAS[ruta]) + " · orden resultante</h3><div class=\"rg-orden alto\">" +
        ordenResultante(ruta, rutas[ruta]).map(function (x, n) {
          return "<div" + (x.nuevo ? ' class="nuevo"' : "") + "><b>" + (n + 1) + "</b><span>" + esc(x.nombre) + (x.nuevo ? " · NUEVO" : "") + "</span></div>";
        }).join("") + "</div></div>";
    });
    h += '<div class="rg-panel"><h3>Días previstos que se generarían</h3><p>Hasta el final de ' + esc(finPrevistos().split("-").reverse().join("/")) + ".</p>" +
      '<div class="rg-orden alto previstos">' + previstosHtml + "</div></div>" +
      '<div class="rg-panel"><label class="rg-check"><input type="checkbox" id="rgConfirmo"> <span>He revisado el cliente, los perros, los días, las rutas y el orden.</span></label></div>' +
      '<div id="rgErrAlta"></div><div class="rg-acciones"><button class="rg-btn" id="rgEditar2" type="button">Corregir datos</button>' +
      '<button class="rg-btn principal" id="rgGuardarAlta" type="button" disabled>Guardar alta definitivamente</button></div></div>';
    raiz().innerHTML = h; window.scrollTo({ top: 0 });
    function editar() { a.paso = "form"; a.errores = []; pintarAlta(); }
    $("rgEditar").onclick = editar; $("rgEditar2").onclick = editar;
    $("rgConfirmo").onchange = function () { $("rgGuardarAlta").disabled = !this.checked; };
    $("rgGuardarAlta").onclick = guardarAlta;
  }

  function guardarAlta() {
    var a = estado.alta, btn = $("rgGuardarAlta"); btn.disabled = true; btn.textContent = "Guardando…";
    var creados = [], sinPasaporte = [];
    var pasoCliente = a.modo === "nuevo"
      ? sb.from("clientes").insert({
        estado: "ACTIVO", origen: "REGISTRO", nombre_completo: a.cliente.nombre_completo.trim(),
        nombre_config: a.cliente.nombre_completo.trim(), telefono_whatsapp: vacioNull(a.cliente.telefono_whatsapp),
        email: vacioNull(a.cliente.email), direccion: vacioNull(a.cliente.direccion),
        codigo_postal: vacioNull(a.cliente.codigo_postal), localidad: vacioNull(a.cliente.localidad)
      }).select().single().then(function (r) { var c = comprobar(r); estado.clientes.push(c); return c; })
      : Promise.resolve(estado.clientes.filter(function (c) { return c.id === a.clienteId; })[0]);

    pasoCliente.then(function (cli) {
      return a.perros.reduce(function (cadena, p) {
        return cadena.then(function () {
          return crearPerro(cli, p).then(function (n) {
            creados.push(n);
            return generarPrevistos(n, p.fecha_inicio_servicio).then(function () {
              if (!p.pasaporte_archivo) return;
              /* si falla la subida, el alta sigue: el pasaporte se puede subir luego desde Editar */
              return subirADrive(p.pasaporte_archivo, n.nombre, cli.nombre_completo).then(function (url) {
                return sb.from("perros").update({ pasaporte_url: url, pasaporte_actualizado: new Date().toISOString() }).eq("id", n.id).select().single();
              }).then(function (r) { Object.assign(n, comprobar(r)); }).catch(function () { sinPasaporte.push(n.nombre); });
            });
          });
        });
      }, Promise.resolve()).then(function () { return cli; });
    }).then(function (cli) {
      return auditar("ALTA", "clientes", cli.id, null, { cliente: cli.nombre_completo, perros: creados.map(function (x) { return x.nombre; }) });
    }).then(function () {
      aviso("Alta guardada: " + creados.map(function (x) { return x.nombre; }).join(", ") +
        (sinPasaporte.length ? ". El pasaporte de " + sinPasaporte.join(", ") + " no se pudo subir: súbelo desde Editar." : ""), sinPasaporte.length > 0);
      return cargar(true);
    }).then(function () {
      estado.tab = "perros"; estado.q = ""; pintarLista();
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = "Guardar alta";
      aviso("No se pudo guardar: " + e.message + (creados.length ? " (ya se guardaron: " + creados.map(function (x) { return x.nombre; }).join(", ") + ")" : ""), true);
      cargar(true);
    });
  }

  function crearPerro(cli, p) {
    var lista = ordenDeRuta(p.ruta), orden, tareas = Promise.resolve();
    if (p.posicion === "inicio") orden = 1;
    else if (p.posicion.indexOf("despues:") === 0) {
      var ref = lista.filter(function (x) { return x.id === p.posicion.split(":")[1]; })[0];
      orden = ref ? (ref.orden_ruta || lista.indexOf(ref) + 1) + 1 : lista.length + 1;
    } else orden = lista.reduce(function (m, x) { return Math.max(m, x.orden_ruta || 0); }, 0) + 1;
    /* hacer hueco: los que estén en esa posición o después suben una */
    lista.filter(function (x) { return (x.orden_ruta || 0) >= orden; }).forEach(function (x) {
      var nuevoOrden = (x.orden_ruta || 0) + 1;
      tareas = tareas.then(function () {
        return sb.from("perros").update({ orden_ruta: nuevoOrden }).eq("id", x.id).then(function (r) { comprobar(r); x.orden_ruta = nuevoOrden; });
      });
    });
    return tareas.then(function () {
      return sb.from("perros").insert({
        cliente_id: cli.id, estado: "ACTIVO", nombre: p.nombre.trim(), nombre_config: p.nombre.trim(),
        identificador: vacioNull(p.identificador), sexo: vacioNull(p.sexo), raza: vacioNull(p.raza),
        fecha_nacimiento: vacioNull(p.fecha_nacimiento), microchip: vacioNull(p.microchip),
        fecha_inicio_servicio: p.fecha_inicio_servicio, precio_interno: Number(String(p.precio_interno).replace(",", ".")),
        tipo_planificacion: p.plan, dias_contratados: p.plan === "FIJO" ? p.dias : [],
        ruta: p.ruta, orden_ruta: orden, observaciones: vacioNull(p.observaciones),
        colocacion_hojas: p.colocacion || "hermanos", colocacion_hojas_ref: p.colocacion === "debajo" ? (vacioNull(p.colocacion_ref)) : null
      }).select().single();
    }).then(function (r) { var n = comprobar(r); estado.perros.push(n); return n; });
  }

  /* ---------- arranque ---------- */
  function iniciar() {
    inyectarEstilos();
    montarCabecera();
    montarVistas();
    /* cualquier botón de la navegación inferior cierra Registro/Facturas */
    document.querySelectorAll(".nav-item").forEach(function (b) {
      b.addEventListener("click", function () { cerrar(); }, true);
    });
  }

  window.DoggyVistas = { abrir: abrir, cerrar: cerrar, ordenHojas: ordenHojas };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
