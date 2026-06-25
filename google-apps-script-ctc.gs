// Google Apps Script — Click to Call : sync statuts cross-device
// 1. Remplacer le code existant par celui-ci
// 2. Déployer → Gérer les déploiements → ✏️ → Nouvelle version → Déployer

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

function output(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
