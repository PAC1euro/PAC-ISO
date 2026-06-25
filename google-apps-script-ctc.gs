// Google Apps Script — Click to Call : sync statuts + compteur d'appels
// Remplacer le code et déployer → Gérer les déploiements → ✏️ → Nouvelle version → Déployer

function doGet(e) {
  var params = e.parameter;
  var action = params.action || 'setStatut';

  if (action === 'getStatuts') {
    var props = PropertiesService.getScriptProperties().getProperties();
    var statuts = {};
    for (var k in props) {
      if (k.indexOf('s_') === 0) statuts[k.slice(2)] = props[k];
    }
    return output({ ok: true, statuts: statuts });
  }

  if (action === 'addCall') {
    var key = 'calls_' + today();
    var props = PropertiesService.getScriptProperties();
    var count = parseInt(props.getProperty(key) || '0', 10) + 1;
    props.setProperty(key, String(count));
    return output({ ok: true, count: count });
  }

  if (action === 'getCallCount') {
    var count = parseInt(PropertiesService.getScriptProperties().getProperty('calls_' + today()) || '0', 10);
    return output({ ok: true, count: count });
  }

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

  // action setStatut (défaut)
  var tel = String(params.tel || '').replace(/\s/g, '');
  var statut = params.statut !== undefined ? params.statut : '';
  if (!tel) return output({ ok: false, error: 'tel manquant' });

  if (statut) {
    PropertiesService.getScriptProperties().setProperty('s_' + tel, statut);
  } else {
    PropertiesService.getScriptProperties().deleteProperty('s_' + tel);
  }
  return output({ ok: true });
}

function today() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function output(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
