// Rellena estos dos valores con los de tu proyecto de Supabase
// (Project Settings > API). La clave "anon" es pública por diseño:
// la seguridad real la dan las políticas de la base de datos y el inicio de sesión.
window.DOGGY_CONFIG = {
  SUPABASE_URL: "https://mupqpwvyxsrsrrqnxfge.supabase.co",
  // Dirección /exec de la app de Facturas (Apps Script > Implementar > Aplicación web)
  FACTURAS_URL: "https://script.google.com/macros/s/AKfycbykTXIJlrr8Zqq71AkKSKG1DHynXGjDGREhHNCMkxzaR55SmCb6W50CQyeTKROHldHGfQ/exec",
  // Dirección /exec del script que guarda los pasaportes en Drive (ver tools/apps-script-pasaportes.gs)
  PASAPORTES_URL: "https://script.google.com/macros/s/AKfycbyYi-osR-Ow0h-sVhaMEZ2tA3xd45FuDA-rP2xPxTvSxSxh_vMwBfEHRFWbwPqc7cGo/exec",
  // Misma clave que pusiste en el script (evita que cualquiera con la dirección pueda subir archivos)
  PASAPORTES_TOKEN: "Doggy24112026",
  SUPABASE_ANON_KEY: "sb_publishable_8YB4gwe1Zv8q6ThjYryj9g_O9wSNMFa"
};
