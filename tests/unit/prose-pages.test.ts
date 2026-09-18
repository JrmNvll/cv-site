/**
 * Les textes des deux pages de prose (story 9) — quatre fichiers Markdown,
 * un par page et par langue, relus ici avant d'être servis :
 *  - ils se rendent entièrement par le sous-ensemble de `renderMarkdown`,
 *    titres et liens activés : aucun lien ni titre ne reste en texte, chaque
 *    lien porte une adresse sûre ;
 *  - le français et l'anglais ont la même structure : mêmes rubriques, en
 *    nombre, et les mêmes liens, à la langue près ;
 *  - ils portent ce que la story exige — les rubriques des mentions, les
 *    faits retouchés du brouillon —, et son paragraphe central, repris tel
 *    quel ;
 *  - leurs chiffres sont ceux du code : durée des cookies, nombre d'entrées
 *    récupérées, plafond, modèle — lus dans les constantes, jamais recopiés ;
 *  - ils ne portent aucune donnée personnelle : ni nom (une marque, `{name}`,
 *    remplie depuis le contenu), ni courriel, ni numéro, ni adresse.
 * Ce que la page CV ne montre pas, ces textes ne le disent pas :
 * `page-projection.test.ts` y cherche aussi les valeurs de la fixture.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createElement, Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {MODEL, MONTHLY_CAP_MICRO_USD} from '@/agent';
import {renderMarkdown} from '@/app/(site)/[locale]/_components/markdown';
import {fillTemplate, HOSTING_INTRO} from '@/app/(site)/[locale]/_components/prose-template';
import {LANGS, type Lang} from '@/content/schema';
import {RETRIEVE_K} from '@/knowledge';
import {SESSION_IDLE_MS, VISITOR_MAX_AGE_SECONDS} from '@/proxy';
import {rawCv} from './sentinelles';

const PAGES = ['comment', 'mentions'] as const;
type Page = (typeof PAGES)[number];

function source(page: Page, lang: Lang): string {
  return readFileSync(
    fileURLToPath(new URL(`../../src/app/(site)/[locale]/${page}/${page}.${lang}.md`, import.meta.url)),
    'utf8'
  );
}

/** Le rendu des pages : titres et liens reconnus, comme dans `ProseArticle`. */
function html(text: string): string {
  return renderToStaticMarkup(
    createElement(Fragment, null, renderMarkdown(text, {headings: true, links: true}))
  );
}

/** Les valeurs de la fixture, comme la fabrique les remplit — l'hébergeur vide, comme en production tant qu'il n'est pas donné. */
const identite = rawCv.identite as {prenom: string; nom: string};
const NOM_FIXTURE = `${identite.prenom} ${identite.nom}`;
const valeurs = {name: NOM_FIXTURE, hebergeur: ''};

const textes = Object.fromEntries(
  PAGES.map((page) => [page, Object.fromEntries(LANGS.map((lang) => [lang, source(page, lang)]))])
) as Record<Page, Record<Lang, string>>;

const rendus = Object.fromEntries(
  PAGES.map((page) => [
    page,
    Object.fromEntries(LANGS.map((lang) => [lang, html(fillTemplate(textes[page][lang], valeurs))]))
  ])
) as Record<Page, Record<Lang, string>>;

const hrefs = (rendu: string) => [...rendu.matchAll(/<a href="([^"]+)"/g)].map((match) => match[1]!);
const titres = (rendu: string) => [...rendu.matchAll(/<h2>(.*?)<\/h2>/g)].map((match) => match[1]!);

/** Un nombre en lettres, dans les deux langues — pour les chiffres que les textes écrivent en toutes lettres. */
const EN_LETTRES: Record<number, Record<Lang, string>> = {
  5: {fr: 'cinq', en: 'five'},
  10: {fr: 'dix', en: 'ten'},
  12: {fr: 'douze', en: 'twelve'},
  15: {fr: 'quinze', en: 'fifteen'},
  20: {fr: 'vingt', en: 'twenty'}
};

describe('les textes des pages de prose', () => {
  it.each(PAGES.flatMap((page) => LANGS.map((lang) => [page, lang] as const)))(
    '%s.%s se rend entièrement, sans frontmatter, sans h1, chaque lien sûr et porteur de rel',
    (page, lang) => {
      const texte = textes[page][lang];
      const rendu = rendus[page][lang];
      // Pas de frontmatter, pas de titre de premier niveau : le `h1` vient des messages.
      expect(texte.startsWith('---')).toBe(false);
      expect(texte).not.toMatch(/^# /m);
      // Tout ce qui ressemble à du Markdown a été rendu : rien ne reste en texte.
      expect(rendu).not.toContain('](');
      expect(rendu).not.toMatch(/<p>#{1,6} /);
      expect(rendu).not.toContain('**');
      expect(rendu).not.toContain('`');
      // Aucune marque de gabarit n'a survécu au remplissage.
      expect(rendu).not.toMatch(/\{[a-z]+\}/);
      // Au moins six rubriques, chacune un `h2`.
      expect(titres(rendu).length).toBeGreaterThanOrEqual(6);
      // Chaque lien porte `rel`, jamais `target`, et une adresse sûre : `https://`
      // absolue ou un chemin du site — jamais `//`, jamais `/\`, aucune barre inverse.
      const liens = [...rendu.matchAll(/<a [^>]*>/g)].map((match) => match[0]);
      expect(liens.length).toBeGreaterThan(0);
      for (const lien of liens) {
        expect(lien).toContain('rel="nofollow noopener noreferrer"');
        expect(lien).not.toContain('target=');
      }
      for (const href of hrefs(rendu)) {
        expect(href).toMatch(/^(https:\/\/[^\s\\]+|\/(?![/\\])[^\s\\]*)$/);
      }
    }
  );

  it.each(PAGES)('%s : le français et lʼanglais ont les mêmes rubriques et les mêmes liens, à la langue près', (page) => {
    expect(titres(rendus[page].en)).toHaveLength(titres(rendus[page].fr).length);
    const sansLangue = (href: string) => href.replace(/^\/(fr|en)(?=[/#?]|$)/, '/{lang}');
    expect(hrefs(rendus[page].en).map(sansLangue)).toEqual(hrefs(rendus[page].fr).map(sansLangue));
    // Un chemin du site porte la langue du fichier, jamais l'autre.
    for (const lang of LANGS) {
      const autre = lang === 'fr' ? 'en' : 'fr';
      for (const href of hrefs(rendus[page][lang]).filter((value) => value.startsWith('/'))) {
        expect(href, `${page}.${lang} : ${href}`).toMatch(new RegExp(`^/${lang}(?=[/#?]|$)`));
        expect(href).not.toMatch(new RegExp(`^/${autre}(?=[/#?]|$)`));
      }
    }
  });

  it('« Comment » renvoie aux mentions, au dépôt public, au journal des décisions et à la méthode', () => {
    for (const lang of LANGS) {
      expect(hrefs(rendus.comment[lang])).toEqual(
        expect.arrayContaining([
          `/${lang}/mentions`,
          'https://github.com/JrmNvll/cv-site',
          'https://github.com/JrmNvll/cv-site/blob/main/docs/decisions.md',
          'https://docs.bmad-method.org/'
        ])
      );
      expect(textes.comment[lang]).toMatch(/BMAD( method)? — Breakthrough Method for Agile AI-Driven Development/);
    }
  });

  it('« Comment » reprend le brouillon : son paragraphe central tel quel, et les faits retouchés', () => {
    const fr = textes.comment.fr;
    // Le paragraphe « La méthode », repris, pas réécrit.
    expect(fr).toContain(
      'Le squelette a été soumis à quatre relectures indépendantes (grille de cohérence, vérification des versions sur le web, attaque adversaire, réconciliation avec le brief) avant d\'être figé ; la première version comportait un trou critique et une douzaine de failles que ces relectures ont fermés.'
    );
    expect(fr).toContain('C\'est exactement ainsi que je travaille en entreprise. La différence, ici, c\'est que vous pouvez le vérifier.');
    // Les retouches : l'évaluation d'annonce, les annonces conservées, la limite par site, la suite adverse pour le cache.
    expect(fr).toMatch(/évaluation d'une annonce/);
    expect(fr).toMatch(/les annonces collées/);
    expect(fr).toMatch(/par visiteur, par adresse et pour le site entier/);
    expect(fr).toMatch(/la suite de tests adverses vérifie qu'il fonctionne/);
    expect(fr).not.toMatch(/test d'intégration/);
    // Un compte qui ne périme pas ; la durée rattachée au journal, pas au cookie ; le coût réel.
    expect(fr).toMatch(/plus de deux cents questions/);
    expect(fr).not.toMatch(/deux cent trente/);
    expect(fr).toMatch(/conserve, sans limite de durée, les questions posées/);
    expect(fr).not.toMatch(/cookie, sans limite de durée/);
    expect(fr).toMatch(/enregistre le coût réel au retour/);
    // Les mêmes faits en anglais.
    const en = textes.comment.en;
    expect(en).toMatch(/evaluation of a job ad/);
    expect(en).toMatch(/the job ads pasted/);
    expect(en).toMatch(/per visitor, per address and for the whole site/);
    expect(en).toMatch(/the adversarial test suite checks that it works/);
    expect(en).toMatch(/one critical hole and a dozen flaws/);
    expect(en).toMatch(/more than two hundred questions/);
    expect(en).toMatch(/keeps, with no time limit, the questions asked/);
    expect(en).toMatch(/records the real cost on return/);
    expect(en).toMatch(/in a professional setting/);
    expect(en).toMatch(/verification of the stack versions against current sources/);
    expect(en).toMatch(/When a question is out of scope/);
    expect(en).not.toMatch(/my demonstration/);
  });

  it('« Mentions » déclare chaque rubrique exigée, dans les deux langues', () => {
    const attendu: Record<Lang, RegExp[]> = {
      fr: [
        /publié par \{name\}/,
        /aucune adresse postale/,
        /## Hébergement/,
        /loué chez \{hebergeur\}/,
        /sous Windows Server 2025/,
        /sauvegardé automatiquement chaque nuit, et ces sauvegardes sont conservées quatorze jours sur le serveur ; l'éditeur en fait en outre des copies manuelles/,
        /journal d'accès technique — adresse IP, navigateur, URL demandée, horodatage — tenu par tranches d'un mégaoctet ; chaque tranche archivée est effacée automatiquement après quatorze jours au plus/,
        /les sauvegardes et les tranches archivées du journal d'accès technique expirent d'elles-mêmes sous quatorze jours/,
        /\*\*cv_visitor\*\* — .*400 jours/,
        /\*\*cv_session\*\* — .*regroupe les questions posées au cours d'une même visite ; après 30 minutes d'inactivité/,
        /Aucun cookie tiers/,
        /pas de bannière de consentement, et voici pourquoi : la loi suisse sur la protection des données \(LPD\) impose d'informer/,
        /intérêt légitime de l'éditeur, non sur un consentement/,
        /\*\*sans limite de durée\*\*/,
        /adresse IP, le navigateur/,
        /provenance/,
        /langue/,
        /horodatages/,
        /questions posées/,
        /réponses données/,
        /annonces d'emploi collées/,
        /coût de chaque appel/,
        /annotations de l'éditeur : un nom ou une note qu'il pose sur un visiteur, une étiquette qu'il pose sur une adresse — jamais supprimées/,
        /Pourquoi :/,
        /L'application n'efface rien d'elle-même/,
        /## Ce qui est transmis à Anthropic/,
        /API d'Anthropic/,
        /Anthropic est établie aux États-Unis/,
        /conditions commerciales d'Anthropic pour son API, qui excluent l'utilisation des données pour entraîner ses modèles et en limitent la durée de conservation/,
        /intérêt légitime de l'éditeur : savoir ce qu'on lui demande et reconnaître une visite qui revient/,
        /loi fédérale suisse sur la protection des données \(LPD\)/,
        /Préposé fédéral à la protection des données et à la transparence \(PFPDT\)/,
        /## Aucun traceur/,
        /accès aux données[\s\S]*rectification[\s\S]*effacement/,
        /par courriel/,
        /votre adresse IP et la date approximative de votre visite suffisent/,
        /l'identifiant du cookie, que vous ne pouvez pas lire, n'est pas nécessaire/,
        /l'éditeur efface à la main les données liées à votre visite et consigne cet effacement/,
        /Sans JavaScript, le bouton du courriel n'apparaît pas : les profils LinkedIn et GitHub de la page CV restent alors le moyen de le joindre/,
        /## Site non indexé/,
        /noindex\), répétée dans un en-tête HTTP de chaque réponse/,
        /robots\.txt/,
        /## Contact/,
        /Sans JavaScript, .*LinkedIn et GitHub/
      ],
      en: [
        /published by \{name\}/,
        /no postal address/,
        /## Hosting/,
        /rented from \{hebergeur\}/,
        /running Windows Server 2025/,
        /backed up automatically every night, and those backups are kept for fourteen days on the server; the publisher also makes manual copies/,
        /technical access log — IP address, browser, requested URL, timestamp — kept in one-megabyte slices; each archived slice is deleted automatically after fourteen days at most/,
        /the backups and the archived slices of the technical access log expire on their own within fourteen days/,
        /\*\*cv_visitor\*\* — .*400 days/,
        /\*\*cv_session\*\* — .*groups the questions asked during one visit; after 30 minutes of inactivity/,
        /No third-party cookie/,
        /no consent banner, and here is why: the Swiss Federal Act on Data Protection \(FADP\) requires information/,
        /publisher's legitimate interest, not on consent/,
        /\*\*with no time limit\*\*/,
        /IP address, the browser/,
        /referring page/,
        /language/,
        /timestamps/,
        /questions asked/,
        /answers given/,
        /job ads pasted/,
        /cost of each call/,
        /publisher's annotations: a name or a note he attaches to a visitor, or a label he attaches to an address, never deleted/,
        /Why:/,
        /The application deletes nothing by itself/,
        /## What is sent to Anthropic/,
        /Anthropic's API/,
        /Anthropic is established in the United States/,
        /Anthropic's commercial terms for its API, which exclude the use of the data to train its models and limit how long it is retained/,
        /publisher's legitimate interest: knowing what he is being asked and recognising a returning visit/,
        /Swiss Federal Act on Data Protection \(FADP\)/,
        /Federal Data Protection and Information Commissioner \(FDPIC\)/,
        /## No tracker/,
        /access to the data[\s\S]*rectification[\s\S]*erasure/,
        /by email/,
        /your IP address and the approximate date of your visit are enough/,
        /the cookie identifier, which you cannot read, is not needed/,
        /the publisher deletes the data tied to your visit by hand and records that deletion/,
        /Without JavaScript, the email button does not appear: the LinkedIn and GitHub profiles on the CV page then remain the way to reach him/,
        /## Not indexed/,
        /noindex\), repeated in an HTTP header on every response/,
        /robots\.txt/,
        /## Contact/,
        /Without JavaScript, .*LinkedIn and GitHub/
      ]
    };
    for (const lang of LANGS) {
      for (const motif of attendu[lang]) {
        expect(textes.mentions[lang], `mentions.${lang} : ${motif}`).toMatch(motif);
      }
      // La rubrique « Contact » est la dernière : le bouton du courriel vient après le Markdown, sous elle.
      expect(titres(rendus.mentions[lang]).at(-1)).toBe('Contact');
      // Et elle renvoie à la section Contact de la page CV, et aux explications techniques.
      expect(hrefs(rendus.mentions[lang])).toEqual(expect.arrayContaining([`/${lang}#contact`, `/${lang}/comment`]));
    }
    // Les mots que le texte anglais n'emploie pas : « programming interface », les tirets doublés d'une virgule.
    expect(textes.mentions.en).not.toMatch(/programming interface/);
    expect(textes.mentions.en).not.toContain(' —, ');
    // Rien qui promette une page vue : le journal n'en a pas.
    for (const lang of LANGS) expect(textes.mentions[lang]).not.toMatch(/pages vues|pages viewed/);
  });

  it('« Mentions » date sa dernière mise à jour, dans les deux langues, au format attendu', () => {
    expect(textes.mentions.fr).toMatch(/^Dernière mise à jour : \d{1,2}(er)? [a-zéû]+ \d{4}\.$/m);
    expect(textes.mentions.en).toMatch(/^Last updated: \d{1,2} [A-Z][a-z]+ \d{4}\.$/m);
    // La même date des deux côtés : le jour et l'année.
    const fr = /Dernière mise à jour : (\d{1,2})(?:er)? [a-zéû]+ (\d{4})/.exec(textes.mentions.fr)!;
    const en = /Last updated: (\d{1,2}) [A-Z][a-z]+ (\d{4})/.exec(textes.mentions.en)!;
    expect([en[1], en[2]]).toEqual([fr[1], fr[2]]);
  });

  it('écrit les chiffres du code, jamais les siens : cookies, entrées récupérées, plafond, modèle', () => {
    const jours = VISITOR_MAX_AGE_SECONDS / (24 * 60 * 60);
    const minutes = SESSION_IDLE_MS / (60 * 1000);
    const dollars = MONTHLY_CAP_MICRO_USD / 1_000_000;
    expect(Number.isInteger(jours) && Number.isInteger(minutes) && Number.isInteger(dollars)).toBe(true);
    // « claude-opus-5 » s'écrit « Claude Opus 5 » dans les textes.
    const modele = MODEL.split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    const attendu: Record<Lang, RegExp[]> = {
      fr: [
        new RegExp(`conservé ${jours} jours`),
        new RegExp(`après ${minutes} minutes d'inactivité`),
        new RegExp(`les ${EN_LETTRES[RETRIEVE_K]!.fr} entrées les plus proches`),
        new RegExp(`plafonné à ${dollars} dollars par mois`),
        new RegExp(`\\(${modele}\\)`)
      ],
      en: [
        new RegExp(`kept for ${jours} days`),
        new RegExp(`after ${minutes} minutes of inactivity`),
        new RegExp(`the ${EN_LETTRES[RETRIEVE_K]!.en} closest entries`),
        new RegExp(`capped at ${dollars} dollars a month`),
        new RegExp(`\\(${modele}\\)`)
      ]
    };
    for (const lang of LANGS) {
      const tout = `${textes.comment[lang]}\n${textes.mentions[lang]}`;
      for (const motif of attendu[lang]) expect(tout, `${lang} : ${motif}`).toMatch(motif);
    }
  });

  it('remplit `{name}` depuis le contenu et `{hebergeur}` depuis la page — ou se passe du nom de lʼhébergeur', () => {
    for (const lang of LANGS) {
      // Le nom : une marque dans le fichier, le nom de la fixture une fois rempli.
      expect(textes.mentions[lang]).toContain('{name}');
      expect(rendus.mentions[lang]).toContain(NOM_FIXTURE);
      // L'hébergeur, vide : la phrase se passe du nom et des mots qui l'introduisent.
      expect(rendus.mentions[lang]).not.toContain('{hebergeur}');
      for (const intro of HOSTING_INTRO) expect(rendus.mentions[lang]).not.toContain(intro);
      // L'hébergeur, donné : il prend sa place, précédé de ses mots.
      const avec = html(fillTemplate(textes.mentions[lang], {name: NOM_FIXTURE, hebergeur: 'Hébergeur Fictif SA'}));
      expect(avec).toMatch(/(loué chez|rented from) Hébergeur Fictif SA,/);
    }
    expect(fillTemplate('un serveur privé virtuel loué chez {hebergeur}, sous', {name: 'x', hebergeur: ''})).toBe(
      'un serveur privé virtuel, sous'
    );
    expect(fillTemplate('a server rented from {hebergeur}, under', {name: 'x', hebergeur: ''})).toBe(
      'a server, under'
    );
    expect(fillTemplate('chez {hebergeur} et {name}', {name: 'N', hebergeur: 'H'})).toBe('chez H et N');
    expect(fillTemplate('{name} {name}', {name: 'N', hebergeur: ''})).toBe('N N');
  });

  it('ne porte aucun nom de personne : le vrai, la fixture, ni deux mots capitalisés hors liste', () => {
    // Règle simple, documentée : un nom de personne s'écrit prénom puis nom —
    // deux mots capitalisés qui se suivent au milieu d'une phrase. Les seuls
    // bigrammes admis sont ceux de la liste : produits, lois, institutions.
    // Le nom réel ne peut pas être cherché ici (rien du `cv.yaml` réel n'est
    // disponible en test) ; c'est cette règle qui le tient hors du dépôt.
    const ADMIS = new Set([
      'Windows Server',
      "Let's Encrypt",
      'Claude Opus',
      'Breakthrough Method',
      'Agile AI-Driven',
      'AI-Driven Development',
      'Swiss Federal',
      'Federal Act',
      'Data Protection',
      'Federal Data',
      'Information Commissioner',
      'United States',
      "Anthropic's API"
    ]);
    const MOT = "[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+";
    const bigramme = new RegExp(`(${MOT}) (${MOT})`, 'g');
    const horsListe = (texte: string) =>
      [...texte.matchAll(bigramme)]
        .filter((match) => !/(^|[.!?:;]\s|\n|##\s|-\s|\*\*|«\s|\(|\[)$/.test(texte.slice(0, match.index)))
        .map((match) => match[0])
        .filter((bigram) => !ADMIS.has(bigram));
    // La sonde : un nom au milieu d'une phrase est vu ; un nom admis, ou en tête de phrase, non.
    expect(horsListe('Ce site est publié par Jean Dupont, à titre personnel.')).toEqual(['Jean Dupont']);
    expect(horsListe('Il tourne sous Windows Server. Marie Curie y veille.')).toEqual([]);
    for (const page of PAGES) {
      for (const lang of LANGS) {
        const texte = textes[page][lang];
        expect(texte, `${page}.${lang}`).not.toContain(NOM_FIXTURE);
        expect(texte, `${page}.${lang}`).not.toMatch(/Jérémie|Nouvelle|Camille|Durand/);
        expect(horsListe(texte), `${page}.${lang} : bigrammes capitalisés hors liste`).toEqual([]);
      }
    }
  });

  it('ne porte aucune coordonnée : ni courriel, ni numéro sous aucun format, ni rue', () => {
    // Un numéro : international (`+41 79 000 00 00`, `0041…`) ou national
    // (`079 000 00 00`, `079.000.00.00`, `0790000000`) — des chiffres,
    // séparés ou non par des espaces, des points ou des tirets.
    const INTERNATIONAL = /(?:\+|00)\d{2}[\s.-]?\d(?:[\s.-]?\d){7,}/;
    const NATIONAL = /(?<!\d)0\d{2}(?:[\s.-]?\d{2,3}){3,}(?!\d)/;
    for (const page of PAGES) {
      for (const lang of LANGS) {
        const texte = textes[page][lang];
        expect(texte, `${page}.${lang}`).not.toMatch(/@/);
        expect(texte, `${page}.${lang}`).not.toMatch(/mailto:|tel:/);
        expect(texte, `${page}.${lang}`).not.toMatch(INTERNATIONAL);
        expect(texte, `${page}.${lang}`).not.toMatch(NATIONAL);
        expect(texte, `${page}.${lang}`).not.toMatch(/\b(rue|avenue|chemin|route|street|road)\b\s+\w/i);
      }
    }
    // La sonde : les formes que la règle doit attraper.
    for (const numero of ['+41 79 000 00 00', '0041 79 000 00 00', '079 000 00 00', '079.000.00.00', '0790000000', '022-000-00-00']) {
      expect(INTERNATIONAL.test(numero) || NATIONAL.test(numero), numero).toBe(true);
    }
  });
});
