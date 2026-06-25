// Google Apps Script — Proxy Pixel CRM (pac1euro.github.io/PAC-ISO)
// 1. Créer un nouveau projet sur script.google.com
// 2. Coller ce code
// 3. Déployer → Nouvelle application web → Accès : Tout le monde → Déployer
// 4. Copier l'URL et la donner pour mise à jour du site

function doGet(e) {
  var params = e.parameter;
  var action = params.action || '';

  if (action === 'sendPixel') {
    try {
      var data = params.data ? JSON.parse(decodeURIComponent(params.data)) : {};
      var resp = UrlFetchApp.fetch('https://crm.pixel-crm.com/api/IJLeads', {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'XINTNRGLEAD-TOKEN': '9548609a-3104-461e-9fff-241b9df3fe1e',
          'User-Agent': 'STDR_FB46FDDD-D0ED-416B-A2E6-22CC2F20EC61_PXALLUAILEADS'
        },
        payload: JSON.stringify(data),
        muteHttpExceptions: true
      });
      var code = resp.getResponseCode();
      return output({ ok: code < 300, code: code, body: resp.getContentText() });
    } catch(err) {
      return output({ ok: false, error: err.toString() });
    }
  }

  return output({ ok: false, error: 'action inconnue' });
}

function output(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
