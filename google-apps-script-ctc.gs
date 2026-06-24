// Google Apps Script — Click to Call : mise à jour statut
// 1. Remplacer le code existant par celui-ci
// 2. Déployer → Gérer les déploiements → ✏️ → Nouvelle version → Déployer

var SHEET_ID = '1DmJUexyEZLeqa-aGmTEidWWDvDcHHKtuxI_9YE-bo8c';
var SHEET_NAME = '';

function getSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  return SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
}

function doGet(e) {
  var params = e.parameter;
  var tel = String(params.tel || '').replace(/\s/g, '');
  var statut = params.statut || '';
  if (!tel) return output({ ok: false, error: 'tel manquant' });

  var sheet = getSheet();
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][3] || '').replace(/\s/g, '') === tel) {
      sheet.getRange(i + 1, 9).setValue(statut);
      return output({ ok: true, row: i + 1 });
    }
  }
  return output({ ok: false, error: 'Contact non trouvé' });
}

function output(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
