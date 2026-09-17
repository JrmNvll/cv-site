import sharp from 'sharp';
import {expect, test, type Page} from '@playwright/test';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import {PHOTO_CSS_HEIGHT, PHOTO_CSS_WIDTH} from '../../src/app/api/photo/sizes';
import {
  careerYears,
  employerCount,
  joinParts,
  monthYearLabel,
  periodLabel,
  yearOf
} from '../../src/app/(site)/[locale]/_components/format';
import {display, rawCv, LANGS, type Lang} from './fixture-cv';
import {heroLabel, heroLabels} from './hero-labels';

/**
 * Preuve navigateur de la page CV — chaque ligne de la matrice de la story,
 * dans les deux langues et aux deux largeurs annoncées (390 px et 1440 px).
 *
 * Rien n'est comparé à un texte écrit ici : les valeurs attendues viennent de
 * la **même projection** que celle que le serveur rend, calculée sur la fixture
 * fictive que Playwright lui passe en `CONTENT_DIR` (`fixture-cv.ts`). Un test
 * qui recopierait le texte attendu ne prouverait plus que la page vient de la
 * projection.
 */
const messages = {fr, en};

const VIEWPORTS = [
  {name: '390 px', viewport: {width: 390, height: 844}},
  {name: '1440 px', viewport: {width: 1440, height: 900}}
] as const;

/** Le document déborde-t-il latéralement ? */
async function debordeHorizontalement(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const {documentElement} = document;
    // 1 px de tolérance : un arrondi de mise en page n'est pas un débordement.
    return documentElement.scrollWidth > documentElement.clientWidth + 1;
  });
}

for (const {name, viewport} of VIEWPORTS) {
  test.describe(`en ${name}`, () => {
    test.use({viewport});

    for (const locale of LANGS) {
      test(`/${locale} rend le CV entier depuis la projection`, async ({page}) => {
        const cv = display[locale];
        await page.goto(`/${locale}`);

        await expect(page.locator('html')).toHaveAttribute('lang', locale);

        // Identité et positionnement — le titre du CV porte le positionnement,
        // il est donc le `h1` (CAP-1).
        await expect(page.getByRole('heading', {level: 1})).toHaveText(cv.identite.titre);
        await expect(page.getByText(cv.identite.sous_titre!, {exact: true})).toBeVisible();
        await expect(page.getByText(cv.profil, {exact: true})).toBeVisible();
        await expect(page.getByText(`${cv.identite.prenom} ${cv.identite.nom}`)).toBeVisible();

        // En clair : LinkedIn, et rien d'autre. Courriel et numéro sont des
        // boutons, dans cet ordre, avant LinkedIn.
        await expect(
          page.getByRole('link', {name: messages[locale].header.linkedin})
        ).toHaveAttribute('href', cv.contact.linkedin!);
        const coordonnees = page.getByRole('list', {name: messages[locale].header.contact});
        await expect(coordonnees.getByRole('listitem')).toHaveText([
          messages[locale].email.reveal,
          messages[locale].phone.reveal,
          messages[locale].header.linkedin
        ]);

        // Les deux chiffres du bandeau : calculés depuis la projection, avec les
        // mêmes fonctions que la page — jamais recopiés.
        const bandeau = page.locator('dl');
        const annees = careerYears(cv.experiences, new Date())!;
        const employeurs = employerCount(cv.experiences)!;
        await expect(bandeau.locator('dd')).toHaveText([String(annees), String(employeurs)]);

        // Parcours : chaque expérience — période, employeur · lieu, activité,
        // réalisations, outils.
        for (const experience of cv.experiences) {
          const bloc = page
            .locator('li')
            .filter({has: page.getByRole('heading', {name: experience.poste, exact: true})})
            .first();
          await expect(page.getByRole('heading', {name: experience.poste, exact: true})).toBeVisible();
          const periode = periodLabel(experience.debut, experience.fin, messages[locale].career.present);
          if (periode !== undefined) await expect(bloc.getByText(periode, {exact: true})).toBeVisible();
          const lieu = joinParts([experience.entreprise, experience.lieu]);
          if (lieu !== undefined) await expect(bloc.getByText(lieu, {exact: true})).toBeVisible();
          if (experience.activite !== undefined) {
            await expect(bloc.getByText(experience.activite, {exact: true})).toBeVisible();
          }
          // Le certificat de travail : dit, daté, sur demande — jamais servi.
          if (experience.certificat !== undefined) {
            const attendu = messages[locale].career.certificate.replace(
              '{date}',
              monthYearLabel(experience.certificat.date, locale)!
            );
            await expect(bloc.getByText(attendu, {exact: true})).toBeVisible();
          }
          for (const realisation of experience.realisations ?? []) {
            await expect(page.getByText(realisation, {exact: true})).toBeVisible();
          }
          for (const outil of experience.environnement ?? []) {
            await expect(page.getByText(outil, {exact: true}).first()).toBeVisible();
          }
        }

        // Compétences, atouts, langues.
        for (const competence of cv.competences) {
          await expect(
            page.getByRole('heading', {name: competence.categorie, exact: true})
          ).toBeVisible();
          for (const item of competence.items) {
            await expect(page.getByText(item, {exact: true}).first()).toBeVisible();
          }
        }
        for (const atout of cv.atouts) {
          await expect(page.getByText(atout, {exact: true})).toBeVisible();
        }
        for (const langue of cv.langues) {
          await expect(
            page.getByText(joinParts([langue.langue, langue.niveau], ' — ')!, {exact: true})
          ).toBeVisible();
        }

        // Formation affichée : l'année, l'intitulé, l'option, l'équivalence,
        // l'établissement.
        const formation = page.locator('section[aria-labelledby="formation"]');
        for (const diplome of cv.formation) {
          const bloc = formation
            .locator('li')
            .filter({has: page.getByRole('heading', {name: diplome.diplome, exact: true})});
          await expect(bloc).toHaveCount(1);
          const annee = yearOf(diplome.annee);
          if (annee !== undefined) await expect(bloc.getByText(annee, {exact: true})).toBeVisible();
          if (diplome.option !== undefined) {
            await expect(bloc.getByText(diplome.option, {exact: false})).toBeVisible();
          }
          if (diplome.equivalence_suisse !== undefined) {
            await expect(bloc.getByText(diplome.equivalence_suisse, {exact: false})).toBeVisible();
          }
          if (diplome.etablissement !== undefined) {
            await expect(bloc.getByText(diplome.etablissement, {exact: true})).toBeVisible();
          }
          if (diplome.justificatif) {
            await expect(bloc.getByText(messages[locale].education.proof, {exact: true})).toBeVisible();
          }
        }

        // Informations pratiques : l'âge calculé et la localité — jamais l'adresse.
        const pratique = page.locator('section[aria-labelledby="pratique"]');
        await expect(pratique.getByText(String(cv.identite.age!), {exact: false})).toBeVisible();
        await expect(pratique.getByText(cv.contact.localite!, {exact: true})).toBeVisible();

        // Références : le nom et la fonction, et rien de plus dans le document.
        const references = page.locator('section[aria-labelledby="references"]');
        for (const reference of cv.references) {
          await expect(references.getByText(reference.nom, {exact: true})).toBeVisible();
          if (reference.fonction !== undefined) {
            await expect(references.getByText(reference.fonction, {exact: true})).toBeVisible();
          }
        }

        expect(await debordeHorizontalement(page)).toBe(false);
      });
    }

    test('lʼordre de lecture place le positionnement avant lʼhistorique (CAP-1)', async ({page}) => {
      await page.goto('/fr');
      const positions = await page.evaluate(() => {
        const rang = (element: Element | null) =>
          element === null ? -1 : [...document.querySelectorAll('*')].indexOf(element);
        return {
          titre: rang(document.querySelector('h1')),
          assistant: rang(document.getElementById('assistant-titre')),
          parcours: rang(document.getElementById('parcours'))
        };
      });

      expect(positions.titre).toBeGreaterThanOrEqual(0);
      expect(positions.assistant).toBeGreaterThan(positions.titre);
      expect(positions.parcours).toBeGreaterThan(positions.assistant);
    });

    test('lʼassistant répond aux six puces et au champ libre : rien ne reste inerte une fois hydraté', async ({
      page
    }) => {
      // Le test « inerte » de la story 3, inversé par la story 5 (les puces),
      // la story 6 (le champ) puis la story 7 (la sixième), et non supprimé :
      // un assistant muet ne doit plus passer la suite en silence.
      await page.goto('/fr');
      // Sous `lg`, l'assistant vit dans le tiroir : on l'ouvre par la barre.
      // Au-dessus, la barre n'existe pas et le panneau est dans le premier écran.
      const barre = page.locator('summary');
      if (viewport.width < 1024) {
        await expect(barre).toBeVisible();
        await barre.click();
      } else {
        await expect(barre).toBeHidden();
      }
      const panneau = page.getByRole('region', {name: messages.fr.assistant.eyebrow});

      const questions = heroLabels('fr');
      expect(questions).toHaveLength(6);
      const preparees = questions.slice(0, 5);
      const annonce = heroLabel('fr', 'annonce');
      for (const libelle of preparees) {
        const bouton = panneau.getByRole('button', {name: libelle, exact: true});
        await expect(bouton).toBeVisible();
        await expect(bouton).toBeEnabled();
      }
      const sixieme = panneau.getByRole('button', {name: annonce, exact: true});
      await expect(sixieme).toBeVisible();
      await expect(sixieme).toBeEnabled();

      const champ = panneau.getByRole('textbox', {name: messages.fr.assistant.questionLabel});
      await expect(champ).toBeVisible();
      await expect(champ).toBeEnabled();
      // Tout répond : la ligne d'état du visiteur sans JavaScript n'est plus là.
      await expect(panneau.getByText(messages.fr.assistant.withoutScript)).toHaveCount(0);
    });

    test('le premier écran suit la mise en page validée le 2026-09-15', async ({page}) => {
      await page.goto('/fr');
      const h1 = page.getByRole('heading', {level: 1});
      const mesure = await h1.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          lignes: Math.round(element.getBoundingClientRect().height / parseFloat(style.lineHeight)),
          deborde: element.scrollWidth > element.clientWidth
        };
      });
      expect(mesure.deborde).toBe(false);

      if (viewport.width >= 1024) {
        // Le titre sur une seule ligne, la photo à sa gauche ; le panneau
        // commence sous le titre, à droite du profil.
        expect(mesure.lignes).toBe(1);
        const titre = await h1.boundingBox();
        const panneau = await page
          .getByRole('region', {name: messages.fr.assistant.eyebrow})
          .boundingBox();
        const profil = await page.getByText(display.fr.profil, {exact: true}).boundingBox();
        expect(panneau!.y).toBeGreaterThan(titre!.y + titre!.height);
        expect(panneau!.x).toBeGreaterThan(profil!.x + profil!.width - 1);
      } else {
        // Sur téléphone, le titre se replie et la photo est au-dessus.
        expect(mesure.lignes).toBeGreaterThan(1);
        const photo = await page.getByRole('img').boundingBox();
        const titre = await h1.boundingBox();
        expect(titre!.y).toBeGreaterThanOrEqual(photo!.y + photo!.height);
      }
    });
  });
}

test.describe('lʼassistant sur téléphone', () => {
  test.use({viewport: {width: 390, height: 844}});

  test('est une barre fixe en bas dʼécran, qui ouvre et referme le tiroir', async ({page}) => {
    await page.goto('/fr');
    const barre = page.locator('summary');
    await expect(barre).toBeVisible();
    // Fixée en bas de la fenêtre, quelle que soit la position de défilement.
    const boite = await barre.boundingBox();
    expect(Math.round(boite!.y + boite!.height)).toBe(844);

    const question = page.getByRole('button', {
      name: messages.fr.assistant.questions['lic-01'],
      exact: true
    });
    await expect(question).toBeHidden();

    await barre.click();
    await expect(question).toBeVisible();
    // La barre reste au-dessus du tiroir pour le refermer.
    await barre.click();
    await expect(question).toBeHidden();
  });

  test('ne cache rien de la page sous la barre : la dernière section reste atteignable', async ({
    page
  }) => {
    await page.goto('/fr');
    const derniere = page.locator('section[aria-labelledby="references"]');
    await derniere.scrollIntoViewIfNeeded();
    const section = await derniere.boundingBox();
    const barre = await page.locator('summary').boundingBox();
    // Le bas de la dernière section est au-dessus de la barre, pas dessous.
    expect(section!.y + section!.height).toBeLessThanOrEqual(barre!.y + 1);
  });

  test.describe('sans JavaScript', () => {
    test.use({javaScriptEnabled: false});

    test('le tiroir sʼouvre quand même : cʼest un <details> natif', async ({page}) => {
      await page.goto('/fr');
      const question = page.getByRole('button', {
        name: messages.fr.assistant.questions['lic-01'],
        exact: true
      });
      await expect(question).toBeHidden();
      await page.locator('summary').click();
      await expect(question).toBeVisible();
    });
  });
});

test('une expérience sans activité ni employeur se rend sans ponctuation orpheline', async ({
  page
}) => {
  await page.goto('/fr');
  // Dans la fixture, `conge-parental` n'a ni `entreprise`, ni `activite`, ni
  // `environnement` : c'est le cas limite « champ optionnel absent ».
  const sans = display.fr.experiences.find((experience) => experience.entreprise === undefined)!;
  expect(sans.activite).toBeUndefined();

  const bloc = page
    .locator('li')
    .filter({has: page.getByRole('heading', {name: sans.poste, exact: true})})
    .first();
  const texte = (await bloc.innerText()).trim();

  expect(texte).toContain(sans.poste);
  expect(texte).toContain(sans.lieu!);
  // Ni séparateur en tête ou en queue de ligne, ni deux séparateurs collés.
  for (const ligne of texte.split('\n').map((line) => line.trim())) {
    expect(ligne, `ligne « ${ligne} »`).not.toMatch(/(^·|·$|·\s*·|—\s*$|^\s*—)/);
  }
});

test('une formation masquée par `dans_cv: false` nʼapparaît pas', async ({page}) => {
  const masquees = (rawCv.formation as {dans_cv?: boolean; diplome: Record<Lang, string>}[]).filter(
    (entry) => entry.dans_cv === false
  );
  expect(masquees.length).toBeGreaterThan(0);

  for (const locale of LANGS) {
    await page.goto(`/${locale}`);
    const html = await page.content();
    for (const masquee of masquees) {
      expect(html).not.toContain(masquee.diplome[locale]);
    }
    // …mais la formation affichée, elle, est bien là.
    for (const visible of display[locale].formation) {
      expect(html).toContain(visible.diplome);
    }
  }
});

test('un champ absent ne laisse pas de ligne vide : pas de « permis » sans permis', async ({
  page
}) => {
  // `permis: null` dans la fixture : le bloc pratique ne porte que l'âge et la
  // localité — deux lignes, aucune vide, aucun libellé orphelin.
  expect(display.fr.identite.permis).toBeUndefined();
  await page.goto('/fr');
  const lignes = page.locator('section[aria-labelledby="pratique"] li');
  await expect(lignes).toHaveCount(2);
  for (const ligne of await lignes.allInnerTexts()) {
    expect(ligne.trim()).not.toBe('');
  }
});

test.describe('la photo', () => {
  test('est servie par la route, en cache privé, et sʼaffiche', async ({page, request}) => {
    const reponse = await request.get('/api/photo');

    expect(reponse.status()).toBe(200);
    expect(reponse.headers()['content-type']).toContain('image/');
    expect(reponse.headers()['cache-control']).toContain('private');
    expect(reponse.headers()['etag']).toBeTruthy();

    await page.goto('/fr');
    const image = page.getByRole('img');
    await expect(image).toHaveAttribute('src', '/api/photo');
    // Une variante par densité d'écran : le navigateur choisit, le serveur découpe.
    await expect(image).toHaveAttribute('srcset', '/api/photo?s=1 1x, /api/photo?s=2 2x, /api/photo?s=3 3x');
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
      .toBe(true);
  });

  test('est réellement découpée par lʼartefact de production : portrait 3:4, sans EXIF', async ({
    page,
    request
  }) => {
    // La fixture est un portrait 600 × 772 JPEG avec un EXIF sentinelle : c'est
    // ici, contre le build autonome, que le pipeline `sharp` — dépendance
    // native — est prouvé, pas seulement en unitaire sur simulacre.
    for (const scale of [1, 2, 3] as const) {
      const reponse = await request.get(`/api/photo?s=${scale}`);
      expect(reponse.status()).toBe(200);
      expect(reponse.headers()['content-type']).toBe('image/jpeg');
      const octets = await reponse.body();
      expect(String(octets.byteLength)).toBe(reponse.headers()['content-length']);
      const meta = await sharp(octets).metadata();
      expect([meta.width, meta.height]).toEqual([PHOTO_CSS_WIDTH * scale, PHOTO_CSS_HEIGHT * scale]);
      expect(meta.exif).toBeUndefined();
      expect(octets.includes('Sentinelle-EXIF-Fixture-Fictive')).toBe(false);
    }
    expect((await request.get('/api/photo?s=4')).status()).toBe(400);

    // Et ce que le navigateur affiche à densité 1 est bien la variante 1×.
    await page.goto('/fr');
    const image = page.getByRole('img');
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
      .toBe(PHOTO_CSS_WIDTH);
    // Et le cadre affiché a exactement les proportions servies : rien à rogner.
    expect(await image.evaluate((node) => [node.clientWidth, node.clientHeight])).toEqual([
      PHOTO_CSS_WIDTH,
      PHOTO_CSS_HEIGHT
    ]);
    expect(await image.evaluate((node: HTMLImageElement) => node.currentSrc)).toContain('/api/photo?s=1');
  });

  test('répond 304 quand le navigateur a déjà la bonne version', async ({request}) => {
    const premiere = await request.get('/api/photo');
    const etag = premiere.headers()['etag']!;

    const seconde = await request.get('/api/photo', {headers: {'if-none-match': etag}});
    expect(seconde.status()).toBe(304);
  });

  test('ne divulgue pas son chemin dans CONTENT_DIR', async ({request}) => {
    const chemin = (rawCv.identite as {photo: string}).photo;
    const reponse = await request.get('/api/photo');
    const entetes = JSON.stringify(reponse.headers());
    expect(entetes).not.toContain(chemin);
    expect(entetes).not.toContain('fixtures');
  });
});

test.describe('les coordonnées dʼune référence', () => {
  const reference = (rawCv.references as {id: string; telephone: string; email: string}[])[0]!;

  test('nʼapparaissent quʼaprès un geste explicite, courriel et numéro en liens', async ({page}) => {
    await page.goto('/fr');
    // Avant le clic : rien de ces coordonnées dans le document rendu.
    const html = await page.content();
    expect(html).not.toContain(reference.telephone);
    expect(html).not.toContain(reference.email);

    const section = page.locator('section[aria-labelledby="references"]');
    await section.getByRole('button', {name: messages.fr.references.reveal}).click();

    const courriel = section.getByRole('link', {name: reference.email});
    await expect(courriel).toHaveAttribute('href', `mailto:${reference.email}`);
    await expect(courriel).toBeFocused();
    await expect(
      section.getByRole('link', {name: new RegExp(reference.telephone.replace(/[+]/g, '\\+'))})
    ).toHaveAttribute('href', `tel:${reference.telephone.replace(/[^+0-9]/g, '')}`);
  });

  test('sont servies par la route, sans cache, et jamais par le serveur', async ({request}) => {
    const reponse = await request.get(`/api/references/${reference.id}/contact`);
    expect(reponse.status()).toBe(200);
    expect(reponse.headers()['cache-control']).toContain('no-store');
    expect(await reponse.json()).toEqual({telephone: reference.telephone, email: reference.email});

    expect((await request.get('/api/references/inconnue/contact')).status()).toBe(404);
  });

  test('disent leur indisponibilité quand la route échoue', async ({page}) => {
    await page.route('**/api/references/**', (route) =>
      route.fulfill({status: 404, contentType: 'application/json', body: '{}'})
    );
    await page.goto('/fr');
    const section = page.locator('section[aria-labelledby="references"]');
    await section.getByRole('button', {name: messages.fr.references.reveal}).click();
    await expect(section.getByRole('status')).toHaveText(messages.fr.references.unavailable);
  });
});

test.describe('le téléphone', () => {
  test('nʼapparaît quʼaprès un geste explicite', async ({page}) => {
    const attendu = (rawCv.contact as {telephone: string}).telephone;

    await page.goto('/fr');
    // Avant le clic : rien, ni dans le document rendu, ni à l'écran.
    expect(await page.content()).not.toContain(attendu);

    await page.getByRole('button', {name: messages.fr.phone.reveal}).click();
    const lien = page.getByRole('link', {name: new RegExp(attendu.replace(/[+]/g, '\\+'))});
    await expect(lien).toBeVisible();
    // Un lien `tel:` sans les espaces de lecture, et le focus posé dessus : le
    // bouton a disparu, le clavier ne doit pas retomber sur le document.
    await expect(lien).toHaveAttribute('href', `tel:${attendu.replace(/[^+0-9]/g, '')}`);
    await expect(lien).toBeFocused();
  });

  test('dit son indisponibilité quand la route échoue, et attend visiblement avant', async ({
    page
  }) => {
    // La route est interceptée : d'abord retenue, puis en échec. Le bouton doit
    // se désactiver et le dire pendant l'attente, puis laisser place au message
    // — le courriel, lui, reste là.
    let liberer: (() => void) | undefined;
    const retenue = new Promise<void>((resolve) => {
      liberer = resolve;
    });
    await page.route('**/api/contact/phone', async (route) => {
      await retenue;
      await route.fulfill({status: 404, contentType: 'application/json', body: '{}'});
    });

    await page.goto('/fr');
    const bouton = page.getByRole('button', {name: messages.fr.phone.reveal});
    await bouton.click();
    const enAttente = page.getByRole('button', {name: messages.fr.phone.pending});
    await expect(enAttente).toBeVisible();
    await expect(enAttente).toBeDisabled();

    liberer!();
    await expect(page.getByRole('status')).toHaveText(messages.fr.phone.unavailable);
    await expect(page.getByRole('button', {name: messages.fr.phone.reveal})).toHaveCount(0);
    // LinkedIn reste là, en clair : c'est vers lui que le message renvoie.
    await expect(page.getByRole('link', {name: messages.fr.header.linkedin})).toBeVisible();
  });

  test('le courriel suit la même règle : absent du document, révélé au clic', async ({page}) => {
    const attendu = (rawCv.contact as {email: string}).email;
    await page.goto('/fr');
    expect(await page.content()).not.toContain(attendu);

    await page.getByRole('button', {name: messages.fr.email.reveal}).click();
    const lien = page.getByRole('link', {name: attendu});
    await expect(lien).toHaveAttribute('href', `mailto:${attendu}`);
    await expect(lien).toBeFocused();
  });

  test('traite une réponse sans numéro comme un échec', async ({page}) => {
    await page.route('**/api/contact/phone', (route) =>
      route.fulfill({status: 200, contentType: 'application/json', body: '{"autre": "chose"}'})
    );
    await page.goto('/fr');
    await page.getByRole('button', {name: messages.fr.phone.reveal}).click();
    await expect(page.getByRole('status')).toHaveText(messages.fr.phone.unavailable);
  });

  test('est rendu par la route, sans cache, et jamais par le serveur', async ({request}) => {
    const attendu = (rawCv.contact as {telephone: string}).telephone;

    const reponse = await request.get('/api/contact/phone');
    expect(reponse.status()).toBe(200);
    expect(reponse.headers()['cache-control']).toContain('no-store');
    expect(await reponse.json()).toEqual({telephone: attendu});

    // La page, elle, ne le porte pas — c'est tout l'objet d'AD-8.
    const page = await request.get('/fr');
    expect(await page.text()).not.toContain(attendu);
  });
});

test.describe('sans JavaScript', () => {
  test.use({javaScriptEnabled: false});

  test('le CV reste entièrement lisible et le bouton du téléphone est absent', async ({page}) => {
    const cv = display.fr;
    await page.goto('/fr');

    await expect(page.getByRole('heading', {level: 1})).toHaveText(cv.identite.titre);
    await expect(page.getByText(cv.profil, {exact: true})).toBeVisible();
    for (const experience of cv.experiences) {
      await expect(page.getByRole('heading', {name: experience.poste, exact: true})).toBeVisible();
    }
    for (const competence of cv.competences) {
      await expect(
        page.getByRole('heading', {name: competence.categorie, exact: true})
      ).toBeVisible();
    }
    // Sans JavaScript, LinkedIn est le seul contact affiché : les boutons du
    // courriel et du numéro n'existent pas.
    await expect(page.getByRole('link', {name: messages.fr.header.linkedin})).toBeVisible();
    await expect(page.getByRole('button', {name: messages.fr.email.reveal})).toHaveCount(0);

    // L'assistant est un supplément, pas une condition : ses questions restent
    // lisibles, et le bouton du téléphone — qui ne pourrait rien faire — n'est
    // pas rendu du tout.
    // Le titre du panneau, par son rôle : le texte existe aussi dans la barre
    // et le tiroir du téléphone, masqués à cette largeur.
    await expect(page.getByRole('heading', {name: messages.fr.assistant.eyebrow})).toBeVisible();
    await expect(page.getByRole('button', {name: messages.fr.phone.reveal})).toHaveCount(0);
    // Même règle pour les coordonnées d'une référence : le nom reste, le bouton non.
    for (const reference of cv.references) {
      await expect(page.getByText(reference.nom, {exact: true})).toBeVisible();
    }
    await expect(page.getByRole('button', {name: messages.fr.references.reveal})).toHaveCount(0);
  });

  test('le changement de langue fonctionne toujours : ce sont des liens', async ({page}) => {
    await page.goto('/fr');
    await page.getByRole('link', {name: messages.en.languages.en}).click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByRole('heading', {level: 1})).toHaveText(display.en.identite.titre);
  });
});

test.describe('le thème sombre', () => {
  test.use({colorScheme: 'dark'});

  test('change le fond et lʼencre sans toucher au contenu', async ({page, browser}) => {
    await page.goto('/fr');
    const sombre = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return {fond: style.backgroundColor, encre: style.color};
    });
    await expect(page.getByRole('heading', {level: 1})).toHaveText(display.fr.identite.titre);

    const clair = await browser.newContext({colorScheme: 'light'});
    const pageClaire = await clair.newPage();
    await pageClaire.goto('/fr');
    const couleursClaires = await pageClaire.evaluate(() => {
      const style = getComputedStyle(document.body);
      return {fond: style.backgroundColor, encre: style.color};
    });
    await clair.close();

    expect(sombre.fond).not.toBe(couleursClaires.fond);
    expect(sombre.encre).not.toBe(couleursClaires.encre);
  });
});

test('le sélecteur de langue pointe vers la même page dans lʼautre langue — à la racine, faute dʼautre page', async ({
  page
}) => {
  // Constat reporté de la story 1 : `href="/"` renvoyait à la racine. Tant que
  // le site n'a qu'une page, `href={pathname}` et `href="/"` produisent le même
  // attribut : ce test ne distingue pas les deux. La preuve viendra avec la
  // première page secondaire (story 9), consignée dans `deferred-work.md`.
  await page.goto('/fr/chemin-inexistant');
  const lien = page.getByRole('link', {name: messages.en.languages.en});
  await expect(lien).toHaveCount(0);

  await page.goto('/fr');
  await expect(page.getByRole('link', {name: messages.en.languages.en})).toHaveAttribute(
    'href',
    '/en'
  );
  await expect(page.getByRole('link', {name: messages.fr.languages.fr})).toHaveAttribute(
    'href',
    '/fr'
  );
});
