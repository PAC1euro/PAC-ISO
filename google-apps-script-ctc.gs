// Google Apps Script — Click to Call : mise à jour statut via GET
// 1. Ouvrir script.google.com → Nouveau projet
// 2. Coller ce code
// 3. Déployer → Nouvelle déploiement → Application web
//    → Exécuter en tant que : Moi
//    → Accès : Tout le monde
// 4. Copier l'URL de déploiement dans click-to-call.html (champ URL Google Apps Script)

var SHEET_ID = '1DmJUexyEZLeqa-aGmTEidWWDvDcHHKtuxI_9YE-bo8c';
var SHEET_NAME = ''; // laisser vide pour le premier onglet

function getSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  return SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
}

function doGet(e) {
  var params = e.parameter;
  var tel = String(params.tel || '').replace(/\s/g, '');
  var statut = params.statut || '';

  if (!tel) {
    return output({ ok: false, error: 'tel manquant' });
  }

  var sheet = getSheet();
  var values = sheet.getDataRange().getValues();

  for (var i = 1; i < values.length; i++) {
    var rowTel = String(values[i][3] || '').replace(/\s/g, '');
    if (rowTel === tel) {
      sheet.getRange(i + 1, 9).setValue(statut); // colonne I = statut
      return output({ ok: true, row: i + 1 });
    }
  }

  return output({ ok: false, error: 'Contact non trouvé' });
}

function output(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
