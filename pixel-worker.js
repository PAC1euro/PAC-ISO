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

// Extrait tous les Set-Cookie d'une réponse (gère les headers multiples)
function extractCookies(response) {
  try {
    const all = response.headers.getAll('set-cookie');
    if (all && all.length > 0) return all;
  } catch(e) {}
  const raw = response.headers.get('set-cookie') || '';
  if (!raw) return [];
  return raw.split(/,(?=[^ ]*?=)/);
}

// Fusionne des cookies existants avec de nouveaux (tableau de strings Set-Cookie)
function mergeCookies(existing, newCookies) {
  const map = {};
  (existing || '').split('; ').forEach(c => {
    const i = c.indexOf('=');
    if (i > 0) map[c.slice(0, i).trim()] = c.slice(i + 1);
  });
  (Array.isArray(newCookies) ? newCookies : (newCookies ? [newCookies] : [])).forEach(cookie => {
    if (!cookie) return;
    const kv = cookie.split(';')[0].trim();
    const i = kv.indexOf('=');
    if (i > 0) map[kv.slice(0, i).trim()] = kv.slice(i + 1);
  });
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ');
}

// Fetch GET avec suivi MANUEL des redirects pour capturer tous les cookies intermédiaires
async function fetchFollow(url, baseHeaders, cookies, maxHops = 10) {
  const UA = baseHeaders['User-Agent'] || '';
  let currentUrl = url;
  let currentCookies = cookies;

  for (let hops = 0; hops < maxHops; hops++) {
    const r = await fetch(currentUrl, {
      headers: { ...baseHeaders, 'Cookie': currentCookies },
      redirect: 'manual'
    });
    currentCookies = mergeCookies(currentCookies, extractCookies(r));

    if (r.status === 301 || r.status === 302 || r.status === 303 || r.status === 307 || r.status === 308) {
      let loc = r.headers.get('location') || '';
      if (!loc) throw new Error('Redirect sans Location header');
      if (!loc.startsWith('http')) loc = new URL(loc, currentUrl).href;
      currentUrl = loc;
      continue;
    }

    const html = await r.text();
    return { html, cookies: currentCookies, finalUrl: currentUrl };
  }
  throw new Error('Trop de redirections (>' + maxHops + ')');
}

function extractToken(html) {
  let m = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
  if (!m) m = html.match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/);
  return m ? m[1] : null;
}

function extractHiddenFields(html) {
  const fields = {};
  const re = /<input[^>]+type=["']?hidden["']?[^>]*>/gi;
  let tag;
  while ((tag = re.exec(html)) !== null) {
    const nm = tag[0].match(/name=["']([^"']+)["']/i);
    const vl = tag[0].match(/value=["']([^"']*)["']/i);
    if (nm) fields[nm[1]] = vl ? vl[1] : '';
  }
  return fields;
}

async function createDossier(data, env) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const BASE = 'https://crm.pixel-crm.com';
  const CODE = env.PIXEL_CODE || 'C2307';
  const USER = env.PIXEL_USER || 'MAXIME';
  const PASS = env.PIXEL_PASSWORD || 'Maxime.paciso1';
  const baseHdrs = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
    'Accept-Language': 'fr-FR,fr;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
  };

  // 1. Page de login → champs cachés + token CSRF
  const p1 = await fetch(`${BASE}/Account/Login`, { headers: baseHdrs });
  let cookies = mergeCookies('', extractCookies(p1));
  const loginHtml = await p1.text();
  const hiddenFields = extractHiddenFields(loginHtml);
  if (!hiddenFields['__RequestVerificationToken']) {
    throw new Error('Token login introuvable — page: ' + loginHtml.slice(0, 120));
  }

  // 2. POST login
  const loginBody = new URLSearchParams({
    ...hiddenFields,
    'CodeEntreprise': CODE,
    'UserName': USER,
    'Password': PASS,
    'RememberMe': 'false'
  });
  const p2 = await fetch(`${BASE}/Account/Login`, {
    method: 'POST',
    headers: {
      ...baseHdrs,
      'Cookie': cookies,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${BASE}/Account/Login`,
      'Origin': BASE,
    },
    body: loginBody.toString(),
    redirect: 'manual'
  });
  cookies = mergeCookies(cookies, extractCookies(p2));

  // 3. Gérer la réponse du login (302 ou 200)
  let nextUrl = p2.headers.get('location');
  if (!nextUrl) {
    const p2body = await p2.text();
    if (p2body.includes('name="Password"') || p2body.includes('id="Password"')) {
      const errMatch = p2body.match(/class="[^"]*validation[^"]*"[^>]*>([\s\S]{0,200})/i)
        || p2body.match(/<li>([\s\S]{0,100})<\/li>/i);
      const msg = errMatch ? errMatch[1].replace(/<[^>]+>/g, '').trim() : 'Identifiants rejetés';
      throw new Error('Login échoué — ' + msg);
    }
    // 200 + dashboard = connecté directement
  } else {
    // Suivre les redirections post-login manuellement (capturer tous les cookies)
    let hops = 0;
    while (nextUrl && hops++ < 10) {
      const fullUrl = nextUrl.startsWith('http') ? nextUrl : `${BASE}${nextUrl}`;
      if (fullUrl.toLowerCase().includes('/account/login')) {
        throw new Error('Connexion échouée — redirection vers login');
      }
      const hop = await fetch(fullUrl, {
        headers: { ...baseHdrs, 'Cookie': cookies },
        redirect: 'manual'
      });
      cookies = mergeCookies(cookies, extractCookies(hop));
      if (hop.status === 301 || hop.status === 302 || hop.status === 303) {
        nextUrl = hop.headers.get('location') || '';
        if (nextUrl && !nextUrl.startsWith('http')) nextUrl = `${BASE}${nextUrl}`;
      } else {
        nextUrl = null;
      }
    }
  }

  // 4. Charger le formulaire de création — suivi MANUEL pour capturer TOUS les cookies
  const { html: createHtml, cookies: c4 } = await fetchFollow(
    `${BASE}/Dossiers/isolation/fiche/create`,
    { ...baseHdrs, 'Referer': BASE },
    cookies
  );
  cookies = c4;

  if (createHtml.includes('/Account/Login') && !createHtml.includes('FicheISO_VM')) {
    throw new Error('Session invalide après login — redirection vers login sur le formulaire');
  }
  const csrfToken = extractToken(createHtml);
  if (!csrfToken) throw new Error(`Token CSRF introuvable — HTML: ${createHtml.slice(0, 200)}`);

  // 5. Commentaire
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
  const statutMap = { 'prop_occ': '1', 'prop_bail': '2', 'locataire': '3' };
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
      'User-Agent': UA,
      'Cookie': cookies,
      'Referer': `${BASE}/Dossiers/isolation/fiche/create`,
      'Origin': BASE,
    },
    body: form,
    redirect: 'manual'
  });

  if (p5.status === 302) {
    const loc = p5.headers.get('location') || '';
    if (loc.toLowerCase().includes('/account/login')) {
      throw new Error('Session invalide à la soumission — redirection login. Réessaye.');
    }
    const idMatch = loc.match(/id=([a-f0-9-]+)/i);
    const id = idMatch ? idMatch[1] : null;
    if (!id) throw new Error("Soumission acceptée mais pas d'ID retourné — redirect: " + loc);
    return { ok: true, id, url: `${BASE}/Dossiers/Isolation/Fiche/N_EditMain?id=${id}` };
  }

  const txt = await p5.text();
  const valErr = txt.match(/class="[^"]*field-validation-error[^"]*"[^>]*>([^<]{1,150})/i)
    || txt.match(/class="[^"]*validation-summary[^"]*"[\s\S]{0,100}<li>([^<]{1,150})/i);
  throw new Error('Validation Pixel CRM — ' + (valErr ? valErr[1].trim() : `HTTP ${p5.status} — ${txt.slice(0, 200)}`));
}
