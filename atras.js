/* Doggy Day Care · botón ATRÁS del móvil (triángulo de Android).
 * En vez de salir de la app, cierra la capa superior (diálogo, panel, ficha, historial, Registro…)
 * y retrocede pantalla a pantalla hasta el inicio. Solo estando en el inicio, atrás sale de la app.
 *
 * Funcionamiento: se mantiene siempre UNA entrada extra («centinela») en el historial del navegador.
 * Al pulsar atrás se consume esa entrada: se cierra lo que haya abierto y se vuelve a poner el centinela.
 * Si no hay nada que cerrar (inicio), se deja salir de la app.
 */
(function () {
  "use strict";
  var MARCA = "doggy-centinela";
  var hayCentinela = false;

  function $(id) { return document.getElementById(id); }
  /* Visible de verdad: sirve también para paneles con position:fixed (offsetParent no vale ahí). */
  function abierto(el) { return !!el && el.getClientRects().length > 0; }
  function pulsar(el) { if (el) el.click(); return true; }

  function marcarInicioActivo() {
    var botones = document.querySelectorAll(".nav-item");
    botones.forEach(function (b) { b.classList.remove("activo"); b.removeAttribute("aria-current"); });
    if (botones[0]) { botones[0].classList.add("activo"); botones[0].setAttribute("aria-current", "page"); }
  }

  function irAInicioDesdeHistorial() {
    if (typeof window.mostrarInicioDesdeHistorialApp === "function") window.mostrarInicioDesdeHistorialApp();
    else {
      var principal = document.querySelector("main.contenido"), vista = $("vistaHistorialApp");
      if (principal) principal.hidden = false;
      if (vista) vista.hidden = true;
    }
    marcarInicioActivo();
    window.scrollTo({ top: 0 });
  }

  /* Capas de arriba abajo. Cada una devuelve true si ha cerrado/retrocedido algo. */
  var CAPAS = [
    /* diálogos nativos (selector de servicio, ficha de pago/gasto, programar asistencia…) */
    function () {
      var ds = document.querySelectorAll("dialog[open]");
      if (!ds.length) return false;
      var d = ds[ds.length - 1];
      var ev = new Event("cancel", { cancelable: true });
      d.dispatchEvent(ev);
      if (!ev.defaultPrevented && d.open) d.close();
      return true;
    },
    /* eventos: formulario -> lista -> cerrado */
    function () {
      if (!abierto($("panelEventosApp"))) return false;
      return abierto($("formularioEventoApp")) ? pulsar($("volverListaEventosApp")) : pulsar($("cerrarPanelEventosApp"));
    },
    function () { return abierto($("panelCajaPersona")) ? pulsar($("cerrarCajaPersona")) : false; },
    /* detalle del dashboard: categorías -> cerrado */
    function () {
      if (!abierto($("panelDetalleDashboard"))) return false;
      return abierto($("volverCategoriasDashboard")) ? pulsar($("volverCategoriasDashboard")) : pulsar($("cerrarDetalleDashboard"));
    },
    /* paneles a pantalla completa: perros de hoy, pago, gasto */
    function () { return abierto($("panelPago")) ? pulsar($("cerrarPanelPago")) : false; },
    function () { return abierto($("panelGasto")) ? pulsar($("cerrarPanelGasto")) : false; },
    function () { return abierto($("panelAsistencia")) ? pulsar($("cerrarPanelAsistencia")) : false; },
    /* Registro */
    function () {
      var r = $("vistaRegistroApp");
      if (!abierto(r)) return false;
      var baja = $("rgBajaNo");
      if (abierto(baja)) return pulsar(baja);
      var cancelarEdicion = $("rgCancelarEdicion");
      if (abierto(cancelarEdicion)) return pulsar(cancelarEdicion);
      var volver = r.querySelector(".rg-volver");
      if (abierto(volver)) return pulsar(volver);
      return pulsar(document.querySelector('.cab-modulo[data-modulo="gestion"]'));
    },
    /* Facturas */
    function () {
      if (!abierto($("vistaFacturasApp"))) return false;
      return pulsar(document.querySelector('.cab-modulo[data-modulo="gestion"]'));
    },
    /* Historial: ficha del perro -> listado -> inicio */
    function () {
      if (!abierto($("vistaHistorialApp"))) return false;
      if (abierto($("fichaHistorialApp"))) return pulsar($("volverListaHistorialApp"));
      irAInicioDesdeHistorial();
      return true;
    },
    /* Inicio: bajada por semana/mes/año -> nivel anterior */
    function () { return abierto($("navegacionDetallePeriodo")) ? pulsar($("volverNivelDashboard")) : false; }
  ];

  function cerrarCapaSuperior() {
    for (var i = 0; i < CAPAS.length; i++) {
      var hecho = false;
      try { hecho = CAPAS[i](); } catch (e) { console.error("atras.js", e); }
      if (hecho) return true;
    }
    return false;
  }

  function ponerCentinela() {
    try { history.pushState({ marca: MARCA }, "", location.href); hayCentinela = true; } catch (e) { /* sin historial */ }
  }
  function asegurarCentinela() { if (!hayCentinela) ponerCentinela(); }

  window.addEventListener("popstate", function (e) {
    if (e.state && e.state.marca === MARCA) { hayCentinela = true; return; }   // avance hacia el centinela
    hayCentinela = false;
    if (cerrarCapaSuperior()) ponerCentinela();   // se queda en la app, un paso atrás
    else history.back();                          // ya está en el inicio: sale de la app
  });

  /* El centinela se crea tras el primer toque (los navegadores ignoran entradas creadas sin interacción). */
  ["click", "touchend", "keydown"].forEach(function (nombre) {
    document.addEventListener(nombre, asegurarCentinela, { capture: true, passive: true });
  });
  if (history.state && history.state.marca === MARCA) hayCentinela = true;   // recarga estando en el centinela
  else if (navigator.userActivation && navigator.userActivation.hasBeenActive) ponerCentinela();

  window.DoggyAtras = { cerrarCapaSuperior: cerrarCapaSuperior, marcarInicioActivo: marcarInicioActivo };
})();
