// Cloudflare Worker — Pixel CRM API (IJLeads)
// Variables d'env requises : PIXEL_TOKEN

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (request.method === 'GET') {
      const TOKEN = env.PIXEL_TOKEN || '';
      return new Response(JSON.stringify({
        token_present: TOKEN.length > 0,
        token_length:  TOKEN.length,
        token_preview: TOKEN ? TOKEN.slice(0,4) + '...' + TOKEN.slice(-4) : '(vide)',
      }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    try {
      const data = await request.json();
      const result = await createLead(data, env);
      return new Response(JSON.stringify(result), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
  }
};

function buildCommentaire(data) {
  const parts = [];
  if (data.dossier)    parts.push('Dossier: ' + data.dossier);
  if (data.couleur)    parts.push('Couleur ANAH: ' + data.couleur);
  if (data.zone)       parts.push('Zone: ' + data.zone);
  if (data.chauffage)  parts.push('Chauffage: ' + data.chauffage);
  if (data.surfPac)    parts.push('Surface: ' + data.surfPac + 'm²');
  if (data.racPac !== undefined) parts.push('RAC PAC: ' + (data.racPac === 0 ? '1€' : data.racPac + '€'));
  if (data.teleproNom) parts.push('Téléprospecteur: ' + data.teleproNom);
  if (data.codeReferent) parts.push('Référent: ' + data.codeReferent);
  return parts.join(' | ');
}

function buildBody(data, projectTypeId, typeOp) {
  const tcMap = { 'Gaz':1, 'Fioul':1, 'Chaudière à bois':1, 'Chaudière à charbon':1, 'Électrique':2, 'Autre':3 };
  const thMap = { 'prop_occ':1, 'locataire':2, 'prop_bail':3 };

  const body = {
    ProjectTypeId:      projectTypeId,
    TypeOperationCEE:   typeOp,
    TypeLogement:       0,
    DealId:             data.dossier   || '',
    Civilite1:          data.civilite  || 'M.',
    Nom1:               data.nom       || '',
    Prenom1:            data.prenom    || '',
    Mail:               data.email     || '',
    Adresse:            data.adresse   || '',
    CodePostal:         data.cp        || '',
    Ville:              data.ville     || '',
    TelMobile:          data.telephone || '',
    AgeBatiment:        3,
    TypeHabitation:     thMap[data.statut] || 1,
    TypeChauffage:      tcMap[data.chauffage] || 1,
    TypeLead:           'Form',
    Commentaires:       buildCommentaire(data),
  };

  if (data.parts)        body.NbrPersonneAuFoyer = Number(data.parts);
  if (data.rfr)          body.RevenuFiscal       = Number(String(data.rfr).replace(',', '.'));
  if (data.numDeclarant) body.NumFiscal1         = data.numDeclarant;
  if (data.refFiscal1)   body.RefFiscal1         = data.refFiscal1;

  return body;
}

async function tryRequest(body, token, authHeader) {
  const UA = 'STDR_FB46FDDD-D0ED-416B-A2E6-22CC2F20EC61_PXALLUAIJLEADS';
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent':   UA,
  };
  headers[authHeader] = token;

  const resp = await fetch('https://crm.pixel-crm.com/api/IJLeads', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const txt = await resp.text();
  return { status: resp.status, ok: resp.ok, txt };
}

async function createLead(data, env) {
  const TOKEN = env.PIXEL_TOKEN || '';
  if (!TOKEN) throw new Error('PIXEL_TOKEN manquant — à configurer dans Cloudflare Variables');

  // Les 4 combinaisons à tester
  const PROJECT_A = 'F5BC8CF1-6ABE-4933-9F97-BA3EB3E02307'; // ProjectTypeId de William
  const PROJECT_B = TOKEN;                                    // Token utilisé comme ProjectTypeId

  const combos = [
    { projectId: PROJECT_A, typeOp: 2, authHeader: 'XINTNRGLEAD-TOKEN', label: 'A: projA+op2+TOKEN' },
    { projectId: PROJECT_B, typeOp: 2, authHeader: 'XINTNRGLEAD-TOKEN', label: 'B: projB+op2+TOKEN' },
    { projectId: PROJECT_A, typeOp: 3, authHeader: 'XINTNRGLEAD-TOKEN', label: 'C: projA+op3+TOKEN' },
    { projectId: PROJECT_B, typeOp: 3, authHeader: 'XINTNRGLEAD-TOKEN', label: 'D: projB+op3+TOKEN' },
  ];

  const attempts = [];
  for (const combo of combos) {
    const body = buildBody(data, combo.projectId, combo.typeOp);
    const r = await tryRequest(body, TOKEN, combo.authHeader);
    attempts.push({ label: combo.label, status: r.status, response: r.txt.slice(0, 200) });
    if (r.ok) {
      let json = null;
      try { json = JSON.parse(r.txt); } catch(e) {}
      const id = json?.Id || json?.id || json?.DossierId || json?.PixelDealId || null;
      return { ok: true, id, combo: combo.label, raw: json ?? r.txt };
    }
  }

  // Aucune combinaison n'a fonctionné — retourner tous les résultats pour diagnostic
  throw new Error('Toutes les combinaisons ont échoué:\n' + attempts.map(a => `${a.label} → ${a.status}: ${a.response}`).join('\n'));
}
