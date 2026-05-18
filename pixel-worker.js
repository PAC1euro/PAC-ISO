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

  // Extraire tous les champs cachés du formulaire create (incluent tokens ASP.NET requis)
  const createHidden = extractHiddenFields(createHtml);

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

  // 6. POST dossier — URLSearchParams (comme le login) + tous les champs cachés du form
  const typeOp = (data.ecs === 'Ballon indépendant') ? 'Chauffage & ECS' : 'Chauffage';
  const statutMap = { 'prop_occ': '1', 'prop_bail': '2', 'locataire': '3' };

  // Partir des champs cachés de la page create, puis surcharger avec nos valeurs
  const formFields = { ...createHidden };
  const set = (k, v) => { formFields[k] = v != null ? String(v) : ''; };

  set('FicheISO_VM.TypeOperationCEE', typeOp);
  set('Fiche_VM.Civilite', data.civilite || 'M.');
  set('Fiche_VM.Nom', data.nom);
  set('Fiche_VM.Prenom', data.prenom);
  set('FicheISO_VM.Civilite', data.civilite || '');
  set('FicheISO_VM.Nom', data.nom);
  set('FicheISO_VM.Prenom', data.prenom);
  set('Fiche_VM.Adresse', data.adresse);
  set('Fiche_VM.ComplAdresse', '');
  set('Fiche_VM.CodePostal', data.cp);
  set('Fiche_VM.Ville', data.ville);
  set('Fiche_VM.Mail', data.email);
  set('Fiche_VM.TelFixe', '');
  set('Fiche_VM.TelMobile', data.telephone);
  set('FicheISO_VM.MemeAdresse', 'true');
  set('FicheISO_VM.AdresseChantier', data.adresse);
  set('FicheISO_VM.ComplAdresseChantier', '');
  set('FicheISO_VM.CodePostalChantier', data.cp);
  set('FicheISO_VM.VilleChantier', data.ville);
  set('FicheISO_VM.TypeChauffage', '1');
  set('FicheISO_VM.TypeEnergie', '');
  set('FicheISO_VM.ParcelleCadastral', '');
  set('FicheISO_VM.NbrFoyer', '1');
  set('FicheISO_VM.NbrPersonneAuFoyer', data.parts || '1');
  set('FicheISO_VM.AgeBatiment', '3');
  set('FicheISO_VM.SurfaceComblesSoufle', '');
  set('FicheISO_VM.SurfaceComblesDeroule', '');
  set('FicheISO_VM.SurfaceRampant', '');
  set('FicheISO_VM.SurfaceMur', '');
  set('FicheISO_VM.SurfaceMurExterieur', '');
  set('FicheISO_VM.SurfacePignon', '');
  set('FicheISO_VM.SurfacePlafond', '');
  set('FicheISO_VM.SurfaceVideSanitaire', '');
  set('Fiche_VM.TypeLead', 'Form');
  set('Fiche_VM.Campagne', 'PREMIUM ENERGY - H1&H2 2K MAX');
  set('Fiche_VM.FournisseurLeadId', '');
  set('FicheISO_Statut_VM.WorkflowStatutId', '443f3db6-ff41-423b-933e-de2411fb824b');
  set('Fiche_VM.OperateurId', 'f2d9f341-2573-40e1-8b70-4f480b1555e4');
  set('Fiche_VM.AdministrateurId', '');
  set('Fiche_VM.Commentaire', commentaire);
  set('FicheISO_VM.Id', '00000000-0000-0000-0000-000000000000');
  set('FicheISO_VM.OrganismeId', '');
  set('FicheISO_VM.AnneeImpot', '');
  set('FicheISO_VM.AnneeRevenu', data.dateNaissance ? data.dateNaissance.slice(-4) : '');
  set('Fiche_VM.BeneficiePrimeCEE', 'False');
  set('RetenirAvisFiscal', 'False');
  set('AvisFiscauxJson', '');
  set('AvisFiscal_Multi_VM.NumFiscal1', data.numDeclarant || '');
  set('AvisFiscal_Multi_VM.RefFiscal1', '');
  set('__RequestVerificationToken', csrfToken);
  set('FicheISO_VM.TypeHabitation', statutMap[data.statut] || '1');
  set('FicheISO_VM.RevenuFiscal', data.rfr ? String(data.rfr).replace('.', ',') : '0,00');

  const postBody = new URLSearchParams(formFields);

  const p5 = await fetch(`${BASE}/Dossiers/isolation/fiche/create`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Cookie': cookies,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${BASE}/Dossiers/isolation/fiche/create`,
    },
    body: postBody.toString(),
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
