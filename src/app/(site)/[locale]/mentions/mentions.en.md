This site is a personal CV: it sells nothing, collects nothing without telling you, and is not meant to be found by a search engine. This page says who publishes it, what it keeps from your visit and why, what it passes on, and how to exercise your rights. The technology is described in [How this site is built](/en/comment).

Last updated: 17 September 2026.

## Who publishes this site

This site is published by {name}, in a personal capacity, as part of his job search. Its only purpose is to present his career and answer a recruiter's questions. To reach him, see the "Contact" section at the bottom of this page; no postal address is published.

## Hosting

The site runs on a virtual private server rented from {hebergeur}, running Windows Server 2025, administered by the publisher himself. The domain name is managed at Cloudflare; the HTTPS certificate is issued by Let's Encrypt. The visit log described below is kept on that server; the publisher backs it up by hand, at regular intervals.

## Cookies

The site sets two technical cookies, and no other:

- **cv_visitor** — a random visitor identifier, kept for 400 days, which makes it possible to recognise a returning visit;
- **cv_session** — a session identifier, deleted when the browser closes, which groups the questions asked during one visit; after 30 minutes of inactivity, a new session begins.

They serve the visit log only. No script can read them and they are shared with no one. No third-party cookie, no advertising cookie, no audience measurement. There is no consent banner, and here is why: the Swiss Federal Act on Data Protection (FADP) requires information, which is what this page provides, and these two cookies, needed by the log, rest on the publisher's legitimate interest, not on consent.

## What the site keeps, and why

Every visit is written to a log kept on the server, **with no time limit**:

- the IP address, the browser (User-Agent string), the referring page (without its parameters) and the chosen language;
- the timestamps of the start and of the last activity of each session;
- the questions put to the assistant, including the prepared questions you click, the answers given, and the job ads pasted for evaluation, in full;
- the cost of each call to the language model;
- the publisher's annotations: a name or a note he attaches to a visitor, or a label he attaches to an address, never deleted either; removing one stores an empty value.

Why: to know what the publisher is being asked, to recognise a returning visit, and to keep the assistant's spending under its monthly cap. The application deletes nothing by itself and aggregates nothing for commercial purposes; nothing is passed on to a third party beyond what the next section describes. Only the publisher reads this log, through a password-protected administration area.

## What is sent to Anthropic

The assistant relies on a language model provided by Anthropic (Claude). To produce an answer, the server sends to Anthropic's API: your question, or the job ad you pasted; the earlier exchanges of the same conversation; and the publisher's dossier: his CV and the excerpts of his prepared answers that relate to your request. Neither your IP address, nor your cookies, nor your browser are part of that transmission.

Anthropic is established in the United States: this data is transferred there. The transfer rests on Anthropic's commercial terms for its API, which exclude the use of the data to train its models and limit how long it is retained. The processing itself rests on the publisher's legitimate interest: knowing what he is being asked and recognising a returning visit. The applicable law is the Swiss Federal Act on Data Protection (FADP); the supervisory authority is the Federal Data Protection and Information Commissioner (FDPIC).

## No tracker

No audience-measurement script, no embedded social network, no font or resource loaded from a third-party service: your browser talks to this site only. The links to LinkedIn and GitHub are ordinary links, which load nothing until you click them.

## Your rights

You may ask for access to the data that concerns you, the sessions and questions tied to your visit, and ask for its rectification or its erasure. The request is made by email, at the address in the "Contact" section; your IP address and the approximate date of your visit are enough to find it, and the cookie identifier, which you cannot read, is not needed. The application deletes nothing by itself; on request, the publisher deletes the data tied to your visit by hand and records that deletion. Without JavaScript, the email button does not appear: the LinkedIn and GitHub profiles on the CV page then remain the way to reach him.

## Not indexed

Every page carries a no-indexing instruction (noindex), repeated in an HTTP header on every response, and the robots.txt file forbids robots from crawling anything. This site is meant to be opened from a job application, not found by chance.

## Contact

By email: the button below shows the address. It requires JavaScript, so that the address is not in the page's code and cannot be harvested. Without JavaScript, the publisher remains reachable through the LinkedIn and GitHub profiles on the [CV page](/en#contact).
