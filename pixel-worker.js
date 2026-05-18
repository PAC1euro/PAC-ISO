// Cloudflare Worker — Pixel CRM API (IJLeads)
// Variables d'env requises : PIXEL_TOKEN, optionnel PIXEL_PROJECT_ID

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // GET /?debug → vérifie que le token est chargé
    if (request.method === 'GET') {
      const TOKEN = env.PIXEL_TOKEN || '';
      const PROJECT_ID = env.PIXEL_PROJECT_ID || 'F5BC8CF1-6ABE-4933-9F97-BA3EB3E02307';
      return new Response(JSON.stringify({
        token_present: TOKEN.length > 0,
        token_length:  TOKEN.length,
        token_preview: TOKEN ? TOKEN.slice(0,4) + '...' + TOKEN.slice(-4) : '(vide)',
        project_id:    PROJECT_ID,
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

async function createLead(data, env) {
  const TOKEN = env.PIXEL_TOKEN || '';
  const UA    = 'STDR_FB46FDDD-D0ED-416B-A2E6-22CC2F20EC61_PXALLUAIJLEADS';
  const PROJECT_TYPE_ID = env.PIXEL_PROJECT_ID || 'F5BC8CF1-6ABE-4933-9F97-BA3EB3E02307';

  if (!TOKEN) throw new Error('PIXEL_TOKEN manquant — à configurer dans Cloudflare Variables');

  // TypeChauffage : 1=Combustible, 2=Electrique, 3=Individuel
  const tcMap = { 'Gaz':1, 'Fioul':1, 'Chaudière à bois':1, 'Chaudière à charbon':1, 'Électrique':2, 'Autre':3 };
  // TypeHabitation : 1=Propriétaire occupant, 2=Locataire, 3=Propriétaire bailleur
  const thMap = { 'prop_occ':1, 'locataire':2, 'prop_bail':3 };
  // TypeOperationCEE : 1=Isolation, 2=Chauffage, 3=Chauffage+ECS
  const typeOp = 3;
  // TypeLogement : 0=Maison individuelle, 1=Appartement
  const typeLog = 0;

  const body = {
    ProjectTypeId:      PROJECT_TYPE_ID,
    TypeOperationCEE:   typeOp,
    TypeLogement:       typeLog,
    DealId:             data.dossier    || '',
    Civilite1:          data.civilite   || 'M.',
    Nom1:               data.nom        || '',
    Prenom1:            data.prenom     || '',
    Mail:               data.email      || '',
    Adresse:            data.adresse    || '',
    CodePostal:         data.cp         || '',
    Ville:              data.ville      || '',
    TelFixe:            '',
    TelMobile:          data.telephone  || '',
    AgeBatiment:        3,
    TypeHabitation:     thMap[data.statut] || 1,
    TypeChauffage:      tcMap[data.chauffage] || 1,
    NbrPersonneAuFoyer: data.parts ? Number(data.parts) : undefined,
    RevenuFiscal:       data.rfr  ? Number(String(data.rfr).replace(',', '.')) : undefined,
    NumFiscal1:         data.numDeclarant  || '',
    RefFiscal1:         data.refFiscal1   || '',
    TypeLead:           'Form',
    Commentaires:       buildCommentaire(data),
  };

  Object.keys(body).forEach(k => { if (body[k] === undefined) delete body[k]; });

  const resp = await fetch('https://crm.pixel-crm.com/api/IJLeads', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'User-Agent':        UA,
      'XINTNRGLEAD-TOKEN': TOKEN,
    },
    body: JSON.stringify(body)
  });

  const txt = await resp.text();
  let json = null;
  try { json = JSON.parse(txt); } catch(e) {}

  if (!resp.ok) {
    throw new Error(`API Pixel ${resp.status} — ${txt}`);
  }

  const id = json?.Id || json?.id || json?.DossierId || json?.dossierId || json?.PixelDealId || null;
  return { ok: true, id, raw: json ?? txt };
}
