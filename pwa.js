/* Instalación de la app (PWA): service worker y botón "Instalar". */
(function () {
  "use strict";
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function (e) { console.warn("SW:", e); });
    });
  }
  var evento = null;
  function instalada() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
  }
  function esIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function boton() { return document.getElementById("botonInstalarApp"); }

  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); evento = e; });
  window.addEventListener("appinstalled", function () { evento = null; if (boton()) boton().hidden = true; });

  document.addEventListener("DOMContentLoaded", function () {
    var b = boton();
    if (!b) return;
    if (instalada()) { b.hidden = true; return; }
    b.hidden = false;
    b.addEventListener("click", function () {
      if (evento) {
        evento.prompt();
        evento.userChoice.then(function () { evento = null; });
      } else if (esIOS()) {
        window.alert("Para instalar la app en iPhone o iPad:\n\n1. Abre esta página en Safari.\n2. Pulsa el botón Compartir (cuadrado con flecha).\n3. Elige «Añadir a pantalla de inicio».");
      } else {
        window.alert("Para instalar la app:\n\nAbre el menú del navegador (⋮) y elige «Instalar app» o «Añadir a pantalla de inicio».");
      }
    });
  });
})();
