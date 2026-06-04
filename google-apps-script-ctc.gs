// Google Apps Script — Click to Call : mise à jour statut
// 1. Ouvrir script.google.com → Nouveau projet
// 2. Coller ce code (remplacer SHEET_ID par ton ID)
// 3. Déployer → Nouvelle déploiement → Application web
//    → Exécuter en tant que : Moi
//    → Accès : Tout le monde
// 4. Copier l'URL de déploiement dans click-to-call.html (GAS_URL)

var SHEET_ID = '1DmJUexyEZLeqa-aGmTEidWWDvDcHHKtuxI_9YE-bo8c';
var SHEET_NAME = ''; // laisser vide pour le premier onglet, ou mettre le nom exact

function getSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  return SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
}

function doPost(e) {
  var cors = { 'Access-Control-Allow-Origin': '*' };
  try {
    var data = JSON.parse(e.postData.contents);
    var tel = String(data.tel || '').replace(/\s/g, '');
    var statut = data.statut || '';

    if (!tel) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: 'tel manquant' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var sheet = getSheet();
    var values = sheet.getDataRange().getValues();

    for (var i = 1; i < values.length; i++) {
      var rowTel = String(values[i][3] || '').replace(/\s/g, '');
      if (rowTel === tel) {
        sheet.getRange(i + 1, 9).setValue(statut); // colonne I = statut (index 8)
        return ContentService
          .createTextOutput(JSON.stringify({ ok: true, row: i + 1 }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'Contact non trouvé' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, message: 'CTC Script actif' }))
    .setMimeType(ContentService.MimeType.JSON);
}
