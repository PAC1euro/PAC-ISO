// ============================================================
// PAC à 1€ — CRM Backend (Google Apps Script)
// Déployer comme Application Web : accès "Tout le monde"
// ============================================================

var LEADS_SHEET = 'Leads';
var DOSSIERS_SHEET = 'Dossiers';

var LEADS_HEADERS = [
  'id','formDate','prenom','nom','telephone','email','cp','zone',
  'projet','chauffage','surface','annee','statut','personnes','revenus',
  'devis','devisAge','anahColor','anahLab','anahMpr','anahRac','eligibilite',
  'status','comment','transferred'
];

var DOSSIERS_HEADERS = [
  'id','formDate','dossier','nom','prenom','dateNaissance','telephone','email',
  'adresse','cp','ville','dept','zone','isIDF','parts','numDeclarant','rfr',
  'couleur','chauffage','surfPac','ecs','vmc','compteur','gestes','surfIso',
  'racPac','racIso','teleproNom','codeReferent','totalRac','anneeConstruction'
];

function doGet(e) {
  var params = e.parameter;
  var action = params.action || 'getLeads';
  var output;

  try {
    if (action === 'addLead') {
      output = addLead(decodeData(params.data));
    } else if (action === 'addDossier') {
      output = addDossier(decodeData(params.data));
    } else if (action === 'updateLead') {
      output = updateLead(params.id, params.status, params.comment, params.transferred);
    } else if (action === 'getLeads') {
      output = getSheetRows(LEADS_SHEET, LEADS_HEADERS);
    } else if (action === 'getDossiers') {
      output = getSheetRows(DOSSIERS_SHEET, DOSSIERS_HEADERS);
    } else {
      output = { error: 'Action inconnue : ' + action };
    }
  } catch (err) {
    output = { error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

// Décoder les données base64 envoyées depuis client.html / index.html
function decodeData(b64) {
  var bytes = Utilities.base64Decode(b64);
  var json = Utilities.newBlob(bytes).getDataAsString();
  return JSON.parse(json);
}

// Récupérer ou créer une feuille avec les headers
function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    var hdrRange = sheet.getRange(1, 1, 1, headers.length);
    hdrRange.setValues([headers]);
    hdrRange.setFontWeight('bold');
    hdrRange.setBackground('#0f172a');
    hdrRange.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Lire toutes les lignes d'une feuille sous forme d'objets
function getSheetRows(sheetName, headers) {
  var sheet = getOrCreateSheet(sheetName, headers);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  var hdrs = values[0];
  return values.slice(1).map(function(row) {
    var obj = {};
    hdrs.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
}

// Ajouter un lead (depuis client.html)
function addLead(data) {
  var sheet = getOrCreateSheet(LEADS_SHEET, LEADS_HEADERS);
  // Éviter les doublons par ID
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(data.id)) return { ok: true, duplicate: true };
  }
  var row = LEADS_HEADERS.map(function(h) {
    if (h === 'status') return 'nouveau';
    if (h === 'comment') return '';
    if (h === 'transferred') return '';
    return data[h] !== undefined ? data[h] : '';
  });
  sheet.appendRow(row);
  return { ok: true };
}

// Ajouter un dossier (depuis index.html)
function addDossier(data) {
  var sheet = getOrCreateSheet(DOSSIERS_SHEET, DOSSIERS_HEADERS);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(data.id)) return { ok: true, duplicate: true };
  }
  var row = DOSSIERS_HEADERS.map(function(h) {
    return data[h] !== undefined ? data[h] : '';
  });
  sheet.appendRow(row);
  return { ok: true };
}

// Mettre à jour le statut / commentaire / transfert d'un lead
function updateLead(id, status, comment, transferred) {
  var sheet = getOrCreateSheet(LEADS_SHEET, LEADS_HEADERS);
  var values = sheet.getDataRange().getValues();
  var hdrs = values[0];
  var idIdx = hdrs.indexOf('id');
  var statusIdx = hdrs.indexOf('status');
  var commentIdx = hdrs.indexOf('comment');
  var transferredIdx = hdrs.indexOf('transferred');

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idIdx]) === String(id)) {
      if (status !== undefined && status !== '' && statusIdx > -1) {
        sheet.getRange(i + 1, statusIdx + 1).setValue(status);
      }
      if (comment !== undefined && commentIdx > -1) {
        sheet.getRange(i + 1, commentIdx + 1).setValue(comment);
      }
      if (transferred !== undefined && transferred !== '' && transferredIdx > -1) {
        sheet.getRange(i + 1, transferredIdx + 1).setValue(transferred);
      }
      return { ok: true };
    }
  }
  return { ok: false, error: 'Lead introuvable : ' + id };
}
