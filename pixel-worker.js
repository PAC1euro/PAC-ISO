// Cloudflare Worker — Pixel CRM API (IJLeads)
// Variables d'env : PIXEL_TOKEN (optionnel, sinon valeur par défaut)

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
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

async function createLead(data, env) {
  const TOKEN = env.PIXEL_TOKEN || 'STDR_FB46FDDD-D0ED-416B-A2E6-22CC2F20EC61_PXALLUAIJLEADS';
  const UA    = 'STDR_FB46FDDD-D0ED-416B-A2E6-22CC2F20EC61_PXALLUAIJLEADS';
  const PROJECT_TYPE_ID = 'F5BC8CF1-6ABE-4933-9F97-BA3EB3E02307';

  const tcMap = { 'Gaz':1, 'Fioul':1, 'Chaudière à bois':1, 'Chaudière à charbon':1, 'Électrique':2, 'Autre':1 };
  const thMap = { 'prop_occ':1, 'prop_bail':2, 'locataire':3 };
  // TypeOperationCEE : 2=Chauffage, 3=Chauffage & ECS
  const typeOp = (data.ecs === 'Ballon indépendant') ? 3 : 2;

  const body = {
    ProjectTypeId:      PROJECT_TYPE_ID,
    TypeOperationCEE:   typeOp,
    Civilite1:          data.civilite || 'M.',
    Nom1:               data.nom      || '',
    Prenom1:            data.prenom   || '',
    Adresse:            data.adresse  || '',
    CodePostal:         data.cp       || '',
    Ville:              data.ville    || '',
    TelFixe:            '',
    TelMobile:          data.telephone || '',
    AgeBatiment:        3,
    TypeHabitation:     thMap[data.statut] || 1,
    TypeLogement:       1,
    TypeChauffage:      tcMap[data.chauffage] || 1,
    DealId:             data.dossier  || '',
  };

  const resp = await fetch('https://crm.pixel-crm.com/api/IJLeads', {
    method: 'POST',
    headers: {
      'Content-Type':         'application/json',
      'User-Agent':           UA,
      'XINTNRGLEAD-TOKEN':    TOKEN,
    },
    body: JSON.stringify(body)
  });

  const txt = await resp.text();
  let json = null;
  try { json = JSON.parse(txt); } catch(e) {}

  if (!resp.ok) {
    throw new Error(`API Pixel ${resp.status} — ${txt.slice(0, 300)}`);
  }

  const id = json?.Id || json?.id || json?.DossierId || json?.dossierId
          || json?.PixelDealId || null;
  return { ok: true, id, raw: json ?? txt.slice(0, 300) };
}
