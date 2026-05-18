// Cloudflare Worker — Pixel CRM proxy
// Déployer sur https://dash.cloudflare.com → Workers & Pages → Create Worker
// Variables d'env à configurer : PIXEL_CODE, PIXEL_USER, PIXEL_PASSWORD

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
      const result = await createDossier(data, env);
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

function mergeCookies(existing, setCookieHeader) {
  if (!setCookieHeader) return existing;
  const map = {};
  (existing || '').split('; ').forEach(c => {
    const i = c.indexOf('=');
    if (i > 0) map[c.slice(0, i).trim()] = c.slice(i + 1);
  });
  setCookieHeader.split(/,(?=[^ ]*?=)/).forEach(part => {
    const kv = part.split(';')[0].trim();
    const i = kv.indexOf('=');
    if (i > 0) map[kv.slice(0, i).trim()] = kv.slice(i + 1);
  });
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ');
}

function extractToken(html) {
  const m = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
  return m ? m[1] : null;
}

async function createDossier(data, env) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const BASE = 'https://crm.pixel-crm.com';
  const CODE = env.PIXEL_CODE || 'C2307';
  const USER = env.PIXEL_USER || 'MAXIME';
  const PASS = env.PIXEL_PASSWORD || 'Maxime.paciso1';

  // 1. Login page → CSRF token
  const p1 = await fetch(`${BASE}/Account/Login`, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' }
  });
  let cookies = mergeCookies('', p1.headers.get('set-cookie') || '');
  const loginToken = extractToken(await p1.text());
  if (!loginToken) throw new Error('Token login introuvable');

  // 2. POST login
  const loginBody = new URLSearchParams({
    '__RequestVerificationToken': loginToken,
    'CodeEntreprise': CODE,
    'UserName': USER,
    'Password': PASS
  });
  const p2 = await fetch(`${BASE}/Account/Login`, {
    method: 'POST',
    headers: {
      'User-Agent': UA, 'Cookie': cookies,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${BASE}/Account/Login`
    },
    body: loginBody.toString(),
    redirect: 'manual'
  });
  cookies = mergeCookies(cookies, p2.headers.get('set-cookie') || '');

  // 3. Follow ALL redirects after login (can be multiple hops)
  let nextUrl = p2.headers.get('location');
  if (!nextUrl) throw new Error('Pas de redirection après login — identifiants rejetés');
  let hops = 0;
  while (nextUrl && hops++ < 6) {
    const fullUrl = nextUrl.startsWith('http') ? nextUrl : `${BASE}${nextUrl}`;
    if (fullUrl.includes('/Account/Login')) throw new Error('Connexion échouée — identifiants incorrects ou compte bloqué');
    const hop = await fetch(fullUrl, {
      headers: { 'User-Agent': UA, 'Cookie': cookies, 'Accept': 'text/html,application/xhtml+xml' },
      redirect: 'manual'
    });
    cookies = mergeCookies(cookies, hop.headers.get('set-cookie') || '');
    if (hop.status === 301 || hop.status === 302) {
      nextUrl = hop.headers.get('location');
    } else {
      nextUrl = null;
    }
  }

  // 4. Load create form → CSRF token
  const p4 = await fetch(`${BASE}/Dossiers/isolation/fiche/create`, {
    headers: { 'User-Agent': UA, 'Cookie': cookies, 'Referer': BASE, 'Accept': 'text/html,application/xhtml+xml' }
  });
  cookies = mergeCookies(cookies, p4.headers.get('set-cookie') || '');
  const createHtml = await p4.text();
  if (createHtml.includes('/Account/Login') && !createHtml.includes('FicheISO_VM')) {
    throw new Error('Session invalide après login — redirection vers login détectée sur le formulaire');
  }
  const csrfToken = extractToken(createHtml);
  if (!csrfToken) throw new Error(`Token CSRF introuvable — HTML reçu: ${createHtml.slice(0, 200)}`);

  // 5. Build commentaire
  const parts = [];
  if (data.dossier) parts.push('Dossier: ' + data.dossier);
  if (data.couleur) parts.push('Couleur ANAH: ' + data.couleur);
  if (data.zone) parts.push('Zone: ' + data.zone);
  if (data.chauffage) parts.push('Chauffage: ' + data.chauffage);
  if (data.surfPac) parts.push('Surface: ' + data.surfPac + 'm²');
  if (data.racPac !== undefined) parts.push('RAC PAC: ' + (data.racPac === 0 ? '1€' : data.racPac + '€'));
  if (data.teleproNom) parts.push('Téléprospecteur: ' + data.teleproNom);
  if (data.codeReferent) parts.push('Référent: ' + data.codeReferent);
  const commentaire = parts.join(' | ');

  // 6. POST dossier
  const form = new FormData();
  const a = (k, v) => form.append(k, v != null ? String(v) : '');
  const typeOp = (data.ecs === 'Ballon indépendant') ? 'Chauffage & ECS' : 'Chauffage';
  a('FicheISO_VM.TypeOperationCEE', typeOp);
  a('Fiche_VM.Civilite', data.civilite || 'M.');
  a('Fiche_VM.Nom', data.nom);
  a('Fiche_VM.Prenom', data.prenom);
  a('FicheISO_VM.Civilite', data.civilite || '');
  a('FicheISO_VM.Nom', data.nom);
  a('FicheISO_VM.Prenom', data.prenom);
  a('Fiche_VM.Adresse', data.adresse);
  a('Fiche_VM.ComplAdresse', '');
  a('Fiche_VM.CodePostal', data.cp);
  a('Fiche_VM.Ville', data.ville);
  a('Fiche_VM.Mail', data.email);
  a('Fiche_VM.TelFixe', '');
  a('Fiche_VM.TelMobile', data.telephone);
  a('FicheISO_VM.MemeAdresse', 'true');
  a('FicheISO_VM.AdresseChantier', data.adresse);
  a('FicheISO_VM.ComplAdresseChantier', '');
  a('FicheISO_VM.CodePostalChantier', data.cp);
  a('FicheISO_VM.VilleChantier', data.ville);
  a('FicheISO_VM.TypeChauffage', '1');
  a('FicheISO_VM.TypeEnergie', '');
  const statutMap = {'prop_occ':'1','prop_bail':'2','locataire':'3'};
  a('FicheISO_VM.TypeHabitation', statutMap[data.statut] || '1');
  a('FicheISO_VM.ParcelleCadastral', '');
  a('FicheISO_VM.RevenuFiscal', data.rfr ? String(data.rfr).replace('.', ',') : '0,00');
  a('FicheISO_VM.NbrFoyer', '1');
  a('FicheISO_VM.NbrPersonneAuFoyer', data.parts || '1');
  a('FicheISO_VM.AgeBatiment', '3');
  a('FicheISO_VM.SurfaceComblesSoufle', '');
  a('FicheISO_VM.SurfaceComblesDeroule', '');
  a('FicheISO_VM.SurfaceRampant', '');
  a('FicheISO_VM.SurfaceMur', '');
  a('FicheISO_VM.SurfaceMurExterieur', '');
  a('FicheISO_VM.SurfacePignon', '');
  a('FicheISO_VM.SurfacePlafond', '');
  a('FicheISO_VM.SurfaceVideSanitaire', '');
  a('Fiche_VM.TypeLead', 'Form');
  a('Fiche_VM.Campagne', 'PREMIUM ENERGY - H1&H2 2K MAX');
  a('Fiche_VM.FournisseurLeadId', '');
  a('FicheISO_Statut_VM.WorkflowStatutId', '443f3db6-ff41-423b-933e-de2411fb824b');
  a('Fiche_VM.OperateurId', 'f2d9f341-2573-40e1-8b70-4f480b1555e4');
  a('Fiche_VM.AdministrateurId', '');
  a('Fiche_VM.Commentaire', commentaire);
  a('FicheISO_VM.Id', '00000000-0000-0000-0000-000000000000');
  a('FicheISO_VM.OrganismeId', '');
  a('FicheISO_VM.AnneeImpot', '');
  a('FicheISO_VM.AnneeRevenu', data.dateNaissance ? data.dateNaissance.slice(-4) : '');
  a('Fiche_VM.BeneficiePrimeCEE', 'False');
  a('RetenirAvisFiscal', 'False');
  a('AvisFiscauxJson', '');
  a('AvisFiscal_Multi_VM.NumFiscal1', data.numDeclarant || '');
  a('AvisFiscal_Multi_VM.RefFiscal1', '');
  form.append('__RequestVerificationToken', csrfToken);

  const p5 = await fetch(`${BASE}/Dossiers/isolation/fiche/create`, {
    method: 'POST',
    headers: {
      'User-Agent': UA, 'Cookie': cookies,
      'Referer': `${BASE}/Dossiers/isolation/fiche/create`
    },
    body: form,
    redirect: 'manual'
  });

  if (p5.status === 302) {
    const loc = p5.headers.get('location') || '';
    const idMatch = loc.match(/id=([a-f0-9-]+)/i);
    const id = idMatch ? idMatch[1] : null;
    return { ok: true, id, url: id ? `${BASE}/Dossiers/Isolation/Fiche/N_EditMain?id=${id}` : `${BASE}${loc}` };
  }

  const txt = await p5.text();
  throw new Error(`Réponse inattendue (${p5.status}) — ${txt.slice(0, 300)}`);
}
