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
      // Mode debug : retourne la trace des cookies à chaque étape
      if (data.debug || data.probe) {
        const result = await debugLogin(data, env);
        return new Response(JSON.stringify(result), {
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
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
  // Sépare sur , suivi d'un nom de cookie (lettre/point/underscore puis =)
  // Gère ", name=" ET ",name=" sans casser les dates "Mon, 18 May"
  return raw.split(/,\s*(?=[A-Za-z_.][^;,= ]*\s*=)/);
}

// Noms des cookies présents (pour debug)
function cookieNames(str) {
  return (str || '').split('; ').map(c => c.split('=')[0]).filter(Boolean);
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
  let currentUrl = url;
  let currentCookies = cookies;

  for (let hops = 0; hops < maxHops; hops++) {
    const cookiesSent = currentCookies;
    const r = await fetch(currentUrl, {
      headers: { ...baseHeaders, 'Cookie': cookiesSent },
      redirect: 'manual'
    });
    // Met à jour currentCookies avec les cookies de la réponse
    currentCookies = mergeCookies(currentCookies, extractCookies(r));

    if (r.status === 301 || r.status === 302 || r.status === 303 || r.status === 307 || r.status === 308) {
      let loc = r.headers.get('location') || '';
      if (!loc) throw new Error('Redirect sans Location header');
      if (!loc.startsWith('http')) loc = new URL(loc, currentUrl).href;
      currentUrl = loc;
      continue;
    }

    const html = await r.text();
    // Retourner cookiesSent (pas currentCookies) — le token CSRF est lié aux cookies envoyés au GET
    return { html, cookies: cookiesSent, currentCookies, finalUrl: currentUrl };
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

// ─── Mode debug/probe : trace les cookies + cherche une API ──────────────────
async function debugLogin(data, env) {
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

  const trace = [];

  // 1. GET login
  const p1 = await fetch(`${BASE}/Account/Login`, { headers: baseHdrs });
  let cookies = mergeCookies('', extractCookies(p1));
  trace.push({ step: '1_GET_login', status: p1.status, cookies: cookieNames(cookies) });

  const loginHtml = await p1.text();
  const hiddenFields = extractHiddenFields(loginHtml);

  // Capturer tous les champs input du formulaire (pas seulement hidden)
  const allInputs = [];
  const reInput = /<input[^>]*>/gi;
  let m2;
  while ((m2 = reInput.exec(loginHtml)) !== null) {
    const nm = m2[0].match(/name=["']([^"']+)["']/i);
    const tp = m2[0].match(/type=["']([^"']+)["']/i);
    if (nm) allInputs.push({ name: nm[1], type: tp ? tp[1] : 'text' });
  }
  // Extrait la portion form du HTML
  const formMatch = loginHtml.match(/<form[\s\S]{0,5000}?<\/form>/i);
  const loginFormHtml = formMatch ? formMatch[0].replace(/<script[\s\S]*?<\/script>/gi,'').slice(0, 2000) : loginHtml.slice(0, 2000);

  if (!hiddenFields['__RequestVerificationToken']) {
    return { ok: false, trace, error: 'Token login introuvable', allInputs, loginFormHtml };
  }

  // 2. POST login — noms réels : Input.CustomerCode / Input.UserName / Input.Password
  const loginBody = new URLSearchParams({
    ...hiddenFields,
    'Input.CustomerCode': CODE,
    'Input.UserName': USER,
    'Input.Password': PASS,
  });
  const p2 = await fetch(`${BASE}/Account/Login`, {
    method: 'POST',
    headers: { ...baseHdrs, 'Cookie': cookies, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': `${BASE}/Account/Login`, 'Origin': BASE },
    body: loginBody.toString(),
    redirect: 'manual'
  });
  const rawSetCookie = p2.headers.get('set-cookie') || '';
  let setCookieAll = [];
  try { setCookieAll = p2.headers.getAll('set-cookie'); } catch(e) {}
  cookies = mergeCookies(cookies, extractCookies(p2));
  const p2body = await p2.text();
  // Extraire le message d'erreur du login
  const errMatch = p2body.match(/class="[^"]*validation[^"]*"[^>]*>([\s\S]{0,300})/i)
    || p2body.match(/<li>([\s\S]{0,150})<\/li>/i);
  const loginError = errMatch ? errMatch[1].replace(/<[^>]+>/g, '').trim() : null;
  trace.push({
    step: '2_POST_login',
    status: p2.status,
    location: p2.headers.get('location'),
    loginError,
    fieldsSent: Object.keys({...hiddenFields, CodeEntreprise:'', UserName:'', Password:'', RememberMe:''}),
    allFormInputs: allInputs,
    loginFormHtml,
    rawSetCookie: rawSetCookie.slice(0, 300),
    setCookieCount: setCookieAll.length,
    cookies: cookieNames(cookies)
  });

  // 3. Suivre redirects post-login
  let nextUrl = p2.headers.get('location');
  let hops = 0;
  while (nextUrl && hops++ < 10) {
    const fullUrl = nextUrl.startsWith('http') ? nextUrl : `${BASE}${nextUrl}`;
    if (fullUrl.toLowerCase().includes('/account/login')) {
      return { ok: false, trace, error: 'Login échoué — redirection vers login' };
    }
    const hop = await fetch(fullUrl, { headers: { ...baseHdrs, 'Cookie': cookies }, redirect: 'manual' });
    cookies = mergeCookies(cookies, extractCookies(hop));
    trace.push({ step: `3_hop${hops}`, status: hop.status, url: fullUrl, location: hop.headers.get('location'), cookies: cookieNames(cookies) });
    if (hop.status === 301 || hop.status === 302 || hop.status === 303) {
      nextUrl = hop.headers.get('location') || '';
      if (nextUrl && !nextUrl.startsWith('http')) nextUrl = `${BASE}${nextUrl}`;
    } else {
      nextUrl = null;
    }
  }

  // 4. Probe API endpoints (si probe:true)
  const apiResults = {};
  if (data.probe) {
    const endpoints = [
      '/swagger/index.html', '/swagger', '/swagger/v1/swagger.json',
      '/api', '/api/v1', '/api/v2',
      '/Dossiers/isolation/fiche/create',
    ];
    for (const ep of endpoints) {
      try {
        const r = await fetch(`${BASE}${ep}`, {
          headers: { ...baseHdrs, 'Cookie': cookies },
          redirect: 'manual'
        });
        const body = await r.text();
        apiResults[ep] = {
          status: r.status,
          location: r.headers.get('location'),
          isSwagger: body.includes('swagger') || body.includes('OpenAPI'),
          isLogin: body.includes('Account/Login') || r.headers.get('location')?.includes('Account/Login'),
          bodyStart: body.slice(0, 100)
        };
      } catch(e) {
        apiResults[ep] = { error: e.message };
      }
    }
  }

  // 5. GET create form
  const { html: createHtml, cookies: c4, currentCookies: c4all } = await fetchFollow(
    `${BASE}/Dossiers/isolation/fiche/create`,
    { ...baseHdrs, 'Referer': BASE },
    cookies
  );
  // Extraire tous les inputs + selects du formulaire de création
  const createInputs = [];
  const reCI = /<input[^>]*>/gi; let mCI;
  while ((mCI = reCI.exec(createHtml)) !== null) {
    const nm = mCI[0].match(/name=["']([^"']+)["']/i);
    const tp = mCI[0].match(/type=["']([^"']+)["']/i);
    if (nm) createInputs.push({ name: nm[1], type: tp ? tp[1] : 'text' });
  }
  const createSelects = [];
  const reSel = /<select[^>]*name=["']([^"']+)["'][^>]*>/gi; let mSel;
  while ((mSel = reSel.exec(createHtml)) !== null) createSelects.push(mSel[1]);

  trace.push({
    step: '4_GET_create',
    cookiesSent: cookieNames(c4),
    cookiesAfter: cookieNames(c4all),
    hasForm: createHtml.includes('FicheISO_VM'),
    hasLogin: createHtml.includes('/Account/Login'),
    csrfFound: !!extractToken(createHtml),
    createInputs,
    createSelects
  });

  // 5. Test POST create avec données minimales
  const csrfTest = extractToken(createHtml);
  const hiddenTest = extractHiddenFields(createHtml);
  const testBody = new URLSearchParams({
    ...hiddenTest,
    '__RequestVerificationToken': csrfTest,
    'Fiche_VM.Nom': 'TEST', 'Fiche_VM.Prenom': 'TEST',
    'Fiche_VM.TelMobile': '0600000000', 'Fiche_VM.Adresse': '1 rue test',
    'Fiche_VM.CodePostal': '75001', 'Fiche_VM.Ville': 'Paris',
    'FicheISO_VM.TypeOperationCEE': 'Chauffage',
    'FicheISO_VM.TypeChauffage': '1', 'FicheISO_VM.TypeEnergie': 'Gaz',
    'FicheISO_VM.TypeHabitation': '1', 'FicheISO_VM.AgeBatiment': '3',
    'FicheISO_VM.NbrPersonneAuFoyer': '1', 'FicheISO_VM.RevenuFiscal': '0,00',
    'Fiche_VM.TypeLead': 'Form',
    'FicheISO_Statut_VM.WorkflowStatutId': '443f3db6-ff41-423b-933e-de2411fb824b',
    'Fiche_VM.OperateurId': 'f2d9f341-2573-40e1-8b70-4f480b1555e4',
  });
  const p5test = await fetch(`${BASE}/Dossiers/isolation/fiche/create`, {
    method: 'POST',
    headers: { ...baseHdrs, 'Cookie': c4, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': `${BASE}/Dossiers/isolation/fiche/create`, 'Origin': BASE },
    body: testBody.toString(), redirect: 'manual'
  });
  const p5txt = await p5test.text();
  // Extraire erreurs inline (data-valmsg-for avec contenu)
  const inlineErrors = [...p5txt.matchAll(/data-valmsg-for="([^"]+)"[^>]*>([^<]{2,150})<\/span>/ig)]
    .map(m => m[1] + ': ' + m[2].trim());
  trace.push({
    step: '5_POST_create_test',
    status: p5test.status,
    location: p5test.headers.get('location'),
    inlineErrors,
    bodyStart: p5txt.slice(0, 400)
  });

  return { ok: true, trace, apiResults, cookiesForPost: cookieNames(c4) };
}

// ─── Création dossier ─────────────────────────────────────────────────────────
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

  // 2. POST login — noms réels : Input.CustomerCode / Input.UserName / Input.Password
  const loginBody = new URLSearchParams({
    ...hiddenFields,
    'Input.CustomerCode': CODE,
    'Input.UserName': USER,
    'Input.Password': PASS,
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
    const names = cookieNames(cookies).join(' | ');
    throw new Error('Session invalide après login — cookies: [' + names + ']');
  }
  const csrfToken = extractToken(createHtml);
  if (!csrfToken) throw new Error(`Token CSRF introuvable — HTML: ${createHtml.slice(0, 200)}`);

  // Extraire tous les champs cachés du formulaire create
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

  // 6. POST dossier
  const typeOp = (data.ecs === 'Ballon indépendant') ? 'Chauffage & ECS' : 'Chauffage';
  const statutMap = { 'prop_occ': '1', 'prop_bail': '2', 'locataire': '3' };

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
  const _tcMap = {'Gaz':'1','Fioul':'1','Chaudière à bois':'1','Chaudière à charbon':'1','Électrique':'2','Autre':'1'};
  const _teMap = {'Gaz':'Gaz','Fioul':'Fioul','Chaudière à bois':'Bois','Chaudière à charbon':'Charbon','Électrique':'','Autre':'Autre'};
  set('FicheISO_VM.TypeChauffage', _tcMap[data.chauffage] || '1');
  set('FicheISO_VM.TypeEnergie', _teMap[data.chauffage] || '');
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
  set('BesoinClient', '');
  set('Fiche_VM.TypeLead', 'Form');
  set('Fiche_VM.Campagne', data.campagne || '');
  set('Fiche_VM.FournisseurLeadId', '');
  set('Fiche_VM.RegieId', '');
  set('Fiche_VM.ConfirmateurId', '');
  set('Fiche_VM.CommercialTerrainId', '');
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
      ...baseHdrs,
      'Cookie': cookies,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${BASE}/Dossiers/isolation/fiche/create`,
      'Origin': BASE,
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
    body: postBody.toString(),
    redirect: 'manual'
  });

  if (p5.status === 302) {
    const loc = p5.headers.get('location') || '';
    if (loc.toLowerCase().includes('/account/login')) {
      const names = cookieNames(cookies).join(' | ');
      throw new Error('Session invalide | cookies: [' + names + ']');
    }
    const idMatch = loc.match(/id=([a-f0-9-]+)/i);
    const id = idMatch ? idMatch[1] : null;
    if (!id) throw new Error("Soumission acceptée mais pas d'ID retourné — redirect: " + loc);
    return { ok: true, id, url: `${BASE}/Dossiers/Isolation/Fiche/N_EditMain?id=${id}` };
  }

  const txt = await p5.text();
  // Chercher toute erreur de validation dans la réponse
  const valErr = txt.match(/class="[^"]*field-validation-error[^"]*"[^>]*>([\s\S]{1,200}?)<\/span>/i)
    || txt.match(/class="[^"]*text-danger[^"]*"[^>]*>([\s\S]{1,200}?)<\/(?:span|div|p|li)>/i)
    || txt.match(/class="[^"]*validation[^"]*"[\s\S]{0,200}<li>([\s\S]{1,150})<\/li>/i);
  const errMsg = valErr ? valErr[1].replace(/<[^>]+>/g, '').trim() : null;
  // Chercher aussi les erreurs inline (data-valmsg)
  const inlineErr = !errMsg && txt.match(/data-valmsg-for="([^"]+)"[^>]*>([\s\S]{1,100}?)<\/span>/ig);
  const inlineMsgs = inlineErr ? [...txt.matchAll(/data-valmsg-for="([^"]+)"[^>]*>([^<]{1,100})<\/span>/ig)]
    .filter(m => m[2].trim()).map(m => m[1] + ': ' + m[2].trim()).join('; ') : null;
  throw new Error('Validation Pixel CRM — ' + (errMsg || inlineMsgs || `HTTP ${p5.status} — ${txt.slice(0, 300)}`));
}
